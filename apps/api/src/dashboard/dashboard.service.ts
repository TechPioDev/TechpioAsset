import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@techpioasset/contracts';
import { DEFAULT_VENDOR_OFFER_POLICY, PERMISSIONS } from '@techpioasset/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { assetScopeFilter, tenantFilter } from '../common/scope.js';
import { awaitingMeFilter } from '../requests/awaiting-me.js';
import { strainedLicenses } from '../licenses/strained-pools.js';

/** A single KPI tile. The frontend maps `icon` (Lucide) + `tone` to styling. */
export interface DashboardTile {
  key: string;
  label: string;
  value: number;
  href: string;
  icon: string;
  tone: 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';
}

/**
 * Exported so the list endpoints can offer exactly what these tiles count
 * (v2.26). They used to be private here, so `?open=true` did not exist and
 * every open tile linked to an unfiltered list - click "Open maintenance: 58"
 * and land on all 174.
 *
 * The name is historical and reads backwards: these are the statuses a request
 * is NOT open in.
 */
export const CLOSED_REQUEST_STATUSES = ['APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'] as const;
export const OPEN_MAINTENANCE = ['REQUESTED', 'SCHEDULED', 'IN_PROGRESS'] as const;
const RETIRED_STATUSES = ['DISPOSED', 'DONATED', 'RETIRED'] as const;

