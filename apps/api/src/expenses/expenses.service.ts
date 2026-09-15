import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AuthUser,
  ExpenseGroupDto,
  ExpenseLineDto,
  ExpensePeriodDto,
  ExpenseQuery,
  ExpenseSummaryDto,
} from '@techpioasset/contracts';
import {
  EXPENSE_SOURCES,
  ExpensePeriodError,
  classifyExpenseBuckets,
  expenseBuckets,
  expenseChangePct,
  expenseSharePct,
  isValidTimeZone,
  money,
  previousExpensePeriod,
  resolveExpensePeriod,
  sumMoney,
  type ExpenseSource,
  type ResolvedExpensePeriod,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageProvider } from '../providers/storage/storage.provider.js';

/**
 * Expense reporting (v2.59) - Super Admin only.
 *
 * An expense is one of three things (owner decision):
 *   ASSET        an asset's purchaseCost, dated by purchaseDate
 *   MAINTENANCE  a COMPLETED job's serviceCost, dated when it closed
 *                (approvedAt; completedAt for jobs closed before sign-off
 *                existed). AWAITING_APPROVAL is not closed and is not counted.
 *   LICENCE      a licence's costAmount dated by purchaseDate, plus each
 *                LicenseRenewal's costAmount dated by renewedAt. The licence's
 *                own renewalDate is a PLANNED date, not money spent, and is
 *                not counted.
 * Invoices are never counted: they bill the same purchases.
 *
 * All totals are summed by Postgres over numeric columns and travel as text,
 * then Decimal - no float ever holds a total. Soft-deleted assets, jobs on
 * them and deleted licences are excluded.
 */

/** Largest line list an export will carry; the summary never loads lines. */
export const MAX_EXPORT_LINES = 20_000;

const FAMILY_LABELS: Record<string, string> = {
  PRODUCTIVITY_SUITE: 'Productivity suite',
  OPERATING_SYSTEM: 'Operating system',
  SECURITY: 'Security',
  DEVELOPER_TOOLS: 'Developer tools',
  DESIGN_CREATIVE: 'Design & creative',
  SAAS: 'SaaS subscription',
  DATABASE_SERVER: 'Database / server',
  OTHER: 'Other software',
};

export interface ExpenseFilters {
  officeId: string | null;
  categoryId: string | null;
}

export interface ExpenseCompany {
  id: string;
  name: string;
  legalName: string | null;
  baseCurrency: string;
  timezone: string;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  /**
   * The company's own logo (PNG, pixel size), when one is stored and readable.
   * Nothing uploads Company.logoKey yet, so today this is always null and the
   * product logo is used.
   */
  logo: { buffer: Buffer; width: number; height: number } | null;
}

/** Everything an export renders. */
export interface ExpenseReportData {
  summary: ExpenseSummaryDto;
  lines: ExpenseLineDto[];
  linesTruncated: boolean;
  company: ExpenseCompany;
  preparedBy: string;
  generatedAt: Date;
  /** "Office: Mohali", "Category: Furniture". */
  filterLabels: string[];
}

