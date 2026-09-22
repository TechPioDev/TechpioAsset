import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, DiscoveryMatchState, DiscoverySource, Prisma } from '@prisma/client';
import type {
  AgentReportInput,
  AuthUser,
  DiscoveredDeviceInput,
  DiscoveryListQuery,
  IngestInput,
} from '@techpioasset/contracts';
import { AppError } from '../common/errors/app-error.js';
import { paginate } from '../common/paginate.js';
import { AuditService } from '../audit/audit.service.js';
import { AssetHealthService } from '../asset-health/asset-health.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../integrations/webhooks.service.js';
import { DiscoveryProvider } from '../providers/discovery/discovery.provider.js';
import type { AgentPrincipal } from './agent.guard.js';

/** The client shape Prisma passes to interactive-transaction callbacks. */
type Tx = Omit<
  PrismaService['client'],
  '$connect' | '$disconnect' | '$on' | '$use' | '$transaction' | '$extends'
>;

export interface IngestSummary {
  received: number;
  matched: number;
  proposed: number;
  conflict: number;
  unmatched: number;
  /** Devices whose payload was applied to a linked asset this run. */
  applied: number;
}

/**
 * v2.5 Discovery reconciliation (plan section H2).
 *
 * The rule that governs everything here: discovery PROPOSES, it never silently
 * mutates. Only two things may link a device to an asset — an exact,
 * unambiguous serial-number match, or a human confirming a proposal. Hardware,
 * OS and software payloads are applied to an asset ONLY once such a link
 * exists. Ambiguity (two assets sharing a serial) parks as CONFLICT for a
 * human; a hostname coincidence is only ever PROPOSED.
 */
