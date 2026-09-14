import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '@techpioasset/contracts';
import {
  agingDistribution,
  cycleStats,
  daysBetween,
  daysUntilExpiry,
  lastMonths,
  monthKey,
  ratePct,
  utilizationPct,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { canSeeCost } from '../common/scope.js';
import { CacheProvider } from '../providers/cache/cache.provider.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Aggregates change slowly; a minute of staleness is a fair trade. */
const TTL_SECONDS = 60;

/**
 * v2.6 A1 — the analytics engine (plan invariant 1: spend never leaves the
 * server without assets:cost:read — gated per aggregate, not by hiding UI).
 * All arithmetic lives in @techpioasset/domain; this service only queries,
 * maps, and caches. Empty datasets report zeros/nulls, never invented trends.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheProvider,
  ) {}

  private key(actor: AuthUser, section: string, params = ''): string {
    return `techpioasset:analytics:${actor.companyId}:${section}:${params}`;
  }

  // ── overview ───────────────────────────────────────────────────────────────

  async overview(actor: AuthUser) {
    return this.cache.wrap(this.key(actor, 'overview'), TTL_SECONDS, async () => {
      const companyId = actor.companyId;
      const [
        assetsByStatus,
        activeUsers,
        openRequests,
        openWorkOrders,
        activeLicenses,
        healthGrades,
        activeAssets,
        discoveredAssets,
      ] = await Promise.all([
        this.prisma.client.asset.groupBy({
          by: ['status'],
          where: { companyId, deletedAt: null },
          _count: { _all: true },
        }),
        this.prisma.client.user.count({ where: { companyId, deletedAt: null, status: 'ACTIVE' } }),
        this.prisma.client.assetRequest.count({
          where: {
            companyId,
            status: {
              in: [
                'SUBMITTED',
                'MANAGER_APPROVAL_PENDING',
                'HR_REVIEW_PENDING',
                'IT_REVIEW_PENDING',
                'OFFICE_ADMIN_REVIEW_PENDING',
                'FINANCE_APPROVAL_PENDING',
              ],
            },
          },
        }),
        this.prisma.client.maintenanceRecord.count({
          where: {
            status: { in: ['REQUESTED', 'SCHEDULED', 'IN_PROGRESS', 'ON_HOLD', 'AWAITING_APPROVAL'] },
            asset: { companyId },
          },
        }),
        this.prisma.client.softwareLicense.count({
          where: { companyId, deletedAt: null, status: { in: ['ACTIVE', 'EXPIRING'] } },
        }),
        this.prisma.client.assetHealth.groupBy({
          by: ['grade'],
          where: { companyId },
          _count: { _all: true },
        }),
        this.prisma.client.asset.count({ where: { companyId, deletedAt: null } }),
        this.prisma.client.asset.count({
          where: { companyId, deletedAt: null, hardwareProfile: { isNot: null } },
        }),
      ]);

      return {
        assetsByStatus: Object.fromEntries(assetsByStatus.map((g) => [g.status, g._count._all])),
        totals: {
          assets: activeAssets,
          activeUsers,
          openRequests,
          openWorkOrders,
          activeLicenses,
        },
        health: Object.fromEntries(healthGrades.map((g) => [g.grade, g._count._all])),
        discoveryCoveragePct: ratePct(discoveredAssets, activeAssets),
      };
    });
  }

  // ── spend (cost-gated) ─────────────────────────────────────────────────────

  async spend(actor: AuthUser, months: number) {
    if (!canSeeCost(actor)) {
      throw AppError.forbidden('Spend analytics needs cost visibility (assets:cost:read).');
    }
    return this.cache.wrap(this.key(actor, 'spend', String(months)), TTL_SECONDS, async () => {
      const companyId = actor.companyId;
      const now = new Date();
      const keys = lastMonths(now, months);
      const from = new Date(`${keys[0]}-01T00:00:00Z`);

      // v2.10 S4 — the months are summed by the database.
      //
      // This used to load every costed asset in the window and add them up in
      // JavaScript. EXPLAIN put the query itself at 36 ms returning 100,000
      // rows, while the endpoint took 2.8 s at p95: the cost was never the
      // query, it was shipping 100,000 rows to Node to total them.
      //
      // `to_char(col, 'YYYY-MM')` matches `monthKey`, which is
      // `toISOString().slice(0, 7)` — both UTC. The columns are `timestamp
      // without time zone` holding UTC, so no conversion is involved and the
      // bucket boundaries are identical. `analytics-spend-math` pins that.
      const [assetMonths, maintenanceMonths, byCategory] = await Promise.all([
        this.prisma.client.$queryRaw<{ month: string; total: string | null }[]>`
          SELECT to_char("purchaseDate", 'YYYY-MM') AS month, SUM("purchaseCost") AS total
            FROM "assets"
           WHERE "companyId" = ${companyId}
             AND "deletedAt" IS NULL
             AND "purchaseCost" IS NOT NULL
             AND "purchaseDate" >= ${from}
           GROUP BY 1`,
        this.prisma.client.$queryRaw<{ month: string; total: string | null }[]>`
          SELECT to_char(m."completedAt", 'YYYY-MM') AS month, SUM(m."serviceCost") AS total
            FROM "maintenance_records" m
            JOIN "assets" a ON a."id" = m."assetId"
           WHERE a."companyId" = ${companyId}
             AND m."serviceCost" IS NOT NULL
             -- signed-off work only; cost entered at completion awaits approval
             AND m."status" = 'COMPLETED'
             AND m."completedAt" >= ${from}
           GROUP BY 1`,
        this.prisma.client.asset.groupBy({
          by: ['categoryId'],
          where: { companyId, deletedAt: null, purchaseCost: { not: null } },
          _sum: { purchaseCost: true },
          _count: { _all: true },
        }),
      ]);

      const monthly = Object.fromEntries(
        keys.map((k) => [k, { assetSpend: 0, maintenanceSpend: 0 }]),
      ) as Record<string, { assetSpend: number; maintenanceSpend: number }>;
      // A month outside the requested window is dropped, exactly as the old
      // `if (monthly[k])` did — the query's lower bound and the key list can
      // disagree at the edges when a partial month is in play.
      for (const row of assetMonths) {
        if (monthly[row.month]) monthly[row.month]!.assetSpend = Number(row.total ?? 0);
      }
      for (const row of maintenanceMonths) {
        if (monthly[row.month]) monthly[row.month]!.maintenanceSpend = Number(row.total ?? 0);
      }

      const categories = await this.prisma.client.category.findMany({
        where: { id: { in: byCategory.map((c) => c.categoryId) } },
        select: { id: true, name: true },
      });
      const categoryName = new Map(categories.map((c) => [c.id, c.name]));

      return {
        months: keys.map((k) => ({ month: k, ...monthly[k]! })),
        byCategory: byCategory
          .map((c) => ({
            category: categoryName.get(c.categoryId) ?? 'Unknown',
            assetCount: c._count._all,
            totalCost: Number(c._sum.purchaseCost ?? 0),
          }))
          .sort((a, b) => b.totalCost - a.totalCost),
      };
    });
  }

  // ── licenses ───────────────────────────────────────────────────────────────

  async licenses(actor: AuthUser) {
    return this.cache.wrap(this.key(actor, 'licenses'), TTL_SECONDS, async () => {
      const now = new Date();
      const rows = await this.prisma.client.softwareLicense.findMany({
        where: { companyId: actor.companyId, deletedAt: null, status: { not: 'RETIRED' } },
        select: {
          id: true,
          name: true,
          expiryDate: true,
          seatsPurchased: true,
          pools: { select: { seatsAllocated: true, seatsReserved: true } },
        },
      });

      const runway = { expired: 0, within30: 0, within60: 0, within90: 0, beyond: 0, perpetual: 0 };
      const utilization = rows
        .map((l) => {
          const allocated = l.pools.reduce((sum, p) => sum + p.seatsAllocated, 0);
          const reserved = l.pools.reduce((sum, p) => sum + p.seatsReserved, 0);
          if (!l.expiryDate) runway.perpetual += 1;
          else {
            const days = daysUntilExpiry(l.expiryDate, now);
            if (days < 0) runway.expired += 1;
            else if (days <= 30) runway.within30 += 1;
            else if (days <= 60) runway.within60 += 1;
            else if (days <= 90) runway.within90 += 1;
            else runway.beyond += 1;
          }
          return {
            id: l.id,
            name: l.name,
            seatsPurchased: l.seatsPurchased,
            seatsReserved: reserved,
            utilizationPct: utilizationPct(reserved, allocated),
          };
        })
        .sort((a, b) => (b.utilizationPct ?? -1) - (a.utilizationPct ?? -1));

      return { licenses: utilization, runway };
    });
  }

  // ── procurement ────────────────────────────────────────────────────────────

  async procurement(actor: AuthUser, months: number) {
    return this.cache.wrap(
      this.key(actor, 'procurement', String(months)),
      TTL_SECONDS,
      async () => {
        const companyId = actor.companyId;
        const from = new Date(Date.now() - months * 30 * 86_400_000);

        const [byStatus, decided, fulfilled] = await Promise.all([
          this.prisma.client.purchaseRequest.groupBy({
            by: ['status'],
            where: { companyId, deletedAt: null },
            _count: { _all: true },
          }),
          this.prisma.client.purchaseRequest.findMany({
            where: { companyId, deletedAt: null, submittedAt: { gte: from, not: null }, approvedAt: { not: null } },
            select: { submittedAt: true, approvedAt: true },
          }),
          this.prisma.client.purchaseRequest.findMany({
            where: {
              companyId,
              deletedAt: null,
              approvedAt: { gte: from, not: null },
              convertedPo: { receipts: { some: {} } },
            },
            select: {
              approvedAt: true,
              convertedPo: {
                select: { receipts: { select: { receivedAt: true }, orderBy: { receivedAt: 'asc' }, take: 1 } },
              },
            },
          }),
        ]);

        const approvalDays = decided.map((pr) => daysBetween(pr.submittedAt!, pr.approvedAt!));
        const fulfilmentDays = fulfilled
          .map((pr) => {
            const first = pr.convertedPo?.receipts[0]?.receivedAt;
            return first ? daysBetween(pr.approvedAt!, first) : null;
          })
          .filter((d): d is number => d !== null);

        return {
          requestsByStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
          approvalCycle: cycleStats(approvalDays),
          fulfilmentCycle: cycleStats(fulfilmentDays),
        };
      },
    );
  }

  // ── work orders ────────────────────────────────────────────────────────────

  async workOrders(actor: AuthUser, months: number) {
    return this.cache.wrap(this.key(actor, 'work-orders', String(months)), TTL_SECONDS, async () => {
      const companyId = actor.companyId;
      const now = new Date();
      const keys = lastMonths(now, months);
      const from = new Date(`${keys[0]}-01T00:00:00Z`);
      const scope: Prisma.MaintenanceRecordWhereInput = { asset: { companyId } };

      const [created, completed, open, withSla, escalated, repairs] = await Promise.all([
        this.prisma.client.maintenanceRecord.findMany({
          where: { ...scope, createdAt: { gte: from } },
          select: { createdAt: true },
        }),
        this.prisma.client.maintenanceRecord.findMany({
          // Signed off only: completedAt is stamped when the technician finishes,
          // so an order still awaiting approval must not count as done.
          where: { ...scope, status: 'COMPLETED', completedAt: { gte: from, not: null } },
          select: { completedAt: true },
        }),
        this.prisma.client.maintenanceRecord.findMany({
          where: { ...scope, status: { in: ['REQUESTED', 'SCHEDULED', 'IN_PROGRESS', 'ON_HOLD', 'AWAITING_APPROVAL'] } },
          select: { createdAt: true },
        }),
        this.prisma.client.maintenanceRecord.count({
          where: { ...scope, slaDueAt: { not: null }, createdAt: { gte: from } },
        }),
        this.prisma.client.maintenanceRecord.count({
          where: { ...scope, escalatedAt: { not: null }, createdAt: { gte: from } },
        }),
        this.prisma.client.maintenanceRecord.findMany({
          where: {
            ...scope,
            status: 'COMPLETED',
            startedAt: { not: null },
            completedAt: { gte: from, not: null },
          },
          select: { startedAt: true, completedAt: true },
        }),
      ]);

      const series = Object.fromEntries(keys.map((k) => [k, { created: 0, completed: 0 }])) as Record<
        string,
        { created: number; completed: number }
      >;
      for (const r of created) {
        const k = monthKey(r.createdAt);
        if (series[k]) series[k].created += 1;
      }
      for (const r of completed) {
        const k = monthKey(r.completedAt!);
        if (series[k]) series[k].completed += 1;
      }

      return {
        months: keys.map((k) => ({ month: k, ...series[k]! })),
        openAging: agingDistribution(open.map((r) => daysBetween(r.createdAt, now))),
        slaBreachRatePct: ratePct(escalated, withSla),
        repairCycle: cycleStats(repairs.map((r) => daysBetween(r.startedAt!, r.completedAt!))),
      };
    });
  }

  // ── health ─────────────────────────────────────────────────────────────────

  async health(actor: AuthUser) {
    return this.cache.wrap(this.key(actor, 'health'), TTL_SECONDS, async () => {
      const companyId = actor.companyId;
      const staleCutoff = new Date(Date.now() - 30 * 86_400_000);
      const [grades, capped, activeAssets, discovered, stale] = await Promise.all([
        this.prisma.client.assetHealth.groupBy({
          by: ['grade'],
          where: { companyId },
          _count: { _all: true },
        }),
        this.prisma.client.assetHealth.count({ where: { companyId, capped: true } }),
        this.prisma.client.asset.count({ where: { companyId, deletedAt: null } }),
        this.prisma.client.asset.count({
          where: { companyId, deletedAt: null, hardwareProfile: { isNot: null } },
        }),
        this.prisma.client.hardwareProfile.count({
          where: { companyId, lastDiscoveredAt: { lt: staleCutoff }, asset: { deletedAt: null } },
        }),
      ]);
      return {
        grades: Object.fromEntries(grades.map((g) => [g.grade, g._count._all])),
        cappedCount: capped,
        discoveryCoveragePct: ratePct(discovered, activeAssets),
        staleCount: stale,
      };
    });
  }
}