/**
 * v2.2 Workstream F — the "what needs me now" dashboard summary.
 *
 * Tiles are computed server-side, gated by the actor's permissions and narrowed
 * by their data scope, so each role is shown only what it may see: an Employee
 * (scope OWN, no approve/maintenance rights) gets their own assets and requests;
 * a manager or IT lead additionally gets the estate, approvals and maintenance.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(actor: AuthUser): Promise<{ tiles: DashboardTile[] }> {
    const has = (permission: string): boolean => actor.permissions.includes(permission);
    const tenant = tenantFilter(actor);
    const db = this.prisma.client;
    const tiles: DashboardTile[] = [];

    // A supplier is not a colleague with a laptop (v2.44).
    //
    // These two were pushed for everyone, on the assumption that every account
    // belongs to somebody with kit and requests. A supplier holds neither
    // permission, so it got two tiles reading zero that led to two pages saying
    // "you do not have permission" - gated now on the permission each tile's
    // page actually needs.
    const isVendorUser = Boolean(actor.vendorId);

    if (has('assets:read') || has('requests:read')) {
      // Counted in parallel - these tiles do not depend on each other, and
      // awaiting them in turn made the dashboard as slow as the sum of its parts.
      const [myAssets, myOpenRequests] = await Promise.all([
        has('assets:read')
          ? db.asset.count({ where: { ...tenant, assignedUserId: actor.id, deletedAt: null } })
          : Promise.resolve(0),
        has('requests:read')
          ? db.assetRequest.count({
              where: {
                ...tenant,
                requesterId: actor.id,
                status: { notIn: [...CLOSED_REQUEST_STATUSES] },
              },
            })
          : Promise.resolve(0),
      ]);
      if (has('assets:read')) {
        tiles.push({
          key: 'my-assets',
          label: 'My assets',
          value: myAssets,
          href: '/my-assets',
          icon: 'Boxes',
          tone: 'info',
        });
      }
      if (has('requests:read')) {
        tiles.push({
          key: 'my-open-requests',
          label: 'My open requests',
          value: myOpenRequests,
          href: '/requests?mine=true&open=true',
          icon: 'ClipboardList',
          tone: 'progress',
        });
      }
    }

    // What a supplier actually came here for. Scoped by its own vendor link, so
    // these counts can only ever be its own offers.
    //
    // The tiles answer "what stops a buyer seeing my offer today?", because that
    // is the supplier's whole job here. Three things do: it has not been sent,
    // its date has run out, or it has no stock - and the last two used to be
    // silent. An offer with nothing left in it simply vanished from the buyable
    // list with nothing anywhere to say so.
    if (isVendorUser && has('vendor-products:read') && actor.vendorId) {
      const vendorScope = { ...tenant, vendorId: actor.vendorId, deletedAt: null };
      const now = new Date();
      const soon = new Date(Date.now() + 30 * 86_400_000);
      const onSale = { ...vendorScope, status: 'APPROVED' as const, availableUntil: { gt: now } };

      const [company, live, awaitingReview, needsAttention, endingSoon, outOfStock] =
        await Promise.all([
          db.company.findUnique({
            where: { id: actor.companyId },
            select: { vendorOfferPolicy: true },
          }),
          db.vendorProduct.count({ where: { ...onSale, availableQuantity: { gt: 0 } } }),
          db.vendorProduct.count({ where: { ...vendorScope, status: 'PENDING_REVIEW' } }),
          // Drafts and anything turned down: the offers only this supplier can move.
          db.vendorProduct.count({
            where: { ...vendorScope, status: { in: ['DRAFT', 'REJECTED'] } },
          }),
          db.vendorProduct.count({ where: { ...onSale, availableUntil: { gt: now, lte: soon } } }),
          db.vendorProduct.count({ where: { ...onSale, availableQuantity: { lte: 0 } } }),
        ]);

      tiles.push({
        key: 'vendor-live-offers',
        label: 'On sale now',
        value: live,
        href: '/catalogue?liveOnly=true',
        icon: 'Boxes',
        tone: 'success',
      });

      // Only where there is a queue to wait in. With approval switched off this
      // tile could only ever read zero, which reads as "the buyer is ignoring
      // me" rather than "there is nothing to wait for".
      if ((company?.vendorOfferPolicy ?? DEFAULT_VENDOR_OFFER_POLICY) === 'REVIEW_REQUIRED') {
        tiles.push({
          key: 'vendor-awaiting-review',
          label: 'Awaiting the buyer',
          value: awaitingReview,
          href: '/catalogue?status=PENDING_REVIEW',
          icon: 'ClipboardList',
          tone: 'progress',
        });
      }

      tiles.push({
        key: 'vendor-needs-you',
        label: 'Not published yet',
        value: needsAttention,
        href: '/catalogue?status=DRAFT',
        icon: 'Wrench',
        tone: needsAttention > 0 ? 'warning' : 'info',
      });
      tiles.push({
        key: 'vendor-ending-soon',
        label: 'Ending within 30 days',
        value: endingSoon,
        href: '/catalogue?endingSoon=true',
        icon: 'CalendarClock',
        tone: endingSoon > 0 ? 'warning' : 'info',
      });
      tiles.push({
        // Approved and in date, but nothing left to sell - so a buyer cannot
        // see it and nothing else would say why.
        key: 'vendor-out-of-stock',
        label: 'Out of stock',
        value: outOfStock,
        href: '/catalogue?outOfStock=true',
        icon: 'PackageX',
        tone: outOfStock > 0 ? 'danger' : 'info',
      });
    }

    // Whoever the live step points at - which is not only approvers (v2.27).
    //
    // This was gated on REQUESTS_APPROVE alone, which was true only while every
    // step was an approval. An assessment stage is completed by recording an
    // answer, so its holder needs REQUESTS_ASSESS and nothing else - and an
    // Inventory Manager holds exactly that. Gating on approval meant the moment
    // a stock check was handed to them, the tile that would have shown it
    // disappeared: the step was theirs, and the dashboard said nothing was.
    if (has(PERMISSIONS.REQUESTS_APPROVE) || has(PERMISSIONS.REQUESTS_ASSESS)) {
      // The same predicate the inbox uses. It counted only `approverId` before,
      // which a role-based step does not carry until it is decided - so this
      // tile read 0 for an approver with a full inbox, while linking to the
      // list that showed them.
      const awaiting = await db.assetRequest.count({
        where: { ...tenant, ...awaitingMeFilter(actor) },
      });
      tiles.push({
        key: 'awaiting-approval',
        // Named for the queue, not for one way of clearing it. "Awaiting my
        // approval" promised an approval to someone who may only be able to
        // answer a stock question - and it disagreed with the filter it links
        // to, which has always been called "Awaiting me".
        label: 'Awaiting me',
        value: awaiting,
        href: '/requests?awaitingMe=true',
        icon: 'UserCheck',
        tone: awaiting > 0 ? 'warning' : 'neutral',
      });
    }

    // Roles that see beyond their own kit: the estate + warranty risk.
    if (has(PERMISSIONS.ASSETS_READ) && actor.scope !== 'OWN') {
      const scope = assetScopeFilter(actor);
      tiles.push({
        key: 'assets-total',
        label: 'Assets',
        value: await db.asset.count({ where: { ...scope, deletedAt: null } }),
        href: '/assets',
        icon: 'Layers',
        tone: 'info',
      });
      const soon = new Date(Date.now() + 90 * 86_400_000);
      tiles.push({
        key: 'warranty-expiring',
        label: 'Warranty expiring (90d)',
        value: await db.asset.count({
          where: {
            ...scope,
            deletedAt: null,
            warrantyEndDate: { gte: new Date(), lte: soon },
            status: { notIn: [...RETIRED_STATUSES] },
          },
        }),
        href: '/assets?warrantyWithinDays=90',
        icon: 'ShieldAlert',
        tone: 'warning',
      });
    }

    // Licence owners — renewals to plan (v2.3).
    if (has(PERMISSIONS.LICENSES_READ)) {
      const in90d = new Date(Date.now() + 90 * 86_400_000);
      const expiring = await db.softwareLicense.count({
        where: {
          companyId: actor.companyId,
          status: { not: 'RETIRED' },
          expiryDate: { gte: new Date(), lte: in90d },
        },
      });
      tiles.push({
        key: 'licenses-expiring',
        label: 'Licenses expiring (90d)',
        value: expiring,
        href: '/licenses?status=EXPIRING',
        icon: 'KeyRound',
        tone: expiring > 0 ? 'warning' : 'neutral',
      });

      // v2.7 R4 — pools at or near capacity. A licence that is full today is
      // tomorrow's blocked hire, so it earns its own tile rather than being
      // discovered at the moment of refusal.
      // Counted as LICENCES, not pools. It said "Licenses near capacity" while
      // counting seat pools, so one licence with three strained pools showed as
      // three - and it linked to a licence list that could never agree with it.
      const strained = await strainedLicenses(db, actor.companyId);
      tiles.push({
        key: 'licenses-at-capacity',
        label:
          strained.fullCount > 0
            ? `Licenses full (${strained.fullCount}) or near`
            : 'Licenses near capacity',
        value: strained.ids.length,
        href: '/licenses?nearCapacity=true',
        icon: 'KeyRound',
        tone: strained.fullCount > 0 ? 'danger' : strained.ids.length > 0 ? 'warning' : 'neutral',
      });
    }

    // Maintenance owners.
    if (has(PERMISSIONS.MAINTENANCE_READ)) {
      tiles.push({
        key: 'open-maintenance',
        label: 'Open maintenance',
        value: await db.maintenanceRecord.count({
          where: { asset: { companyId: actor.companyId }, status: { in: [...OPEN_MAINTENANCE] } },
        }),
        href: '/maintenance?open=true',
        icon: 'Wrench',
        tone: 'progress',
      });
    }

    return { tiles };
  }
}
