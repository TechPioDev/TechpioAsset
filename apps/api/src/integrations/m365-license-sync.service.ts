import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type { AuthUser, SaveM365ConnectionInput } from '@techpioasset/contracts';
import {
  deriveLicenseStatus,
  m365SeatsReserved,
  normalizeM365Subscriptions,
  planM365Sync,
  type M365License,
  type M365Skipped,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { MfaService } from '../auth/mfa.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  M365ConnectionError,
  M365GraphClient,
  type M365Credentials,
} from '../providers/m365/m365-graph.client.js';

/**
 * Mirrors a company's Microsoft 365 subscriptions into Licences (v3.12).
 *
 * WHAT IT WRITES, AND WHAT IT NEVER DOES
 *
 * For each subscription Microsoft lists it keeps one licence, matched by SKU
 * id: the name, the seats owned, the seats in use, the renewal date and
 * Microsoft's status. It writes into the same structure hand-entered licences
 * use - one licence, one "Default Pool" whose counter is the seats in use - so
 * the list, the detail page, the dashboard tiles and the phone app all show a
 * synced licence correctly without knowing it is one.
 *
 * It never writes COST. Microsoft does not expose price through this route,
 * and the owner's rule is that only Finance and admins enter purchase cost. A
 * cost somebody typed on a synced licence survives every sync untouched, as do
 * its vendor, notes and invoice.
 *
 * It never DELETES. A subscription Microsoft stops listing is retired, with
 * its history intact; if it comes back, the same record is revived.
 *
 * And it never writes from a partial read. Both of Microsoft's lists arrive or
 * the run fails and says why, on the Integrations screen, to the person who
 * can fix it.
 */

export const M365_SOURCE = 'M365';

export interface M365SyncSummary {
  /** Subscriptions recorded as licences after this run. */
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  retired: number;
  revived: number;
  /** Products Microsoft listed that are deliberately not recorded. */
  skipped: { free: number; empty: number; notPerUser: number; deleted: number };
  /** Licences where Microsoft reports more seats in use than owned. */
  overAssigned: { name: string; by: number }[];
}

const countSkipped = (skipped: M365Skipped[]) => ({
  free: skipped.filter((s) => s.reason === 'free').length,
  empty: skipped.filter((s) => s.reason === 'empty').length,
  notPerUser: skipped.filter((s) => s.reason === 'not-per-user').length,
  deleted: skipped.filter((s) => s.reason === 'deleted').length,
});

@Injectable()
export class M365LicenseSyncService {
  private readonly logger = new Logger(M365LicenseSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
    private readonly graph: M365GraphClient,
  ) {}

  // ── the connection ─────────────────────────────────────────────────────────

  /** What the Integrations screen shows. The secret is never part of it. */
  async status(companyId: string) {
    const [connection, licences] = await Promise.all([
      this.prisma.client.m365Connection.findUnique({
        where: { companyId },
        select: {
          tenantId: true,
          clientId: true,
          lastSyncAt: true,
          lastSyncStatus: true,
          lastSyncMessage: true,
          lastSyncSummary: true,
          updatedAt: true,
        },
      }),
      this.prisma.client.softwareLicense.count({
        where: { companyId, externalSource: M365_SOURCE, status: { not: 'RETIRED' } },
      }),
    ]);
    return {
      connected: connection !== null,
      tenantId: connection?.tenantId ?? null,
      clientId: connection?.clientId ?? null,
      // Said, never shown: the screen can tell a secret is stored without the
      // API ever being able to hand it back.
      hasSecret: connection !== null,
      lastSyncAt: connection?.lastSyncAt ?? null,
      lastSyncStatus: connection?.lastSyncStatus ?? null,
      lastSyncMessage: connection?.lastSyncMessage ?? null,
      lastSyncSummary: (connection?.lastSyncSummary as M365SyncSummary | null) ?? null,
      licences,
    };
  }

