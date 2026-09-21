import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@techpioasset/contracts';
import {
  NOT_VERIFIABLE_STATUSES,
  VERIFICATION_DEDUPE_SECONDS,
  verificationPeriodLabel,
  verificationPeriodStart,
  verificationProgress,
} from '@techpioasset/domain';
import { AuditAction, type AssetStatus } from '@prisma/client';
import { AppError } from '../common/errors/app-error.js';
import { assetScopeFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** How many not-yet-seen units the summary names; the count is always exact. */
const PENDING_LIMIT = 50;

const personName = (
  user: { email: string; profile: { firstName: string; lastName: string } | null } | null,
): string | null =>
  user ? (user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user.email) : null;

/**
 * Physical verification of assets (v2.72) - "I stood in front of this unit and
 * it was there".
 *
 * The owner asked for a verification round on the phone: scan each label as
 * you walk the floor, and watch "142 of 168 verified" climb. Recording one
 * changes nothing about the asset; it adds a row an auditor can read. Who may
 * record, which units a round expects to find, and what a round is (the
 * calendar quarter) are the domain's rules in asset-verification.ts, shared
 * with the web and the phone.
 */
@Injectable()
export class AssetVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The most recent confirmation of one asset, or null. */
  async latestFor(assetId: string) {
    const row = await this.prisma.client.assetVerification.findFirst({
      where: { assetId },
      orderBy: { verifiedAt: 'desc' },
      select: {
        id: true,
        verifiedAt: true,
        method: true,
        note: true,
        verifiedBy: {
          select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!row) return null;
    const { verifiedBy, ...rest } = row;
    return { ...rest, by: personName(verifiedBy), byId: verifiedBy?.id ?? null };
  }

  /**
   * Record that the caller has seen this asset. 404, not 403, outside the
   * caller's scope - the same answer a QR lookup gives, so a label from another
   * office or tenant says nothing about what it belongs to.
   *
   * A second confirmation of the same unit by the same person inside two
   * minutes answers with the first: a label held under the camera scans more
   * than once, and a round with forty duplicates proves less, not more.
   */
  async verify(actor: AuthUser, assetId: string, input: { note?: string | null; method?: string }) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id: assetId, ...assetScopeFilter(actor) },
      select: { id: true, assetTag: true, status: true },
    });
    if (!asset) throw AppError.notFound('Asset', assetId);

    if ((NOT_VERIFIABLE_STATUSES as readonly string[]).includes(asset.status)) {
      throw new AppError('VALIDATION_FAILED', 'This asset is not part of a verification round', {
        detail:
          'It is recorded as disposed, donated, retired, lost or stolen. If it is in front of ' +
          'you, correct its status first.',
      });
    }

    const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;
    const recent = await this.prisma.client.assetVerification.findFirst({
      where: {
        assetId,
        verifiedById: actor.id,
        verifiedAt: { gte: new Date(Date.now() - VERIFICATION_DEDUPE_SECONDS * 1000) },
      },
      orderBy: { verifiedAt: 'desc' },
      select: { id: true, verifiedAt: true },
    });
    if (recent && !note) {
      return { id: recent.id, verifiedAt: recent.verifiedAt, assetId, duplicate: true };
    }

    const created = await this.prisma.client.assetVerification.create({
      data: {
        companyId: actor.companyId,
        assetId,
        verifiedById: actor.id,
        method: input.method === 'MANUAL' ? 'MANUAL' : 'SCAN',
        note,
      },
      select: { id: true, verifiedAt: true },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_UPDATED,
      entityType: 'Asset',
      entityId: assetId,
      newValues: { physicallyVerified: true, asset: asset.assetTag, ...(note ? { note } : {}) },
    });

    return { id: created.id, verifiedAt: created.verifiedAt, assetId, duplicate: false };
  }

  /**
   * Where the current round stands for everything the caller may see: how many
   * units it expects, how many have been seen since the quarter began, and the
   * first few that have not.
   */
  async summary(actor: AuthUser) {
    const now = new Date();
    const since = verificationPeriodStart(now);
    const expected = {
      AND: [
        assetScopeFilter(actor),
        { status: { notIn: [...NOT_VERIFIABLE_STATUSES] as AssetStatus[] } },
      ],
    };
    const seen = { verifications: { some: { verifiedAt: { gte: since } } } };

    const [total, verified, pending] = await Promise.all([
      this.prisma.client.asset.count({ where: expected }),
      this.prisma.client.asset.count({ where: { AND: [expected, seen] } }),
      this.prisma.client.asset.findMany({
        where: { AND: [expected, { NOT: seen }] },
        orderBy: [{ name: 'asc' }, { assetTag: 'asc' }],
        take: PENDING_LIMIT,
        select: {
          id: true,
          name: true,
          assetTag: true,
          status: true,
          office: { select: { name: true } },
          assignedUser: {
            select: { email: true, profile: { select: { firstName: true, lastName: true } } },
          },
        },
      }),
    ]);

    return {
      period: { label: verificationPeriodLabel(now), since },
      ...verificationProgress(total, verified),
      pendingShown: pending.length,
      pendingAssets: pending.map(({ assignedUser, office, ...asset }) => ({
        ...asset,
        office: office?.name ?? null,
        holder: personName(assignedUser),
      })),
    };
  }
}
