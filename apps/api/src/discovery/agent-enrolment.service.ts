import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type {
  AgentEnrolInput,
  AuthUser,
  EnrolmentTokenSecret,
  EnrolmentTokenStatus,
  EnrolmentTokenUnrevealableReason,
} from '@techpioasset/contracts';
import {
  AGENT_DEVICE_TYPES,
  LATEST_AGENT_VERSION,
  buildAgentInstallCommand,
  coverageSummary,
  notEnrolledDevices,
  deriveAgentStatus,
  isAgentOutdated,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { AppConfig } from '../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { decryptLicenseKey, encryptLicenseKey } from '../licenses/license-key.util.js';

/** A superseded device credential is accepted at most this long after rotation. */
export const PREVIOUS_DEVICE_TOKEN_MAX_AGE_MS = 14 * 86_400_000;
/** At most one rejection write per laptop in this window - a retry storm is one event. */
export const REJECTION_WRITE_INTERVAL_MS = 10 * 60_000;

const UNREVEALABLE_MESSAGES: Record<EnrolmentTokenUnrevealableReason, string> = {
  LEGACY_HASH_ONLY:
    'This token was created before tokens could be shown again. Replace it once to get a token you can view any time.',
  ENCRYPTION_NOT_CONFIGURED: 'Show is unavailable — encryption key not configured',
  KEY_CHANGED:
    'This token can no longer be decrypted (the server encryption key changed). Replace it to get a token you can view.',
};

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The company enrolment token and the device credentials it mints.
 *
 * History that shaped this: the token used to be shown once and stored only
 * as a hash, so admins who lost it generated another - which silently broke
 * every installer carrying the old one (six rotations in production). It is
 * now stored encrypted as well, revealable on an audited Show, created only
 * once, and REPLACED deliberately with a grace period for the old one.
 */
@Injectable()
export class AgentEnrolmentService {
  private readonly logger = new Logger(AgentEnrolmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  // ── the company enrolment token ────────────────────────────────────────────

  async getStatus(actor: AuthUser): Promise<EnrolmentTokenStatus> {
    const row = await this.findToken(actor.companyId);
    if (!row) {
      return {
        exists: false,
        createdAt: null,
        createdBy: null,
        lastUsedAt: null,
        revealable: false,
        unrevealableReason: null,
        unrevealableMessage: null,
        graceToken: null,
      };
    }
    const reason = this.unrevealableReason(row.tokenCiphertext);
    const creator = row.createdById
      ? await this.prisma.client.user.findFirst({
          where: { id: row.createdById, companyId: actor.companyId },
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true, displayName: true } },
          },
        })
      : null;
    return {
      exists: true,
      createdAt: row.createdAt.toISOString(),
      createdBy: creator
        ? {
            id: creator.id,
            name:
              creator.profile?.displayName ||
              [creator.profile?.firstName, creator.profile?.lastName].filter(Boolean).join(' ') ||
              creator.email,
          }
        : null,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      revealable: reason === null,
      unrevealableReason: reason,
      unrevealableMessage: reason ? UNREVEALABLE_MESSAGES[reason] : null,
      graceToken:
        row.graceTokenHash && row.graceExpiresAt && row.graceExpiresAt > new Date()
          ? { expiresAt: row.graceExpiresAt.toISOString() }
          : null,
    };
  }

  /** Create-only: a second Generate must never silently replace the token. */
  async create(actor: AuthUser): Promise<EnrolmentTokenSecret> {
    const existing = await this.findToken(actor.companyId);
    if (existing) throw this.alreadyExists();

    const token = this.newEnrolmentToken();
    try {
      await this.prisma.client.agentEnrolmentToken.create({
        data: {
          companyId: actor.companyId,
          tokenHash: sha256(token),
          tokenCiphertext: this.encrypt(token),
          createdById: actor.id,
        },
      });
    } catch (error) {
      // Two admins clicking Generate at once: companyId is unique.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.alreadyExists();
      }
      throw error;
    }
    await this.recordAudit(actor, 'created');
    return { token, installCommand: this.installCommand(token) };
  }

  async reveal(actor: AuthUser): Promise<EnrolmentTokenSecret> {
    const row = await this.findToken(actor.companyId);
    if (!row) throw AppError.notFound('Enrolment token');
    const reason = this.unrevealableReason(row.tokenCiphertext);
    if (reason === 'ENCRYPTION_NOT_CONFIGURED') {
      throw new AppError('DEPENDENCY_UNAVAILABLE', UNREVEALABLE_MESSAGES[reason]);
    }
    if (reason) throw AppError.conflict('CONFLICT', UNREVEALABLE_MESSAGES[reason]);

    const token = decryptLicenseKey(row.tokenCiphertext!, this.secret()!);
    // Audited without the secret: who looked, and when, is the whole record.
    await this.recordAudit(actor, 'revealed');
    return { token, installCommand: this.installCommand(token) };
  }

  /**
   * New token; the old one keeps enrolling for `graceDays` (0 = retired now).
   * Only one grace token is kept - replacing twice drops the oldest.
   */
  async replace(actor: AuthUser, graceDays: number): Promise<EnrolmentTokenSecret> {
    const existing = await this.findToken(actor.companyId);
    if (!existing) return this.create(actor);

    const token = this.newEnrolmentToken();
    const graceExpiresAt = graceDays > 0 ? new Date(Date.now() + graceDays * 86_400_000) : null;
    await this.prisma.client.agentEnrolmentToken.update({
      where: { id: existing.id },
      data: {
        tokenHash: sha256(token),
        tokenCiphertext: this.encrypt(token),
        createdById: actor.id,
        createdAt: new Date(),
        lastUsedAt: null,
        graceTokenHash: graceExpiresAt ? existing.tokenHash : null,
        graceExpiresAt,
      },
    });
    await this.recordAudit(actor, 'replaced', {
      graceDays,
      graceExpiresAt: graceExpiresAt?.toISOString() ?? null,
    });
    return { token, installCommand: this.installCommand(token) };
  }

  /** Revokes the current AND any grace token. Enrolled laptops keep reporting. */
  async revoke(actor: AuthUser): Promise<void> {
    const { count } = await this.prisma.client.agentEnrolmentToken.deleteMany({
      where: { companyId: actor.companyId },
    });
    if (count > 0) await this.recordAudit(actor, 'revoked');
  }

  // ── device credentials ─────────────────────────────────────────────────────

  /**
   * Exchanges the enrolment token (current, or an unexpired grace token) for a
   * device credential. Re-enrolling a machine rotates its credential, but the
   * one it replaces stays valid until the new one is used - a laptop that
   * failed to save its new credential must not be locked out by the attempt.
   */
  async enrolAgent(enrolmentToken: string, input: AgentEnrolInput) {
    const tokenHash = sha256(enrolmentToken);
    const now = new Date();
    const enrolment = await this.prisma.client.agentEnrolmentToken.findFirst({
      where: {
        OR: [{ tokenHash }, { graceTokenHash: tokenHash, graceExpiresAt: { gt: now } }],
      },
      select: { companyId: true, id: true, tokenHash: true },
    });
    if (!enrolment) {
      // v2.77 - say WHY, in words the installer prints: an old install
      // command someone kept from an earlier batch is the common case, and
      // "invalid token" sent them looking for a network problem.
      const replaced = await this.prisma.client.agentEnrolmentToken.findFirst({
        where: { graceTokenHash: tokenHash },
        select: { graceExpiresAt: true },
      });
      throw new AppError('UNAUTHENTICATED', 'This install command is out of date', {
        detail: replaced
          ? `Its enrolment token was replaced${replaced.graceExpiresAt ? ` and stopped working on ${replaced.graceExpiresAt.toISOString().slice(0, 10)}` : ''}. ` +
            'Copy the current install command from Discovery -> Agents in PioAssets and run that instead.'
          : 'Its enrolment token is not one PioAssets currently accepts. Copy the current install command ' +
            'from Discovery -> Agents in PioAssets and run that instead.',
      });
    }

    const deviceToken = `tad_${randomBytes(32).toString('base64url')}`;
    const deviceHash = sha256(deviceToken);

    const existing = await this.prisma.client.deviceAgent.findUnique({
      where: {
        companyId_machineId: { companyId: enrolment.companyId, machineId: input.machineId },
      },
      select: {
        id: true,
        tokenHash: true,
        revokedAt: true,
        previousTokenHash: true,
        previousTokenRotatedAt: true,
      },
    });

    const details = {
      hostname: input.hostname ?? null,
      serialNumber: input.serialNumber ?? null,
      platform: input.platform ?? null,
      agentVersion: input.agentVersion ?? null,
    };

    if (existing) {
      const pendingPrevious =
        existing.previousTokenHash &&
        existing.previousTokenRotatedAt &&
        now.getTime() - existing.previousTokenRotatedAt.getTime() <
          PREVIOUS_DEVICE_TOKEN_MAX_AGE_MS;
      // Which credential to keep as "previous":
      // - revoked laptop: none - a revoked credential must not come back to life;
      // - a previous is still pending (the rotated-to credential was never
      //   used): keep it, it is the older one the laptop may still hold;
      // - otherwise: the credential being replaced.
      const previous = existing.revokedAt
        ? { previousTokenHash: null, previousTokenRotatedAt: null }
        : pendingPrevious
          ? {
              previousTokenHash: existing.previousTokenHash,
              // Not reset: repeated re-enrolment must not keep an old
              // credential alive past its maximum age.
              previousTokenRotatedAt: existing.previousTokenRotatedAt,
            }
          : { previousTokenHash: existing.tokenHash, previousTokenRotatedAt: now };
      await this.prisma.client.deviceAgent.update({
        where: { id: existing.id },
        data: { tokenHash: deviceHash, ...details, ...previous, revokedAt: null, lastSeenAt: now },
      });
    } else {
      await this.prisma.client.deviceAgent.create({
        data: {
          companyId: enrolment.companyId,
          machineId: input.machineId,
          tokenHash: deviceHash,
          ...details,
          lastSeenAt: now,
        },
      });
    }

    // "Last used" describes the CURRENT token; a grace-token enrolment is not it.
    if (enrolment.tokenHash === tokenHash) {
      await this.prisma.client.agentEnrolmentToken.update({
        where: { id: enrolment.id },
        data: { lastUsedAt: now },
      });
    }

    return { deviceToken };
  }

  /**
   * Resolves a presented device credential, or null. Accepts the current
   * credential (clearing any pending previous one - the rotation is proven)
   * or, until it ages out, the previous one.
   */
  async authenticateDevice(token: string) {
    const tokenHash = sha256(token);
    const select = {
      id: true,
      companyId: true,
      machineId: true,
      revokedAt: true,
      previousTokenHash: true,
      previousTokenRotatedAt: true,
    } as const;
    const now = new Date();

    const current = await this.prisma.client.deviceAgent.findUnique({
      where: { tokenHash },
      select,
    });
    if (current) {
      if (current.revokedAt) return null;
      await this.prisma.client.deviceAgent.update({
        where: { id: current.id },
        data: {
          lastSeenAt: now,
          ...(current.previousTokenHash
            ? { previousTokenHash: null, previousTokenRotatedAt: null }
            : {}),
        },
      });
      return current;
    }

    const byPrevious = await this.prisma.client.deviceAgent.findMany({
      where: { previousTokenHash: tokenHash },
      select,
      take: 2,
    });
    const previous = byPrevious.length === 1 ? byPrevious[0] : null;
    if (
      !previous ||
      previous.revokedAt ||
      !previous.previousTokenRotatedAt ||
      now.getTime() - previous.previousTokenRotatedAt.getTime() > PREVIOUS_DEVICE_TOKEN_MAX_AGE_MS
    ) {
      return null;
    }
    await this.prisma.client.deviceAgent.update({
      where: { id: previous.id },
      data: { lastSeenAt: now },
    });
    return previous;
  }

  /**
   * Records a refused report against its laptop so the portal can say
   * "credential rejected" instead of "offline". The identifier comes from an
   * UNAUTHENTICATED request, so it is trusted for exactly one thing - bumping
   * lastRejectedAt/rejectCount - and only when it names exactly one enrolled
   * laptop across every tenant. Never throws, returns nothing: the caller's
   * 401 is identical whether or not anything matched.
   *
   * machineId (body or x-agent-machine-id header) is preferred; agent v1.0.0
   * sends neither, so a serial number that matches exactly one laptop is the
   * fallback - the 26 laptops refused today run v1.0.0.
   */
  async recordRejection(identity: { machineId?: unknown; serialNumber?: unknown }): Promise<void> {
    try {
      const machineId = cleanIdentifier(identity.machineId, 8);
      const serialNumber = cleanIdentifier(identity.serialNumber, 4);
      const where = machineId ? { machineId } : serialNumber ? { serialNumber } : null;
      if (!where) return;

      const matches = await this.prisma.client.deviceAgent.findMany({
        where,
        select: { id: true },
        take: 2,
      });
      if (matches.length !== 1) return;

      const cutoff = new Date(Date.now() - REJECTION_WRITE_INTERVAL_MS);
      // Conditional in the UPDATE itself so concurrent retries cannot double-count.
      await this.prisma.client.deviceAgent.updateMany({
        where: {
          id: matches[0]!.id,
          OR: [{ lastRejectedAt: null }, { lastRejectedAt: { lt: cutoff } }],
        },
        data: { lastRejectedAt: new Date(), rejectCount: { increment: 1 } },
      });
    } catch (error) {
      this.logger.warn(`Could not record a rejected agent report: ${(error as Error).message}`);
    }
  }

  /** Enrolled laptops, for the admin view. Never exposes a credential. */
  async listAgents(actor: AuthUser) {
    const rows = await this.prisma.client.deviceAgent.findMany({
      where: { companyId: actor.companyId },
      orderBy: [{ revokedAt: 'asc' }, { lastSeenAt: 'desc' }],
      take: 500,
      select: {
        id: true,
        machineId: true,
        hostname: true,
        serialNumber: true,
        platform: true,
        agentVersion: true,
        enrolledAt: true,
        lastSeenAt: true,
        revokedAt: true,
        lastRejectedAt: true,
        rejectCount: true,
      },
    });
    const now = new Date();
    return rows.map((row) => ({
      ...row,
      status: deriveAgentStatus(row, now),
      updateAvailable: isAgentOutdated(row.agentVersion),
      latestAgentVersion: LATEST_AGENT_VERSION,
    }));
  }

  /**
   * Register laptops, desktops and servers that no live agent has reported
   * (v2.77): the rollout's to-do list. Matching is by serial number, as the
   * discovery matcher does; the rule is the domain's notEnrolledDevices.
   */
  async listNotEnrolled(actor: AuthUser) {
    const [assets, agents] = await Promise.all([
      this.prisma.client.asset.findMany({
        where: {
          companyId: actor.companyId,
          deletedAt: null,
          status: { notIn: ['DISPOSED', 'DONATED', 'RETIRED', 'LOST', 'STOLEN'] },
          subcategory: { key: { in: [...AGENT_DEVICE_TYPES] } },
        },
        orderBy: [{ name: 'asc' }, { assetTag: 'asc' }],
        take: 1000,
        select: {
          id: true,
          name: true,
          assetTag: true,
          serialNumber: true,
          subcategory: { select: { key: true } },
          assignedUser: {
            select: { email: true, profile: { select: { firstName: true, lastName: true } } },
          },
        },
      }),
      this.prisma.client.deviceAgent.findMany({
        where: { companyId: actor.companyId },
        select: { serialNumber: true, revokedAt: true },
      }),
    ]);
    const rows = notEnrolledDevices(
      assets.map((a) => ({
        id: a.id,
        name: a.name,
        assetTag: a.assetTag,
        serialNumber: a.serialNumber,
        subcategoryKey: a.subcategory?.key ?? null,
        holder: a.assignedUser
          ? a.assignedUser.profile
            ? `${a.assignedUser.profile.firstName} ${a.assignedUser.profile.lastName}`
            : a.assignedUser.email
          : null,
      })),
      agents,
    );
    return {
      total: assets.length,
      notEnrolled: rows.length,
      summary: coverageSummary(rows.length, assets.length),
      rows,
    };
  }

  async revokeAgent(actor: AuthUser, id: string): Promise<void> {
    const agent = await this.prisma.client.deviceAgent.findFirst({
      where: { id, companyId: actor.companyId },
      select: { id: true },
    });
    if (!agent) throw AppError.notFound('Device agent', id);
    // Revoked, not deleted: the enrolment history stays readable.
    await this.prisma.client.deviceAgent.update({
      where: { id },
      data: { revokedAt: new Date(), previousTokenHash: null, previousTokenRotatedAt: null },
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private findToken(companyId: string) {
    return this.prisma.client.agentEnrolmentToken.findUnique({ where: { companyId } });
  }

  private newEnrolmentToken(): string {
    return `tae_${randomBytes(32).toString('base64url')}`;
  }

  /** Same key and layout as licence keys; absent key => hash-only, not failure. */
  private secret(): string | undefined {
    return this.config.get('LICENSE_KEY_SECRET') || undefined;
  }

  private encrypt(token: string): string | null {
    const secret = this.secret();
    return secret ? encryptLicenseKey(token, secret) : null;
  }

  private unrevealableReason(ciphertext: string | null): EnrolmentTokenUnrevealableReason | null {
    const secret = this.secret();
    if (!secret) return 'ENCRYPTION_NOT_CONFIGURED';
    if (!ciphertext) return 'LEGACY_HASH_ONLY';
    try {
      decryptLicenseKey(ciphertext, secret);
      return null;
    } catch {
      return 'KEY_CHANGED';
    }
  }

  private installCommand(token: string): string {
    return buildAgentInstallCommand({
      scriptUrl: `${this.config.get('WEB_URL').replace(/\/$/, '')}/downloads/TechpioAgent.ps1`,
      portalUrl: `${this.config.get('API_URL').replace(/\/$/, '')}/api/v1`,
      enrolmentToken: token,
    });
  }

  private alreadyExists(): AppError {
    return AppError.conflict('CONFLICT', 'A token already exists — use Show, or Replace token');
  }

  private recordAudit(actor: AuthUser, event: string, extra: Record<string, unknown> = {}) {
    return this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'AgentEnrolmentToken',
      entityId: actor.companyId,
      newValues: { event, ...extra } as Prisma.InputJsonValue,
    });
  }
}

function cleanIdentifier(value: unknown, minLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= minLength && trimmed.length <= 200 ? trimmed : null;
}
