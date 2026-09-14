import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser, ReportType } from '@techpioasset/contracts';
import { computeDepreciation, warrantyBucket, type DepreciationMethod } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { canSeeCost, tenantFilter } from '../common/scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ReportColumn, ReportRow, ReportTable } from './report-format.js';

/**
 * Report aggregations (spec section 18).
 *
 * Financial reports require assets:cost:read; a caller without it is refused
 * rather than shown a report with the money columns stripped, because a spending
 * report with no spending is misleading. Non-financial reports (inventory,
 * warranty expiry) are available to anyone with reports:read.
 */

/** Rows fetched, mapped and released one page at a time. */
const EXPORT_BATCH = 5_000;

/**
 * Which of a person's items is "their machine" (v2.28).
 *
 * Lower sorts first. Anything unlisted - and anything with no Type recorded -
 * ranks last, so a monitor never displaces a laptop and an untyped asset never
 * displaces a typed one. Matched on the Type name because that is what the
 * subcategory holds; the comparison is lowercased and substring-based so
 * "Monitor / Screen" and "Monitor" both land in the same place.
 */
const DEVICE_ORDER = ['laptop', 'desktop', 'workstation', 'server', 'tablet', 'mobile', 'phone'];

function deviceRank(typeName: string | null | undefined): number {
  if (!typeName) return DEVICE_ORDER.length;
  const name = typeName.toLowerCase();
  const found = DEVICE_ORDER.findIndex((key) => name.includes(key));
  return found === -1 ? DEVICE_ORDER.length : found;
}

/** A spec value for a cell: blank when absent, never "undefined" or "null". */
function specText(value: unknown, suffix = ''): string {
  if (value === null || value === undefined || value === '') return '';
  return `${String(value)}${suffix}`;
}

/**
 * A specification for a report, preferring what the machine reported (v2.39).
 *
 * Two sources exist for RAM, storage and OS: what somebody typed into the
 * asset, and what the agent read off the machine. The agent wins where it has
 * an answer, because it measured the thing rather than remembering it - a
 * hand-typed figure is right on the day it is entered and silently wrong after
 * the first upgrade.
 *
 * The typed value is the fallback, which is what carries the Macs (the agent is
 * Windows-only, so they will never report) and anything the agent has not
 * reached yet.
 */
function preferReported(reported: string | null, typed: string): string {
  return reported ?? (typed || '');
}

/**
 * Measured RAM, as measured.
 *
 * Windows reports what is addressable, so a 16 GB machine reads 15.4 - the rest
 * is reserved by hardware. Deliberately NOT rounded up to the number on the
 * box: that figure was never measured, and inventing it here would put a value
 * in an asset register that nothing in the system can support.
 */