  async save(actor: AuthUser, input: SaveM365ConnectionInput) {
    const existing = await this.prisma.client.m365Connection.findUnique({
      where: { companyId: actor.companyId },
      select: { id: true, clientSecretEncrypted: true },
    });
    if (!existing && !input.clientSecret) {
      throw new AppError('VALIDATION_FAILED', 'Enter the client secret to connect.');
    }
    // Leaving the secret blank on an update keeps the stored one, so changing
    // a tenant ID does not mean fetching the secret out of Entra again.
    const clientSecretEncrypted = input.clientSecret
      ? this.mfa.encryptSecret(input.clientSecret)
      : existing!.clientSecretEncrypted;

    await this.prisma.client.m365Connection.upsert({
      where: { companyId: actor.companyId },
      create: {
        companyId: actor.companyId,
        tenantId: input.tenantId,
        clientId: input.clientId,
        clientSecretEncrypted,
        updatedById: actor.id,
      },
      update: {
        tenantId: input.tenantId,
        clientId: input.clientId,
        clientSecretEncrypted,
        updatedById: actor.id,
        // New details invalidate the old verdict: "last sync ok" would be a
        // statement about credentials that are no longer the ones stored.
        lastSyncStatus: null,
        lastSyncMessage: null,
      },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'M365Connection',
      entityId: actor.companyId,
      // That it changed, and which tenant - never the secret, nor whether one
      // was supplied this time.
      newValues: { m365Licences: existing ? 'updated' : 'connected', tenantId: input.tenantId },
    });
    return this.status(actor.companyId);
  }