interface LineRow {
  source: ExpenseSource;
  id: string;
  assetId: string | null;
  title: string;
  at: Date;
  amount: string;
  currency: string;
  category: string | null;
  type: string | null;
  licenceFamily: string | null;
  office: string | null;
  vendor: string | null;
}

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageProvider,
  ) {}

  /**
   * The gate. There is no super-admin-only permission to require on the route:
   * the role simply holds every permission, and Finance holds the cost ones.
   * The owner asked for this report to be Super Admin's alone, so it is the
   * role that is checked, as changeEmail does.
   */
  assertSuperAdmin(actor: AuthUser): void {
    if (!actor.roles.includes('SUPER_ADMIN')) {
      throw AppError.forbidden('Only a Super Admin can view or download the expense report');
    }
  }

  async summary(
    actor: AuthUser,
    query: ExpenseQuery,
    now = new Date(),
  ): Promise<ExpenseSummaryDto> {
    this.assertSuperAdmin(actor);
    const company = await this.company(actor.companyId, false);
    const filters = await this.validateFilters(actor.companyId, query);
    return this.buildSummary(
      company,
      this.resolve(query, company.timezone, now),
      filters.filters,
      now,
    );
  }

  /** Summary plus line items, company and letterhead facts, for a file. */
  async reportData(
    companyId: string,
    userId: string,
    query: ExpenseQuery,
    now = new Date(),
  ): Promise<ExpenseReportData> {
    const company = await this.company(companyId, true);
    const { filters, labels } = await this.validateFilters(companyId, query);
    const period = this.resolve(query, company.timezone, now);
    const summary = await this.buildSummary(company, period, filters, now);

    const rows = await this.prisma.client.$queryRaw<LineRow[]>`
      ${this.linesCte(company, period, filters)}
      ${this.lineSelect()}
      ORDER BY l.at ASC, l.id ASC
      LIMIT ${MAX_EXPORT_LINES + 1}`;
    const linesTruncated = rows.length > MAX_EXPORT_LINES;
    const lines = rows.slice(0, MAX_EXPORT_LINES).map((r) => this.lineDto(r, company.timezone));

    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, companyId },
      select: { email: true, profile: { select: { firstName: true, lastName: true } } },
    });
    const preparedBy =
      [user?.profile?.firstName, user?.profile?.lastName].filter(Boolean).join(' ').trim() ||
      user?.email ||
      'Super Admin';

    return {
      summary,
      lines,
      linesTruncated,
      company,
      preparedBy,
      generatedAt: now,
      filterLabels: labels,
    };
  }

  /**
   * Whether `userId` is still an active Super Admin of `companyId`. A signed
   * link was minted by one; this stops it outliving that person's role.
   */
  async isActiveSuperAdmin(companyId: string, userId: string): Promise<boolean> {
    const count = await this.prisma.client.user.count({
      where: {
        id: userId,
        companyId,
        status: 'ACTIVE',
        roles: { some: { role: { key: 'SUPER_ADMIN' } } },
      },
    });
    return count > 0;
  }

  // -------------------------------------------------------------------------

  private resolve(query: ExpenseQuery, timeZone: string, now: Date): ResolvedExpensePeriod {
    try {
      return resolveExpensePeriod(
        { preset: query.preset, from: query.from, to: query.to },
        timeZone,
        now,
      );
    } catch (error) {
      if (error instanceof ExpensePeriodError) {
        throw new AppError('VALIDATION_FAILED', error.message);
      }
      throw error;
    }
  }

  private async company(companyId: string, withLogo: boolean): Promise<ExpenseCompany> {
    const row = await this.prisma.client.company.findFirst({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        legalName: true,
        baseCurrency: true,
        timezone: true,
        contactPhone: true,
        contactEmail: true,
        address: true,
        logoKey: true,
      },
    });
    if (!row) throw AppError.notFound('Company', companyId);

    let logo: ExpenseCompany['logo'] = null;
    if (withLogo && row.logoKey) {
      try {
        const bytes = await this.storage.get(row.logoKey);
        // PNG only: both exceljs and pdfkit embed it, and its size sits at a
        // fixed offset in the header, so the letterhead can keep proportions.
        const png =
          bytes.length > 24 && bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        if (png) {
          const width = bytes.readUInt32BE(16);
          const height = bytes.readUInt32BE(20);
          if (width > 0 && height > 0) logo = { buffer: bytes, width, height };
        }
      } catch (error) {
        this.logger.warn(
          `Company logo unreadable, using the product logo: ${(error as Error).message}`,
        );
      }
    }

    return {
      id: row.id,
      name: row.name,
      legalName: row.legalName,
      baseCurrency: row.baseCurrency.trim().toUpperCase(),
      timezone: isValidTimeZone(row.timezone) ? row.timezone : 'UTC',
      contactPhone: row.contactPhone,
      contactEmail: row.contactEmail,
      address: row.address,
      logo,
    };
  }

  private async validateFilters(companyId: string, query: ExpenseQuery) {
    const labels: string[] = [];
    if (query.officeId) {
      const office = await this.prisma.client.office.findFirst({
        where: { id: query.officeId, companyId },
        select: { name: true },
      });
      if (!office) throw AppError.notFound('Office', query.officeId);
      labels.push(`Office: ${office.name}`);
    }
    if (query.categoryId) {
      const category = await this.prisma.client.category.findFirst({
        where: { id: query.categoryId, companyId },
        select: { name: true },
      });
      if (!category) throw AppError.notFound('Category', query.categoryId);
      labels.push(`Category: ${category.name}`);
    }
    return {
      filters: {
        officeId: query.officeId ?? null,
        categoryId: query.categoryId ?? null,
      } as ExpenseFilters,
      labels,
    };
  }

  /** UTC instant as a SQL `timestamp` (the columns are timestamp(3) holding UTC). */
  private ts(instant: Date): Prisma.Sql {
    return Prisma.sql`(CAST(${instant.toISOString()} AS timestamptz) AT TIME ZONE 'UTC')`;
  }

  /**
   * Every expense line of the period as one relation `lines`.
   *
   * Office and category filters apply to assets and to repairs through their
   * asset. Licences belong to no office or category, so a filtered report
   * leaves them out rather than pretending they belong everywhere.
   */
  private linesCte(
    company: ExpenseCompany,
    period: { from: Date; to: Date },
    filters: ExpenseFilters,
  ) {
    const from = this.ts(period.from);
    const to = this.ts(period.to);
    const base = company.baseCurrency;
    const assetFilter = Prisma.sql`
      ${filters.officeId ? Prisma.sql`AND a."officeId" = ${filters.officeId}` : Prisma.empty}
      ${filters.categoryId ? Prisma.sql`AND a."categoryId" = ${filters.categoryId}` : Prisma.empty}`;
    const licences = !filters.officeId && !filters.categoryId;

    return Prisma.sql`
      WITH lines AS (
        SELECT 'ASSET'::text AS source, a.id, a.id AS "assetId", a.name AS title,
               a."purchaseDate" AS at, a."purchaseCost" AS amount,
               COALESCE(NULLIF(TRIM(a.currency), ''), ${base}) AS currency,
               a."categoryId", a."subcategoryId", a."officeId", a."vendorId",
               NULL::text AS "licenceFamily"
          FROM assets a
         WHERE a."companyId" = ${company.id}
           AND a."deletedAt" IS NULL
           AND a."purchaseCost" IS NOT NULL
           AND a."purchaseDate" >= ${from} AND a."purchaseDate" < ${to}
           ${assetFilter}
        UNION ALL
        SELECT 'MAINTENANCE'::text, m.id, a.id, m.title,
               COALESCE(m."approvedAt", m."completedAt"), m."serviceCost",
               COALESCE(NULLIF(TRIM(m.currency), ''), ${base}),
               a."categoryId", a."subcategoryId", a."officeId", m."vendorId",
               NULL::text
          FROM maintenance_records m
          JOIN assets a ON a.id = m."assetId"
         WHERE a."companyId" = ${company.id}
           AND a."deletedAt" IS NULL
           AND m."deletedAt" IS NULL
           AND m.status::text = 'COMPLETED'
           AND m."serviceCost" IS NOT NULL
           AND COALESCE(m."approvedAt", m."completedAt") >= ${from}
           AND COALESCE(m."approvedAt", m."completedAt") < ${to}
           ${assetFilter}
        ${
          licences
            ? Prisma.sql`
        UNION ALL
        SELECT 'LICENCE'::text, l.id, NULL::text, l.name,
               l."purchaseDate", l."costAmount",
               COALESCE(NULLIF(TRIM(l."costCurrency"), ''), ${base}),
               NULL::text, NULL::text, NULL::text, l."vendorId", l.family::text
          FROM software_licenses l
         WHERE l."companyId" = ${company.id}
           AND l."deletedAt" IS NULL
           AND l."costAmount" IS NOT NULL
           AND l."purchaseDate" >= ${from} AND l."purchaseDate" < ${to}
        UNION ALL
        SELECT 'LICENCE'::text, r.id, NULL::text, l.name || ' (renewal)',
               r."renewedAt", r."costAmount",
               COALESCE(NULLIF(TRIM(r."costCurrency"), ''), NULLIF(TRIM(l."costCurrency"), ''), ${base}),
               NULL::text, NULL::text, NULL::text, l."vendorId", l.family::text
          FROM license_renewals r
          JOIN software_licenses l ON l.id = r."licenseId"
         WHERE r."companyId" = ${company.id}
           AND l."companyId" = ${company.id}
           AND l."deletedAt" IS NULL
           AND r."costAmount" IS NOT NULL
           AND r."renewedAt" >= ${from} AND r."renewedAt" < ${to}`
            : Prisma.empty
        }
      )`;
  }

  private lineSelect() {
    return Prisma.sql`
      SELECT l.source, l.id, l."assetId", l.title, l.at, l.amount::text AS amount, l.currency,
             c.name AS category, s.name AS type, l."licenceFamily", o.name AS office, v.name AS vendor
        FROM lines l
        LEFT JOIN categories c ON c.id = l."categoryId"
        LEFT JOIN subcategories s ON s.id = l."subcategoryId"
        LEFT JOIN offices o ON o.id = l."officeId"
        LEFT JOIN vendors v ON v.id = l."vendorId"`;
  }

  private lineDto(r: LineRow, timeZone: string): ExpenseLineDto {
    const licence = r.source === 'LICENCE';
    return {
      source: r.source,
      id: r.id,
      assetId: r.assetId,
      title: r.title,
      date: r.at.toISOString(),
      localDate: new Intl.DateTimeFormat('en-CA', { timeZone }).format(r.at),
      amount: money(r.amount).toFixed(2),
      currency: r.currency,
      category: licence ? 'Software licences' : r.category,
      type: licence ? (FAMILY_LABELS[r.licenceFamily ?? 'OTHER'] ?? 'Software') : r.type,
      office: r.office,
      vendor: r.vendor,
    };
  }

  private periodDto(p: ResolvedExpensePeriod): ExpensePeriodDto {
    return {
      preset: p.preset,
      fromDate: p.fromDate,
      toDate: p.toDate,
      from: p.from.toISOString(),
      to: p.to.toISOString(),
      days: p.days,
      label: p.label,
      rangeLabel: p.rangeLabel,
      timezone: p.timeZone,
      granularity: p.granularity,
    };
  }

  private async buildSummary(
    company: ExpenseCompany,
    period: ResolvedExpensePeriod,
    filters: ExpenseFilters,
    now: Date,
  ): Promise<ExpenseSummaryDto> {
    const client = this.prisma.client;
    const base = company.baseCurrency;
    const cte = this.linesCte(company, period, filters);
    const previous = previousExpensePeriod(period);

    // 1. per source and currency
    const bySourceRows = await client.$queryRaw<
      Array<{ source: ExpenseSource; currency: string; total: string; count: number }>
    >`${cte}
      SELECT source, currency, SUM(amount)::text AS total, COUNT(*)::int AS count
        FROM lines GROUP BY source, currency`;

    // 2. previous period, base currency
    const [prevRow] = await client.$queryRaw<Array<{ total: string | null }>>`
      ${this.linesCte(company, previous, filters)}
      SELECT SUM(amount)::text AS total FROM lines WHERE currency = ${base}`;

    // 3. series - grouped on the company's wall clock, same keys as the domain buckets
    const keyFormat = period.granularity === 'DAY' ? 'YYYY-MM-DD' : 'YYYY-MM';
    const seriesRows = await client.$queryRaw<Array<{ key: string; total: string; count: number }>>`
      ${cte}
      SELECT to_char((at AT TIME ZONE 'UTC') AT TIME ZONE ${company.timezone}, ${keyFormat}) AS key,
             SUM(amount)::text AS total, COUNT(*)::int AS count
        FROM lines WHERE currency = ${base} GROUP BY 1`;

    // 4. breakdowns
    const groupRows = await client.$queryRaw<
      Array<{
        dim: string;
        id: string | null;
        name: string | null;
        family: string | null;
        total: string;
        count: number;
      }>
    >`${cte}
      SELECT 'category' AS dim, l."categoryId" AS id, c.name AS name, NULL::text AS family,
             SUM(l.amount)::text AS total, COUNT(*)::int AS count
        FROM lines l LEFT JOIN categories c ON c.id = l."categoryId"
       WHERE l.currency = ${base} GROUP BY l."categoryId", c.name
      UNION ALL
      SELECT 'type', l."subcategoryId", s.name, l."licenceFamily", SUM(l.amount)::text, COUNT(*)::int
        FROM lines l LEFT JOIN subcategories s ON s.id = l."subcategoryId"
       WHERE l.currency = ${base} GROUP BY l."subcategoryId", s.name, l."licenceFamily"
      UNION ALL
      SELECT 'office', l."officeId", o.name, NULL::text, SUM(l.amount)::text, COUNT(*)::int
        FROM lines l LEFT JOIN offices o ON o.id = l."officeId"
       WHERE l.currency = ${base} AND l.source <> 'LICENCE' GROUP BY l."officeId", o.name
      UNION ALL
      SELECT 'office', NULL, NULL, 'LICENCE', SUM(l.amount)::text, COUNT(*)::int
        FROM lines l WHERE l.currency = ${base} AND l.source = 'LICENCE' HAVING COUNT(*) > 0
      UNION ALL
      SELECT 'vendor', l."vendorId", v.name, NULL::text, SUM(l.amount)::text, COUNT(*)::int
        FROM lines l LEFT JOIN vendors v ON v.id = l."vendorId"
       WHERE l.currency = ${base} GROUP BY l."vendorId", v.name`;

    // 5. top ten
    const topRows = await client.$queryRaw<LineRow[]>`
      ${cte}
      ${this.lineSelect()}
      WHERE l.currency = ${base}
      ORDER BY l.amount DESC, l.at DESC, l.id ASC
      LIMIT 10`;

    // ---- assemble, in Decimal ------------------------------------------
    const bySource = Object.fromEntries(
      EXPENSE_SOURCES.map((s) => [s, { total: '0.00', count: 0 }]),
    ) as ExpenseSummaryDto['totals']['bySource'];
    const others = new Map<string, { total: string; count: number }>();
    for (const row of bySourceRows) {
      if (row.currency === base) {
        const current = bySource[row.source];
        current.total = sumMoney([current.total, row.total]).toFixed(2);
        current.count += row.count;
      } else {
        const current = others.get(row.currency) ?? { total: '0.00', count: 0 };
        others.set(row.currency, {
          total: sumMoney([current.total, row.total]).toFixed(2),
          count: current.count + row.count,
        });
      }
    }
    const total = sumMoney(EXPENSE_SOURCES.map((s) => bySource[s].total));
    const count = EXPENSE_SOURCES.reduce((n, s) => n + bySource[s].count, 0);
    const previousTotal = sumMoney([prevRow?.total ?? '0']);

    const seriesByKey = new Map(seriesRows.map((r) => [r.key, r]));
    const buckets = expenseBuckets(period);
    const bucketTotals = buckets.map((b) => money(seriesByKey.get(b.key)?.total ?? '0').toFixed(2));
    const levels = classifyExpenseBuckets(bucketTotals);
    const series = buckets.map((b, i) => ({
      key: b.key,
      label: b.label,
      total: bucketTotals[i]!,
      count: seriesByKey.get(b.key)?.count ?? 0,
      level: levels[i]!,
      partial: b.partial,
    }));

    const spending = series.filter((p) => !money(p.total).isZero());
    const extreme = (pick: (a: (typeof series)[number], b: (typeof series)[number]) => boolean) =>
      spending.length === 0 ? null : spending.reduce((best, p) => (pick(p, best) ? p : best));
    const highest = extreme((a, b) => money(a.total).greaterThan(b.total));
    const lowest = extreme((a, b) => money(a.total).lessThan(b.total));

    const group = (
      dim: string,
      name: (r: (typeof groupRows)[number]) => string,
    ): ExpenseGroupDto[] =>
      groupRows
        .filter((r) => r.dim === dim)
        .map((r) => ({
          id: r.id,
          name: name(r),
          total: money(r.total).toFixed(2),
          count: r.count,
          sharePct: expenseSharePct(r.total, total),
        }))
        .sort((a, b) => money(b.total).comparedTo(a.total) || a.name.localeCompare(b.name));

    const topExpenses = topRows.map((r) => this.lineDto(r, company.timezone));

    return {
      period: this.periodDto(period),
      previousPeriod: this.periodDto(previous),
      currency: base,
      filters,
      totals: {
        total: total.toFixed(2),
        count,
        bySource,
        previousTotal: previousTotal.toFixed(2),
        changePct: expenseChangePct(total, previousTotal),
      },
      series,
      byCategory: group('category', (r) =>
        r.id ? (r.name ?? 'Unknown category') : 'Software licences',
      ),
      byType: group('type', (r) =>
        r.family ? (FAMILY_LABELS[r.family] ?? 'Software') : (r.name ?? 'No type set'),
      ),
      byOffice: group('office', (r) =>
        r.family === 'LICENCE' ? 'Company-wide (software licences)' : (r.name ?? 'No office set'),
      ),
      byVendor: group('vendor', (r) => r.name ?? 'No vendor recorded'),
      topExpenses,
      otherCurrencies: [...others.entries()]
        .map(([currency, v]) => ({ currency, ...v }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
      dataGaps: await this.dataGaps(company.id, filters),
      highestBucket: highest
        ? { key: highest.key, label: highest.label, total: highest.total }
        : null,
      lowestBucket: lowest ? { key: lowest.key, label: lowest.label, total: lowest.total } : null,
      generatedAt: now.toISOString(),
    };
  }

  /** What is missing, company-wide - not limited to the period, because a missing date puts a cost in no period at all. */
  private async dataGaps(
    companyId: string,
    filters: ExpenseFilters,
  ): Promise<ExpenseSummaryDto['dataGaps']> {
    const client = this.prisma.client;
    const assetWhere = {
      companyId,
      deletedAt: null,
      ...(filters.officeId ? { officeId: filters.officeId } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    };
    const closed = { status: 'COMPLETED' as const, deletedAt: null, asset: assetWhere };

    const assetsWithoutPrice = await client.asset.count({
      where: { ...assetWhere, purchaseCost: null },
    });
    const pricedAssetsWithoutDate = await client.asset.count({
      where: { ...assetWhere, purchaseCost: { not: null }, purchaseDate: null },
    });
    const maintenanceClosedWithoutCost = await client.maintenanceRecord.count({
      where: { ...closed, serviceCost: null },
    });
    const maintenanceClosedWithoutDate = await client.maintenanceRecord.count({
      where: { ...closed, serviceCost: { not: null }, approvedAt: null, completedAt: null },
    });
    const licencesWithoutCost =
      filters.officeId || filters.categoryId
        ? 0
        : await client.softwareLicense.count({
            where: { companyId, deletedAt: null, costAmount: null },
          });

    const n = (count: number, one: string, many: string) =>
      `${count.toLocaleString('en-IN')} ${count === 1 ? one : many}`;
    const notes: string[] = [];
    if (assetsWithoutPrice > 0) {
      notes.push(
        `${n(assetsWithoutPrice, 'asset has', 'assets have')} no purchase price, so ${assetsWithoutPrice === 1 ? 'it is' : 'they are'} not counted in any total.`,
      );
    }
    if (pricedAssetsWithoutDate > 0) {
      notes.push(
        `${n(pricedAssetsWithoutDate, 'priced asset has', 'priced assets have')} no purchase date and ${pricedAssetsWithoutDate === 1 ? 'is' : 'are'} not in any period.`,
      );
    }
    if (maintenanceClosedWithoutCost > 0) {
      notes.push(
        `${n(maintenanceClosedWithoutCost, 'completed repair has', 'completed repairs have')} no service cost recorded.`,
      );
    }
    if (maintenanceClosedWithoutDate > 0) {
      notes.push(
        `${n(maintenanceClosedWithoutDate, 'completed repair with a cost has', 'completed repairs with a cost have')} no closing date and ${maintenanceClosedWithoutDate === 1 ? 'is' : 'are'} not in any period.`,
      );
    }
    if (licencesWithoutCost > 0) {
      notes.push(
        `${n(licencesWithoutCost, 'software licence has', 'software licences have')} no cost recorded.`,
      );
    }

    return {
      assetsWithoutPrice,
      pricedAssetsWithoutDate,
      maintenanceClosedWithoutCost,
      maintenanceClosedWithoutDate,
      licencesWithoutCost,
      notes,
    };
  }
}