function reportedGb(value: Prisma.Decimal | null | undefined, dp = 1): string | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Number(n.toFixed(dp))} GB`;
}

/** "Microsoft Windows 11 Pro 10.0.26200" from the two fields that hold it. */
function reportedOs(
  os: { osName: string | null; osVersion: string | null } | null | undefined,
): string | null {
  if (!os?.osName) return null;
  return [os.osName, os.osVersion].filter(Boolean).join(' ');
}

/** yyyy-mm-dd, which sorts correctly as text in any spreadsheet. */
function isoDate(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : '';
}

/**
 * v2.10 S5 — a report defined once.
 *
 * `page(skip, take)` returns already-mapped rows, so the buffered path (JSON)
 * and the streamed path (CSV/XLSX) share one query, one column list and one row
 * mapper. The alternative — a second copy of each for streaming — is how an
 * export quietly stops matching the screen it was exported from.
 *
 * Every ordering carries `id` as a final tiebreaker. Without it, two rows with
 * the same warranty date could swap places between pages and the export would
 * silently duplicate one and drop the other.
 */
interface StreamSpec {
  title: string;
  columns: ReportColumn[];
  page: (skip: number, take: number) => Promise<ReportRow[]>;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly FINANCIAL: ReportType[] = [
    'SPENDING_BY_VENDOR',
    'SPENDING_BY_CATEGORY',
    'SPENDING_BY_DEPARTMENT',
    'DEPRECIATION',
    'MAINTENANCE_COST',
  ];

  async build(
    actor: AuthUser,
    type: ReportType,
    filters: { officeId?: string; departmentId?: string },
  ): Promise<ReportTable> {
    if (this.FINANCIAL.includes(type) && !canSeeCost(actor)) {
      throw AppError.forbidden('This report includes financial data you are not permitted to see');
    }

    // A streamable report is defined ONCE (see `streamSpec`) and assembled here
    // by walking the same pages the export streams. Two definitions of one
    // report is how a CSV and a JSON of the same thing start disagreeing.
    const spec = this.streamSpec(actor, type, filters);
    if (spec) {
      const rows: ReportRow[] = [];
      for (let skip = 0; ; skip += EXPORT_BATCH) {
        const page = await spec.page(skip, EXPORT_BATCH);
        rows.push(...page);
        if (page.length < EXPORT_BATCH) break;
      }
      return { title: spec.title, columns: spec.columns, rows };
    }

    switch (type) {
      case 'SPENDING_BY_VENDOR':
        return this.spendingBy(actor, 'vendor');
      case 'SPENDING_BY_CATEGORY':
        return this.spendingBy(actor, 'category');
      case 'SPENDING_BY_DEPARTMENT':
        return this.spendingBy(actor, 'department');
      case 'MAINTENANCE_COST':
        return this.maintenanceCost(actor);
      default:
        throw new AppError('VALIDATION_FAILED', `Unknown report type ${type}`);
    }
  }


  /**
   * The streamable reports: one row per record, so they grow with the tenant.
   *
   * The aggregate reports (spending by vendor/category/department, maintenance
   * cost) are NOT here on purpose: they are grouped in the database and return
   * one row per vendor or category. Streaming a twelve-row result would add
   * machinery to no end.
   */
  streamSpec(
    actor: AuthUser,
    type: ReportType,
    filters: { officeId?: string; departmentId?: string },
  ): StreamSpec | null {
    const showCost = canSeeCost(actor);

    if (type === 'ASSET_INVENTORY') {
      const where = {
        ...tenantFilter(actor),
        ...(filters.officeId ? { officeId: filters.officeId } : {}),
        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      };
      return {
        title: 'Asset inventory',
        // v2.28 - widened from seven columns to the full record. The old sheet
        // named an asset but not what it was, so "Dell" and "Monitor" (both
        // real names here) told a reader nothing, and a serial number - the one
        // field an audit turns on - was absent entirely.
        columns: [
          { key: 'assetTag', label: 'Asset tag' },
          { key: 'name', label: 'Name' },
          { key: 'category', label: 'Category' },
          { key: 'type', label: 'Type' },
          { key: 'brand', label: 'Brand' },
          { key: 'model', label: 'Model' },
          { key: 'serialNumber', label: 'Serial number' },
          { key: 'ram', label: 'RAM' },
          { key: 'storage', label: 'Storage' },
          { key: 'os', label: 'Operating system' },
          { key: 'status', label: 'Status' },
          { key: 'condition', label: 'Condition' },
          { key: 'office', label: 'Location' },
          { key: 'department', label: 'Department' },
          { key: 'assignee', label: 'Assigned to' },
          { key: 'assignedOn', label: 'Assigned on' },
          { key: 'purchaseDate', label: 'Purchased on' },
          { key: 'warrantyTill', label: 'Warranty till' },
          ...(showCost ? [{ key: 'cost', label: 'Purchase cost', numeric: true, decimals: 2 }] : []),
        ],
        page: async (skip, take) => {
          const assets = await this.prisma.client.asset.findMany({
            where,
            orderBy: [{ assetTag: 'asc' }, { id: 'asc' }],
            skip,
            take,
            select: {
              assetTag: true,
              name: true,
              status: true,
              condition: true,
              serialNumber: true,
              brand: true,
              model: true,
              specs: true,
              assignmentDate: true,
              purchaseDate: true,
              warrantyEndDate: true,
              purchaseCost: showCost,
              currency: showCost,
              category: { select: { name: true } },
              subcategory: { select: { name: true } },
              department: { select: { name: true } },
              // v2.39 - what the machine itself reported, preferred over the
              // typed specs below.
              hardwareProfile: { select: { ramGb: true, storageTotalGb: true } },
              osInfo: { select: { osName: true, osVersion: true } },
              office: { select: { name: true } },
              assignedUser: {
                select: { email: true, profile: { select: { firstName: true, lastName: true } } },
              },
            },
          });

          const fallbackOffice = await this.defaultLocation(actor);

          return assets.map((a) => {
            const specs = (a.specs ?? {}) as Record<string, unknown>;
            const holder = a.assignedUser?.profile;
            return {
              assetTag: a.assetTag,
              name: a.name,
              category: a.category?.name ?? '',
              type: a.subcategory?.name ?? '',
              brand: a.brand ?? '',
              model: a.model ?? '',
              serialNumber: a.serialNumber ?? '',
              ram: preferReported(reportedGb(a.hardwareProfile?.ramGb), specText(specs.ramGb, ' GB')),
              storage: preferReported(
                reportedGb(a.hardwareProfile?.storageTotalGb, 0),
                specText(specs.storage),
              ),
              os: preferReported(reportedOs(a.osInfo), specText(specs.os)),
              status: a.status,
              condition: a.condition,
              office: a.office?.name ?? fallbackOffice?.name ?? '',
              department: a.department?.name ?? '',
              // The person's name, with the address after it. A column of bare
              // addresses is unreadable to anyone outside IT.
              assignee: holder
                ? `${holder.firstName} ${holder.lastName}`.trim()
                : (a.assignedUser?.email ?? ''),
              assignedOn: isoDate(a.assignmentDate),
              purchaseDate: isoDate(a.purchaseDate),
              warrantyTill: isoDate(a.warrantyEndDate),
              // null (not 0) so an unpriced asset reads as "not recorded", never "free".
              ...(showCost ? { cost: a.purchaseCost ? Number(a.purchaseCost) : null } : {}),
            };
          });
        },
      };
    }

    if (type === 'EMPLOYEE_ASSETS') {
      return this.employeeAssetsSpec(actor, filters);
    }

    if (type === 'DEPRECIATION') {
      return {
        title: 'Depreciation',
        columns: [
          { key: 'assetTag', label: 'Asset tag' },
          { key: 'name', label: 'Name' },
          { key: 'method', label: 'Method' },
          { key: 'cost', label: 'Purchase cost', numeric: true, decimals: 2 },
          { key: 'depreciation', label: 'Accumulated', numeric: true, decimals: 2 },
          { key: 'current', label: 'Current value', numeric: true, decimals: 2 },
        ],
        page: async (skip, take) => {
          const now = new Date();
          const assets = await this.prisma.client.asset.findMany({
            where: { ...tenantFilter(actor), purchaseCost: { not: null } },
            orderBy: [{ assetTag: 'asc' }, { id: 'asc' }],
            skip,
            take,
            select: {
              assetTag: true,
              name: true,
              purchaseCost: true,
              salvageValue: true,
              usefulLifeMonths: true,
              depreciationMethod: true,
              purchaseDate: true,
            },
          });
          return assets.map((a) => {
            const result = computeDepreciation({
              method: a.depreciationMethod as DepreciationMethod,
              purchaseCost: a.purchaseCost?.toString() ?? '0',
              salvageValue: a.salvageValue?.toString() ?? '0',
              usefulLifeMonths: a.usefulLifeMonths,
              purchaseDate: a.purchaseDate ?? now,
              asOf: now,
            });
            return {
              assetTag: a.assetTag,
              name: a.name,
              method: a.depreciationMethod,
              cost: a.purchaseCost ? Number(a.purchaseCost) : null,
              depreciation: Number(result.accumulatedDepreciation),
              current: Number(result.currentValue),
            };
          });
        },
      };
    }

    return null;
  }

  private async spendingBy(
    actor: AuthUser,
    dimension: 'vendor' | 'category' | 'department',
  ): Promise<ReportTable> {
    // Aggregate asset purchase cost by the chosen dimension. Grouped in SQL for
    // correctness on large estates rather than summed in application code.
    const assets = await this.prisma.client.asset.findMany({
      where: { ...tenantFilter(actor), purchaseCost: { not: null } },
      select: {
        purchaseCost: true,
        currency: true,
        vendor: { select: { name: true } },
        category: { select: { name: true } },
        department: { select: { name: true } },
      },
    });

    const totals = new Map<string, { total: Prisma.Decimal; count: number }>();
    for (const asset of assets) {
      const key =
        dimension === 'vendor'
          ? (asset.vendor?.name ?? 'Unassigned')
          : dimension === 'category'
            ? (asset.category?.name ?? 'Uncategorised')
            : (asset.department?.name ?? 'No department');
      const entry = totals.get(key) ?? { total: new Prisma.Decimal(0), count: 0 };
      entry.total = entry.total.plus(asset.purchaseCost ?? 0);
      entry.count += 1;
      totals.set(key, entry);
    }

    const label = dimension.charAt(0).toUpperCase() + dimension.slice(1);
    return {
      title: `Spending by ${dimension}`,
      columns: [
        { key: 'name', label },
        { key: 'count', label: 'Assets', numeric: true },
        { key: 'total', label: 'Total spend', numeric: true, decimals: 2 },
      ],
      rows: [...totals.entries()]
        .sort((a, b) => b[1].total.comparedTo(a[1].total))
        .map(([name, entry]) => ({
          name,
          count: entry.count,
          total: Number(entry.total.toFixed(2)),
        })),
    };
  }

  /**
   * One row per person, everything they hold on that row (v2.28).
   *
   * The shape of the row is: who they are, the machine they work on in full
   * detail, and every other item they hold folded into a single cell. That
   * mirrors how a handover is actually checked - you look up a person, not an
   * asset tag - and it is why the extras are consolidated rather than given
   * rows of their own. Someone holding a laptop, two monitors, a headset and a
   * mouse was five rows that had to be recognised as one person; now they are
   * one row that reads at a glance.
   *
   * The main device is chosen by Type, not by guessing at the name. That is
   * only sound because Type is populated - 155 of 158 assets carry one, and
   * "Dell" and "Laptop Harpal-Acer" are both real names in the data, so a
   * keyword heuristic over names would have been wrong in both directions.
   * An asset whose Type is missing simply never outranks one that has it.
   */
  private employeeAssetsSpec(
    actor: AuthUser,
    filters: { officeId?: string; departmentId?: string },
  ): StreamSpec {
    return {
      title: 'Employee assets',
      columns: [
        { key: 'employee', label: 'Employee' },
        { key: 'employeeNumber', label: 'Emp #' },
        { key: 'email', label: 'Email' },
        { key: 'jobTitle', label: 'Job title' },
        { key: 'department', label: 'Department' },
        { key: 'location', label: 'Location' },
        { key: 'deviceType', label: 'Device type' },
        { key: 'device', label: 'Device' },
        { key: 'assetTag', label: 'Asset tag' },
        { key: 'brand', label: 'Brand' },
        { key: 'model', label: 'Model' },
        { key: 'serialNumber', label: 'Serial number' },
        { key: 'ram', label: 'RAM' },
        { key: 'storage', label: 'Storage' },
        { key: 'os', label: 'Operating system' },
        { key: 'condition', label: 'Condition' },
        { key: 'assignedOn', label: 'Assigned on' },
        { key: 'warrantyTill', label: 'Warranty till' },
        { key: 'handedOverBy', label: 'Handed over by' },
        { key: 'otherCount', label: 'Other items', numeric: true },
        { key: 'otherItems', label: 'Other items held' },
      ],
      page: async (skip, take) => {
        const holders = await this.prisma.client.user.findMany({
          where: {
            ...tenantFilter(actor),
            assignedAssets: {
              some: {
                deletedAt: null,
                ...(filters.officeId ? { officeId: filters.officeId } : {}),
                ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
              },
            },
          },
          // By surname within forename, with id last so a page boundary cannot
          // drop or repeat somebody (see the note on tiebreakers above).
          orderBy: [
            { profile: { firstName: 'asc' } },
            { profile: { lastName: 'asc' } },
            { id: 'asc' },
          ],
          skip,
          take,
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                firstName: true,
                lastName: true,
                employeeNumber: true,
                jobTitle: true,
                department: { select: { name: true } },
                office: { select: { name: true } },
              },
            },
            assignedAssets: {
              where: { deletedAt: null },
              select: {
                assetTag: true,
                name: true,
                brand: true,
                model: true,
                serialNumber: true,
                specs: true,
                condition: true,
                assignmentDate: true,
                warrantyEndDate: true,
                subcategory: { select: { name: true } },
                office: { select: { name: true } },
                // v2.39 - as on the inventory report: measured beats typed.
                hardwareProfile: { select: { ramGb: true, storageTotalGb: true } },
                osInfo: { select: { osName: true, osVersion: true } },
                assignments: {
                  where: { returnedAt: null },
                  orderBy: { assignedAt: 'desc' },
                  take: 1,
                  select: {
                    assignedBy: { select: { profile: { select: { firstName: true, lastName: true } } } },
                  },
                },
              },
            },
          },
        });

        // Both resolved once per page, not once per row.
        const [fallbackOffice, fallbackHandover] = await Promise.all([
          this.defaultLocation(actor),
          this.defaultHandoverName(actor),
        ]);

        return holders.map((holder) => {
          const held = [...holder.assignedAssets].sort(
            (a, b) => deviceRank(a.subcategory?.name) - deviceRank(b.subcategory?.name),
          );
          const [main, ...others] = held;
          const specs = (main?.specs ?? {}) as Record<string, unknown>;
          const grantedBy = main?.assignments[0]?.assignedBy?.profile;

          return {
            employee: `${holder.profile?.firstName ?? ''} ${holder.profile?.lastName ?? ''}`.trim(),
            employeeNumber: holder.profile?.employeeNumber ?? '',
            email: holder.email,
            jobTitle: holder.profile?.jobTitle ?? '',
            department: holder.profile?.department?.name ?? '',
            // The person's own office, then the asset's, then the company
            // default. A blank here reads as "we do not know where this
            // equipment is", which for a single-site company is worse than
            // untrue - it is alarming.
            location:
              holder.profile?.office?.name ?? main?.office?.name ?? fallbackOffice?.name ?? '',
            deviceType: main?.subcategory?.name ?? '',
            device: main?.name ?? '',
            assetTag: main?.assetTag ?? '',
            brand: main?.brand ?? '',
            model: main?.model ?? '',
            serialNumber: main?.serialNumber ?? '',
            ram: preferReported(reportedGb(main?.hardwareProfile?.ramGb), specText(specs.ramGb, ' GB')),
            storage: preferReported(
              reportedGb(main?.hardwareProfile?.storageTotalGb, 0),
              specText(specs.storage),
            ),
            os: preferReported(reportedOs(main?.osInfo), specText(specs.os)),
            condition: main?.condition ?? '',
            assignedOn: isoDate(main?.assignmentDate),
            warrantyTill: isoDate(main?.warrantyEndDate),
            handedOverBy: grantedBy
              ? `${grantedBy.firstName} ${grantedBy.lastName}`.trim()
              : fallbackHandover,
            otherCount: others.length,
            // One item per line in a single cell - the whole point of the
            // report. Tag first so it can be checked off against a shelf.
            otherItems: others
              .map((a) => `${a.assetTag}  ${a.name}${a.serialNumber ? `  (${a.serialNumber})` : ''}`)
              .join('\n'),
          };
        });
      },
    };
  }

  /**
   * The letterhead for a workbook export (v2.28).
   *
   * Who prepared it comes from the signed-in actor rather than the tenant
   * owner: a circulated spreadsheet should say who produced it, and that is
   * whoever pressed Download. (The *handover* fallback is the opposite case and
   * deliberately does not work this way - see `defaultHandoverName`.)
   *
   * Filters are named, not shown as ids. A sheet headed "Office: Mohali" can be
   * read on its own; one headed with a cuid cannot, and a filtered export that
   * does not say it is filtered is how a partial list gets circulated as a
   * complete one.
   */
  async workbookHeader(
    actor: AuthUser,
    filters: { officeId?: string; departmentId?: string },
  ): Promise<{ companyName: string; preparedBy: string; preparedByPhone: string | null; filters: string[] }> {
    const [company, office, department] = await Promise.all([
      this.prisma.client.company.findUnique({
        where: { id: actor.companyId },
        select: { name: true },
      }),
      filters.officeId
        ? this.prisma.client.office.findFirst({
            where: { id: filters.officeId, ...tenantFilter(actor) },
            select: { name: true },
          })
        : null,
      filters.departmentId
        ? this.prisma.client.department.findFirst({
            where: { id: filters.departmentId, ...tenantFilter(actor) },
            select: { name: true },
          })
        : null,
    ]);

    const named: string[] = [];
    if (filters.officeId) named.push(`Office: ${office?.name ?? 'unknown'}`);
    if (filters.departmentId) named.push(`Department: ${department?.name ?? 'unknown'}`);

    const preparedBy =
      [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim() || actor.email;

    return {
      companyName: company?.name ?? '',
      preparedBy,
      preparedByPhone: actor.phone ?? null,
      filters: named,
    };
  }

  /**
   * The company's default site, used when neither the person nor the asset
   * names one.
   *
   * `isDefault` is set by a Super Admin rather than inferred, because "the
   * office with the most assets" would silently move the default the first time
   * a second site grew - and a location on a handover document is the sort of
   * thing that has to be deliberate.
   */
  private async defaultLocation(actor: AuthUser): Promise<{ name: string } | null> {
    const offices = await this.prisma.client.office.findMany({
      where: { ...tenantFilter(actor), isDefault: true },
      take: 1,
      select: { name: true },
    });
    return offices[0] ?? null;
  }

  /**
   * Who a handover is attributed to when the record does not name anybody.
   *
   * This is the company's Super Admin - the account that owns the tenant and
   * under which the historic imports were run - and NOT the person running the
   * report. Attributing a handover to whoever pressed Download would put a
   * different name on the same equipment every time it was exported, which is
   * worse than the blank it replaces.
   *
   * Earliest-created, so a company with two Super Admins still produces the
   * same document twice running.
   */
  private async defaultHandoverName(actor: AuthUser): Promise<string> {
    const owner = await this.prisma.client.user.findFirst({
      where: { ...tenantFilter(actor), roles: { some: { role: { key: 'SUPER_ADMIN' } } } },
      orderBy: { createdAt: 'asc' },
      select: { profile: { select: { firstName: true, lastName: true } } },
    });
    const profile = owner?.profile;
    return profile ? `${profile.firstName} ${profile.lastName}`.trim() : '';
  }

  private async warrantyExpiry(actor: AuthUser): Promise<ReportTable> {
    const assets = await this.prisma.client.asset.findMany({
      where: { ...tenantFilter(actor), warrantyEndDate: { not: null } },
      orderBy: { warrantyEndDate: 'asc' },
      select: {
        assetTag: true,
        name: true,
        warrantyEndDate: true,
        vendor: { select: { name: true } },
      },
    });

    const now = new Date();
    return {
      title: 'Warranty expiry',
      columns: [
        { key: 'assetTag', label: 'Asset tag' },
        { key: 'name', label: 'Name' },
        { key: 'vendor', label: 'Vendor' },
        { key: 'endDate', label: 'Warranty ends' },
        { key: 'bucket', label: 'Window' },
      ],
      rows: assets.map((a) => ({
        assetTag: a.assetTag,
        name: a.name,
        vendor: a.vendor?.name ?? '',
        endDate: a.warrantyEndDate?.toISOString().slice(0, 10) ?? '',
        bucket: warrantyBucket(a.warrantyEndDate, now),
      })),
    };
  }

  private async maintenanceCost(actor: AuthUser): Promise<ReportTable> {
    const records = await this.prisma.client.maintenanceRecord.findMany({
      // Signed-off work only. Cost is entered at completion; until a manager
      // approves it the figure is a claim, not spend. (Every costed record
      // before sign-off existed is COMPLETED, so history is unchanged.)
      where: { asset: tenantFilter(actor), serviceCost: { not: null }, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: {
        title: true,
        type: true,
        serviceCost: true,
        downtimeHours: true,
        completedAt: true,
        asset: { select: { assetTag: true } },
      },
    });

    return {
      title: 'Maintenance cost',
      columns: [
        { key: 'assetTag', label: 'Asset tag' },
        { key: 'title', label: 'Work' },
        { key: 'type', label: 'Type' },
        { key: 'cost', label: 'Service cost', numeric: true, decimals: 2 },
        { key: 'downtime', label: 'Downtime (h)', numeric: true, decimals: 2 },
        { key: 'completed', label: 'Completed' },
      ],
      rows: records.map((r) => ({
        assetTag: r.asset.assetTag,
        title: r.title,
        type: r.type,
        cost: r.serviceCost ? Number(r.serviceCost) : 0,
        downtime: r.downtimeHours ? Number(r.downtimeHours) : 0,
        completed: r.completedAt?.toISOString().slice(0, 10) ?? '',
      })),
    };
  }
}