  /**
   * Stops syncing. The licences already recorded stay exactly as they are:
   * they were true when read, and removing them would take the cost and notes
   * people added along with them.
   */
  async disconnect(actor: AuthUser) {
    const removed = await this.prisma.client.m365Connection.deleteMany({
      where: { companyId: actor.companyId },
    });
    if (removed.count > 0) {
      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.SETTING_CHANGED,
        entityType: 'M365Connection',
        entityId: actor.companyId,
        newValues: { m365Licences: 'disconnected' },
      });
    }
    return this.status(actor.companyId);
  }

  /** Reads from Microsoft and reports what a sync WOULD record. Writes nothing. */
  async test(actor: AuthUser) {
    const credentials = await this.credentials(actor.companyId);
    try {
      const data = await this.graph.fetchSubscriptions(credentials);
      const { licenses, skipped } = normalizeM365Subscriptions(data.skus, data.subscriptions);
      return {
        ok: true as const,
        licences: licenses.map((l) => ({
          name: l.name,
          seatsPurchased: l.seatsPurchased,
          seatsUsed: l.seatsUsed,
          renewalDate: l.renewalDate,
        })),
        skipped: countSkipped(skipped),
      };
    } catch (error) {
      return { ok: false as const, message: this.explain(error) };
    }
  }

  // ── the sync ───────────────────────────────────────────────────────────────

  /** Run by a person from the Integrations screen. Failures are theirs to see. */
  async syncNow(actor: AuthUser): Promise<M365SyncSummary> {
    try {
      return await this.sync(actor.companyId, actor.id);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DEPENDENCY_UNAVAILABLE', this.explain(error));
    }
  }

  /** Run by the nightly sweep, for every company that has connected. */
  async syncAllConnected(): Promise<{ companies: number; failed: number }> {
    const connections = await this.prisma.client.m365Connection.findMany({
      select: { companyId: true },
    });
    let failed = 0;
    for (const { companyId } of connections) {
      try {
        await this.sync(companyId, null);
      } catch (error) {
        // One company's expired secret must not stop the next company's sync.
        // The failure is already recorded on that company's connection.
        failed += 1;
        this.logger.warn(
          `Microsoft 365 licence sync failed for ${companyId}: ${this.explain(error)}`,
        );
      }
    }
    return { companies: connections.length, failed };
  }

  private async sync(companyId: string, actorId: string | null): Promise<M365SyncSummary> {
    const connection = await this.prisma.client.m365Connection.findUnique({
      where: { companyId },
      select: { id: true, updatedById: true },
    });
    if (!connection) {
      throw new AppError('VALIDATION_FAILED', 'Microsoft 365 is not connected yet.');
    }
    const now = new Date();

    try {
      const credentials = await this.credentials(companyId);
      const data = await this.graph.fetchSubscriptions(credentials);
      const { licenses, skipped } = normalizeM365Subscriptions(data.skus, data.subscriptions);

      // Alerts about a synced licence go to whoever set the connection up -
      // the sweep notifies a licence's creator, and "nobody" would mean a
      // subscription could lapse with the warning addressed to no one.
      const ownerId = actorId ?? connection.updatedById;
      const summary = await this.apply(companyId, ownerId, licenses, skipped, now);

      await this.prisma.client.m365Connection.update({
        where: { companyId },
        data: {
          lastSyncAt: now,
          lastSyncStatus: 'ok',
          lastSyncMessage: null,
          lastSyncSummary: summary as unknown as Prisma.InputJsonValue,
        },
      });
      if (summary.created + summary.updated + summary.retired > 0) {
        await this.audit.record({
          companyId,
          actorId,
          action: AuditAction.LICENSE_UPDATED,
          entityType: 'M365Connection',
          entityId: connection.id,
          newValues: {
            source: M365_SOURCE,
            created: summary.created,
            updated: summary.updated,
            retired: summary.retired,
            revived: summary.revived,
          },
        });
      }
      return summary;
    } catch (error) {
      // Recorded where the person who can fix it will look. `lastSyncAt` is
      // left alone on purpose: it is the last time the data was actually read,
      // and a failed attempt did not read it.
      await this.prisma.client.m365Connection
        .update({
          where: { companyId },
          data: { lastSyncStatus: 'failed', lastSyncMessage: this.explain(error) },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  private async apply(
    companyId: string,
    ownerId: string | null,
    licenses: M365License[],
    skipped: M365Skipped[],
    now: Date,
  ): Promise<M365SyncSummary> {
    return this.prisma.client.$transaction(async (tx) => {
      const held = await tx.softwareLicense.findMany({
        where: { companyId, externalSource: M365_SOURCE },
        select: {
          id: true,
          externalId: true,
          name: true,
          seatsPurchased: true,
          externalSeatsUsed: true,
          renewalDate: true,
          expiryDate: true,
          externalStatus: true,
          status: true,
        },
      });

      const plan = planM365Sync(
        held
          .filter((h): h is typeof h & { externalId: string } => h.externalId !== null)
          .map((h) => ({
            id: h.id,
            externalId: h.externalId,
            name: h.name,
            seatsPurchased: h.seatsPurchased,
            seatsUsed: h.externalSeatsUsed,
            renewalDate: h.renewalDate,
            externalStatus: h.externalStatus,
            retired: h.status === 'RETIRED',
          })),
        licenses,
      );
      const heldById = new Map(held.map((h) => [h.id, h]));

      for (const l of plan.create) {
        const { reserved } = m365SeatsReserved(l);
        const created = await tx.softwareLicense.create({
          data: {
            companyId,
            name: l.name,
            family: l.family,
            subscriptionType: 'SUBSCRIPTION',
            // Microsoft's own code, verbatim, so the exact product is always
            // identifiable even where the friendly name is a best effort.
            edition: l.partNumber,
            // Microsoft gives no date for some products. The day it was first
            // seen is the honest stand-in, not a guess at when it was bought.
            purchaseDate: l.purchaseDate ?? now,
            expiryDate: l.renewalDate,
            renewalDate: l.renewalDate,
            seatsPurchased: l.seatsPurchased,
            unitOfAssignment: 'USER',
            status: deriveLicenseStatus(l.renewalDate, now),
            externalSource: M365_SOURCE,
            externalId: l.externalId,
            externalSeatsUsed: l.seatsUsed,
            externalStatus: l.status,
            externalSyncedAt: now,
            createdById: ownerId,
            updatedById: ownerId,
          },
          select: { id: true },
        });
        await tx.seatPool.create({
          data: {
            companyId,
            licenseId: created.id,
            name: 'Default Pool',
            seatsAllocated: l.seatsPurchased,
            seatsReserved: reserved,
            createdById: ownerId,
          },
        });
      }

      let updated = 0;
      let revived = 0;
      for (const u of plan.update) {
        const before = heldById.get(u.id)!;
        const l = u.license;
        const { reserved } = m365SeatsReserved(l);

        await tx.softwareLicense.update({
          where: { id: u.id },
          data: {
            name: l.name,
            edition: l.partNumber,
            expiryDate: l.renewalDate,
            renewalDate: l.renewalDate,
            seatsPurchased: l.seatsPurchased,
            // Revived, or simply following the calendar. A licence somebody
            // retired by hand is revived too: Microsoft says it is owned.
            status: deriveLicenseStatus(l.renewalDate, now),
            externalSeatsUsed: l.seatsUsed,
            externalStatus: l.status,
            externalSyncedAt: now,
          },
        });
        // One statement sets both numbers, so the rule that the counter never
        // exceeds the allocation is checked against the final row and a
        // shrinking subscription cannot trip it half-way.
        await tx.seatPool.updateMany({
          where: { licenseId: u.id },
          data: { seatsAllocated: l.seatsPurchased, seatsReserved: reserved },
        });

        if (u.seatsDelta !== 0) {
          // Seat changes are history, not an overwrite: the renewal log is
          // append-only for hand-entered licences and is here too.
          await tx.licenseRenewal.create({
            data: {
              companyId,
              licenseId: u.id,
              renewedAt: now,
              previousExpiry: before.expiryDate,
              newExpiry: l.renewalDate,
              seatsDelta: u.seatsDelta,
              notes: `Seat count changed in Microsoft 365 (${before.seatsPurchased} to ${l.seatsPurchased}).`,
            },
          });
        }
        if (u.changed) updated += 1;
        if (u.revived) revived += 1;
      }

      for (const r of plan.retire) {
        await tx.softwareLicense.update({
          where: { id: r.id },
          data: { status: 'RETIRED', externalStatus: 'Removed', externalSyncedAt: now },
        });
      }

      return {
        total: licenses.length,
        created: plan.create.length,
        updated,
        unchanged: plan.update.length - updated,
        retired: plan.retire.length,
        revived,
        skipped: countSkipped(skipped),
        overAssigned: licenses
          .map((l) => ({ name: l.name, by: m365SeatsReserved(l).overAssignedBy }))
          .filter((o) => o.by > 0),
      };
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async credentials(companyId: string): Promise<M365Credentials> {
    const connection = await this.prisma.client.m365Connection.findUnique({
      where: { companyId },
      select: { tenantId: true, clientId: true, clientSecretEncrypted: true },
    });
    if (!connection) {
      throw new AppError('VALIDATION_FAILED', 'Microsoft 365 is not connected yet.');
    }
    const clientSecret = this.mfa.decryptSecret(connection.clientSecretEncrypted);
    if (!clientSecret) {
      // The server's encryption key changed, or the row was edited by hand.
      throw new AppError(
        'DEPENDENCY_UNAVAILABLE',
        'The stored client secret can no longer be read. Enter it again on the Integrations screen.',
      );
    }
    return { tenantId: connection.tenantId, clientId: connection.clientId, clientSecret };
  }

  /** A sentence for a settings screen. Never a stack trace, never a secret. */
  private explain(error: unknown): string {
    if (error instanceof M365ConnectionError || error instanceof AppError) return error.message;
    this.logger.error('Unexpected Microsoft 365 sync failure', error as Error);
    return 'The sync stopped on an unexpected error. Nothing was changed; the details are in the server log.';
  }
}