@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly provider: DiscoveryProvider,
    private readonly health: AssetHealthService,
    private readonly webhooks: WebhooksService,
  ) {}

  // ── ingest ─────────────────────────────────────────────────────────────────

  async ingest(actor: AuthUser, input: IngestInput, source: DiscoverySource = 'AGENT') {
    return this.ingestForCompany(actor.companyId, actor.id, input, source);
  }

  /**
   * The shared reconcile path. Split out (v2.13) so an enrolled agent — which
   * is a machine, not an AuthUser, and holds no permissions — can report
   * through exactly the same logic a human-triggered ingest uses.
   */
  private async ingestForCompany(
    companyId: string,
    actorId: string | null,
    input: IngestInput,
    source: DiscoverySource,
  ) {
    const summary: IngestSummary = {
      received: input.devices.length,
      matched: 0,
      proposed: 0,
      conflict: 0,
      unmatched: 0,
      applied: 0,
    };

    // Devices are independent; one bad device must not roll back its batch
    // siblings, so each reconciles in its own transaction.
    for (const device of input.devices) {
      const outcome = await this.prisma.client.$transaction((tx) =>
        this.reconcileDevice(tx as Tx, companyId, device, source),
      );
      summary[outcome.bucket] += 1;
      if (outcome.newConflict) {
        void this.webhooks.publish(companyId, 'discovery.conflict', {
          source,
          ...outcome.newConflict,
        });
      }
      if (outcome.applied) {
        summary.applied += 1;
        // H4: fresh data changes the health picture; recompute after commit.
        if (outcome.assetId) {
          await this.health.recomputeForAsset(companyId, outcome.assetId);
        }
      }
    }

    await this.audit.record({
      companyId: companyId,
      actorId,
      action: AuditAction.DISCOVERY_INGESTED,
      entityType: 'DiscoveredDevice',
      entityId: source,
      newValues: summary as unknown as Prisma.InputJsonValue,
    });
    return summary;
  }

  // ── agent reporting (v2.13) ────────────────────────────────────────────────
  // Enrolment tokens and device credentials live in AgentEnrolmentService.

  /**
   * An enrolled laptop reporting its own inventory.
   *
   * The device identity comes from the credential, never the body - that is
   * the whole security property: an agent can only ever describe itself.
   */
  async reportFromAgent(agent: AgentPrincipal, input: AgentReportInput) {
    if (input.hostname || input.serialNumber || input.agentVersion) {
      await this.prisma.client.deviceAgent.update({
        where: { id: agent.deviceAgentId },
        data: {
          ...(input.hostname ? { hostname: input.hostname } : {}),
          ...(input.serialNumber ? { serialNumber: input.serialNumber } : {}),
          ...(input.agentVersion ? { agentVersion: input.agentVersion } : {}),
        },
      });
    }

    return this.ingestForCompany(
      agent.companyId,
      null,
      {
        devices: [
          {
            externalId: agent.machineId,
            serialNumber: input.serialNumber ?? null,
            hostname: input.hostname ?? null,
            hardware: input.hardware ?? null,
            os: input.os ?? null,
            software: input.software ?? null,
          },
        ],
      },
      'AGENT',
    );
  }

  /** Pull from the configured provider and push through the same ingest path. */
  async runProvider(actor: AuthUser) {
    const fetched = await this.provider.fetchDevices();
    const source: DiscoverySource = fetched.provider === 'intune' ? 'INTUNE' : 'MOCK';
    const summary = await this.ingest(actor, { devices: fetched.devices }, source);
    return { provider: fetched.provider, simulated: fetched.simulated, ...summary };
  }

  private async reconcileDevice(
    tx: Tx,
    companyId: string,
    device: DiscoveredDeviceInput,
    source: DiscoverySource,
  ): Promise<{
    bucket: 'matched' | 'proposed' | 'conflict' | 'unmatched';
    applied: boolean;
    assetId?: string | null;
    /**
     * Set on the sighting that turned this device INTO a conflict, not on
     * every later sighting of the same conflicted device - an agent reports
     * daily, and a webhook that fires daily about the same unresolved row is
     * noise nobody will wire an automation to.
     */
    newConflict?: { serialNumber: string | null; hostname: string | null; candidateAssetId: string | null };
  }> {
    const serial = device.serialNumber?.trim() || null;
    const hostname = device.hostname?.trim() || null;

    // Identity within the queue: prefer the source's own id, then serial, then
    // hostname — the same order the contract's refine guarantees at least one of.
    const existing = await tx.discoveredDevice.findFirst({
      where: {
        companyId,
        source,
        ...(device.externalId
          ? { externalId: device.externalId }
          : serial
            ? { serialNumber: { equals: serial, mode: 'insensitive' } }
            : { hostname: { equals: hostname!, mode: 'insensitive' } }),
      },
    });

    // A human's IGNORED verdict is sticky: keep recording sightings, never
    // re-open the queue item behind their back.
    if (existing?.matchState === 'IGNORED') {
      await tx.discoveredDevice.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date(), payload: device as unknown as Prisma.InputJsonValue },
      });
      return { bucket: 'unmatched', applied: false };
    }

    // An already-confirmed link survives re-ingest; refresh the payload and
    // re-apply it to the linked asset.
    if (existing?.matchState === 'MATCHED' && existing.assetId) {
      await tx.discoveredDevice.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date(), payload: device as unknown as Prisma.InputJsonValue },
      });
      await this.applyPayload(tx, companyId, existing.assetId, device, source);
      return { bucket: 'matched', applied: true, assetId: existing.assetId };
    }

    // Classify: exact serial → MATCHED (1) or CONFLICT (2+); hostname == asset
    // name OR asset tag → PROPOSED; otherwise UNMATCHED.
    let matchState: DiscoveryMatchState = 'UNMATCHED';
    let assetId: string | null = null;
    if (serial) {
      const bySerial = await tx.asset.findMany({
        where: {
          companyId,
          deletedAt: null,
          serialNumber: { equals: serial, mode: 'insensitive' },
        },
        select: { id: true },
        take: 2,
      });
      const first = bySerial[0];
      if (first && bySerial.length === 1) {
        matchState = 'MATCHED';
        assetId = first.id;
      } else if (first) {
        // The DB CHECK requires CONFLICT rows to carry a candidate link.
        matchState = 'CONFLICT';
        assetId = first.id;
      }
    }
    if (matchState === 'UNMATCHED' && hostname) {
      // Tag as well as name: fleets routinely use the machine name as the
      // asset tag (this company's entire register does), and a matcher blind
      // to tags sends every laptop to the manual queue for no reason.
      const byName = await tx.asset.findMany({
        where: {
          companyId,
          deletedAt: null,
          OR: [
            { name: { equals: hostname, mode: 'insensitive' } },
            { assetTag: { equals: hostname, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
        take: 2,
      });
      const candidate = byName[0];
      if (candidate && byName.length === 1) {
        matchState = 'PROPOSED';
        assetId = candidate.id;
      }
    }

    const data = {
      externalId: device.externalId ?? null,
      serialNumber: serial,
      hostname,
      source,
      matchState,
      assetId,
      payload: device as unknown as Prisma.InputJsonValue,
      lastSeenAt: new Date(),
    };
    if (existing) {
      await tx.discoveredDevice.update({ where: { id: existing.id }, data });
    } else {
      await tx.discoveredDevice.create({ data: { companyId, ...data } });
    }

    if (matchState === 'MATCHED' && assetId) {
      await this.applyPayload(tx, companyId, assetId, device, source);
      return { bucket: 'matched', applied: true, assetId };
    }
    const bucket =
      matchState === 'PROPOSED' ? 'proposed' : matchState === 'CONFLICT' ? 'conflict' : 'unmatched';
    const becameConflict = matchState === 'CONFLICT' && existing?.matchState !== 'CONFLICT';
    return {
      bucket,
      applied: false,
      ...(becameConflict
        ? { newConflict: { serialNumber: serial, hostname, candidateAssetId: assetId } }
        : {}),
    };
  }

  /**
   * Write the reported hardware/OS/software onto the asset. Only called once a
   * link exists (exact serial or human confirmation) — never for proposals.
   */
  private async applyPayload(
    tx: Tx,
    companyId: string,
    assetId: string,
    device: DiscoveredDeviceInput,
    source: DiscoverySource,
  ) {
    const now = new Date();
    if (device.hardware) {
      const hw = device.hardware;
      const fields = {
        manufacturer: hw.manufacturer ?? null,
        modelName: hw.modelName ?? null,
        cpu: hw.cpu ?? null,
        cpuCores: hw.cpuCores ?? null,
        ramGb: hw.ramGb ?? null,
        ramSlotsUsed: hw.ramSlotsUsed ?? null,
        ramSlotsTotal: hw.ramSlotsTotal ?? null,
        storageTotalGb: hw.storageTotalGb ?? null,
        storageFreeGb: hw.storageFreeGb ?? null,
        smartStatus: hw.smartStatus ?? null,
        batteryHealthPct: hw.batteryHealthPct ?? null,
        batteryCycleCount: hw.batteryCycleCount ?? null,
        gpu: hw.gpu ?? null,
        biosVersion: hw.biosVersion ?? null,
        source,
        lastDiscoveredAt: now,
      };
      await tx.hardwareProfile.upsert({
        where: { assetId },
        create: { companyId, assetId, ...fields },
        update: fields,
      });
    }
    if (device.os) {
      const os = device.os;
      const fields = {
        osName: os.osName ?? null,
        osVersion: os.osVersion ?? null,
        osBuild: os.osBuild ?? null,
        osSupported: os.osSupported ?? null,
        osActivated: os.osActivated ?? null,
        lastBootAt: os.lastBootAt ?? null,
        diskEncrypted: os.diskEncrypted ?? null,
        defenderEnabled: os.defenderEnabled ?? null,
        firewallEnabled: os.firewallEnabled ?? null,
        tpmPresent: os.tpmPresent ?? null,
        localAdminCount: os.localAdminCount ?? null,
        missingCriticalPatches: os.missingCriticalPatches ?? null,
        // v2.76 - only when the report carried the field: an older agent must
        // neither clear a known user nor be read as "nobody signed in".
        ...(os.activeUser !== undefined ? { activeUser: os.activeUser, activeUserAt: now } : {}),
        source,
        lastDiscoveredAt: now,
      };
      await tx.operatingSystemInfo.upsert({
        where: { assetId },
        create: { companyId, assetId, ...fields },
        update: fields,
      });
    }
    if (device.software) {
      // The inventory is a snapshot, not a ledger: replace wholesale.
      await tx.installedSoftware.deleteMany({ where: { assetId } });
      if (device.software.length > 0) {
        await tx.installedSoftware.createMany({
          data: device.software.map((s) => ({
            companyId,
            assetId,
            name: s.name,
            version: s.version ?? null,
            publisher: s.publisher ?? null,
            installedAt: s.installedAt ?? null,
            lastDiscoveredAt: now,
          })),
        });
      }
    }
  }

  // ── review queue ───────────────────────────────────────────────────────────

  async list(actor: AuthUser, query: DiscoveryListQuery) {
    const where: Prisma.DiscoveredDeviceWhereInput = {
      companyId: actor.companyId,
      ...(query.state ? { matchState: query.state } : {}),
    };
    return paginate(query, {
      count: () => this.prisma.client.discoveredDevice.count({ where }),
      findMany: (args) =>
        this.prisma.client.discoveredDevice.findMany({
          where,
          orderBy: { lastSeenAt: 'desc' },
          include: {
            asset: { select: { id: true, assetTag: true, name: true, serialNumber: true } },
          },
          ...args,
        }),
    });
  }

  /** Confirm a PROPOSED/CONFLICT (or UNMATCHED with explicit assetId) link. */
  async confirm(actor: AuthUser, id: string, overrideAssetId?: string | null) {
    const device = await this.findQueueItem(actor, id);
    if (device.matchState === 'MATCHED') {
      throw AppError.conflict('CONFLICT', 'This device is already matched.');
    }
    const assetId = overrideAssetId ?? device.assetId;
    if (!assetId) {
      throw new AppError(
        'VALIDATION_FAILED',
        'This device has no proposed asset - pass assetId to link it explicitly.',
      );
    }
    const asset = await this.prisma.client.asset.findFirst({
      where: { id: assetId, companyId: actor.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!asset) throw AppError.notFound('Asset', assetId);

    const payload = device.payload as unknown as DiscoveredDeviceInput;
    const updated = await this.prisma.client.$transaction(async (raw) => {
      const tx = raw as Tx;
      const row = await tx.discoveredDevice.update({
        where: { id: device.id },
        data: {
          matchState: 'MATCHED',
          assetId,
          reviewedById: actor.id,
          reviewedAt: new Date(),
        },
      });
      await this.applyPayload(tx, actor.companyId, assetId, payload, device.source);
      return row;
    });
    // H4: the confirmed payload changes the health picture.
    await this.health.recomputeForAsset(actor.companyId, assetId);

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.DISCOVERY_REVIEWED,
      entityType: 'DiscoveredDevice',
      entityId: device.id,
      previousValues: { matchState: device.matchState, assetId: device.assetId },
      newValues: { matchState: 'MATCHED', assetId },
    });
    return updated;
  }

  /** Park a queue item. Sticky: re-ingest only refreshes lastSeenAt. */
  async ignore(actor: AuthUser, id: string) {
    const device = await this.findQueueItem(actor, id);
    if (device.matchState === 'MATCHED') {
      throw AppError.conflict(
        'CONFLICT',
        'This device is already matched - unlink is not supported; retire the asset instead.',
      );
    }
    const updated = await this.prisma.client.discoveredDevice.update({
      where: { id: device.id },
      // The state/link CHECK requires IGNORED rows to drop their candidate.
      data: { matchState: 'IGNORED', assetId: null, reviewedById: actor.id, reviewedAt: new Date() },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.DISCOVERY_REVIEWED,
      entityType: 'DiscoveredDevice',
      entityId: device.id,
      previousValues: { matchState: device.matchState, assetId: device.assetId },
      newValues: { matchState: 'IGNORED' },
    });
    return updated;
  }

  private async findQueueItem(actor: AuthUser, id: string) {
    const device = await this.prisma.client.discoveredDevice.findFirst({
      where: { id, companyId: actor.companyId },
    });
    if (!device) throw AppError.notFound('DiscoveredDevice', id);
    return device;
  }
}
