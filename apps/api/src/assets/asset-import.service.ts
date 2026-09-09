import { Injectable, Logger } from '@nestjs/common';
import { Prisma, AssetStatus, AssetCondition, TrackingType, AuditAction } from '@prisma/client';
import type { AuthUser } from '@techpioasset/contracts';
import { ulid } from 'ulid';
import {
  ASSET_TYPES,
  ASSET_TYPES_BY_KEY,
  PERMISSIONS,
  sanitizeAssetSpecs,
} from '@techpioasset/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { parseSheet } from '../common/spreadsheet.js';
import { canSeeCost } from '../common/scope.js';

/**
 * Bulk asset import from a spreadsheet ("Upload Excel sheet").
 *
 * Accepts rows already parsed from the uploaded workbook and, in one
 * transaction, upserts the reference data, the employees, and the assets they
 * hold — so a re-upload of a corrected sheet updates in place rather than
 * duplicating. Employees are created as records with no login (status INVITED,
 * no password) and can be invited to sign in later; assets are keyed on their
 * serial ("Asset Id") for idempotency.
 */

export interface ImportRow {
  [header: string]: string | number | Date | null | undefined;
}

export interface ImportSummary {
  rows: number;
  employeesCreated: number;
  employeesMatched: number;
  assetsCreated: number;
  assetsUpdated: number;
  assigned: number;
  skipped: number;

  /**
   * v2.29 - what happened to the cost column, reported separately so a price
   * that did not land is never silent.
   *
   * `pricesIgnored` is the important one: an importer who cannot price assets
   * still gets a working import, and is told plainly that the money was left
   * out rather than being refused the upload or - far worse - allowed to set
   * prices they are not permitted to set.
   */
  pricesSet: number;
  /** Present in the sheet but dropped: the importer may not price assets. */
  pricesIgnored: number;
  /** Already recorded and left alone; prices are write-once. */
  pricesLocked: number;

  /**
   * v2.37 - rows that carried at least one usable specification.
   *
   * Reported so a spec column that matched nothing is visible. Types declare
   * different fields, so a "DPI" column is legitimately ignored on every laptop
   * row - and without a count, a sheet whose headers matched NOTHING would look
   * exactly like a successful import.
   */
  specsSet: number;

  errors: { row: number; message: string }[];
}

const CONDITION: Record<string, AssetCondition> = {
  new: AssetCondition.NEW,
  good: AssetCondition.GOOD,
  fair: AssetCondition.FAIR,
  poor: AssetCondition.POOR,
  damaged: AssetCondition.DAMAGED,
  unusable: AssetCondition.UNUSABLE,
};

const STATUS: Record<string, AssetStatus> = {
  available: AssetStatus.AVAILABLE,
  assigned: AssetStatus.ASSIGNED,
  'in use': AssetStatus.IN_USE,
  'in-use': AssetStatus.IN_USE,
  reserved: AssetStatus.RESERVED,
  'in storage': AssetStatus.IN_STORAGE,
  'under repair': AssetStatus.UNDER_REPAIR,
  repair: AssetStatus.UNDER_REPAIR,
  damaged: AssetStatus.DAMAGED,
  lost: AssetStatus.LOST,
  stolen: AssetStatus.STOLEN,
  retired: AssetStatus.RETIRED,
  disposed: AssetStatus.DISPOSED,
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

@Injectable()
export class AssetImportService {
  private readonly logger = new Logger(AssetImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Reads an uploaded sheet into header-keyed rows.
   *
   * The reader itself now lives in common/spreadsheet.ts, shared with the
   * vendor catalogue's importer: two copies of this would drift, and the only
   * thing that differed between them was which header row to look for.
   */
  async parseWorkbook(buffer: Buffer): Promise<ImportRow[]> {
    return parseSheet(buffer, { headerHint: /asset\s*id/i });
  }

  /** Case/space-insensitive lookup of a cell by any of the given header names. */
  private cell(row: ImportRow, ...names: string[]): string | Date | null {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const wanted = names.map(norm);
    for (const [key, value] of Object.entries(row)) {
      if (wanted.includes(norm(key))) {
        if (value == null || value === '') return null;
        return value instanceof Date ? value : String(value).trim();
      }
    }
    return null;
  }

  /**
   * Specifications for one row, taken from whatever columns apply to its type
   * (v2.37).
   *
   * Matched per row against the fields that THIS asset's type declares, not
   * against a fixed column list. Types declare different things - a laptop has
   * RAM and an operating system, a mouse has DPI, a monitor has a refresh rate -
   * so one sheet can carry every spec column there is and each row picks up
   * only what applies to it. A DPI column is simply ignored on a laptop row.
   *
   * Columns are found by the field's LABEL as well as its key, because the
   * label is what a person types: "Operating system", not "os". Header matching
   * is already case- and punctuation-insensitive (see `cell`).
   *
   * `sanitizeAssetSpecs` has the last word - it drops anything the type does not
   * declare and caps length - so a malformed or hostile header cannot turn the
   * specs column into a document store.
   */
  private specsFrom(row: ImportRow, typeKey: string): Record<string, string> | undefined {
    const def = ASSET_TYPES_BY_KEY[typeKey];
    if (!def) return undefined;

    const raw: Record<string, string> = {};
    for (const field of def.fields) {
      const value = this.cell(row, field.label, field.key);
      if (value === null || value instanceof Date) continue;

      const text = String(value).trim();
      if (!text) continue;

      // A numeric field keeps the number and drops the unit. "16 GB" in the RAM
      // column would otherwise be stored whole and rendered as "16 GB GB",
      // because the unit is appended when it is displayed.
      if (field.kind === 'number') {
        const numeric = /^\s*(-?\d+(?:\.\d+)?)/.exec(text.replace(/,/g, ''));
        if (!numeric) continue;
        raw[field.key] = numeric[1]!;
        continue;
      }

      raw[field.key] = text;
    }

    return sanitizeAssetSpecs(typeKey, raw);
  }

  /**
   * A price from a spreadsheet cell (v2.29).
   *
   * Exported for its own tests, because the failure mode here is silent and
   * expensive: a cell that parses to the wrong NUMBER is worse than one that
   * fails to parse, and both look identical in an import summary.
   *
   * Handles what people actually type in a cost column - a currency symbol, a
   * thousands separator, whitespace, and Indian lakh grouping (1,20,000), which
   * plain `Number()` reads as NaN. Returns null for anything it cannot read
   * with confidence rather than a guess.
   *
   * A zero is deliberately rejected: an asset does not cost nothing, and a
   * literal 0 in a cost column is nearly always an empty row, a formula that
   * produced no value, or a placeholder. Recording it as a real price would
   * make a genuine gap look like a settled fact.
   */
  parseMoney(value: string | Date | number | null): Prisma.Decimal | null {
    if (value === null || value === undefined || value instanceof Date) return null;

    if (typeof value === 'number') {
      return Number.isFinite(value) && value > 0 ? new Prisma.Decimal(value.toFixed(2)) : null;
    }

    // Strip currency symbols, letters (INR/Rs/USD) and separators, keeping only
    // the number itself. Commas go wherever they sit, so both 120,000 and the
    // lakh grouping 1,20,000 reduce to the same digits.
    const cleaned = value
      .replace(/[₹$£€]/g, '')
      // The trailing dot is part of the pattern: "Rs." is how this is usually
      // written locally, and stripping only the letters left ".68000", which
      // then failed to parse at all.
      .replace(/\b(inr|rs|usd|eur|gbp)\b\.?/gi, '')
      .replace(/[,\s]/g, '')
      .trim();

    if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;

    const parsed = Number(cleaned);
    // Negative is refused rather than made positive: a minus sign in a cost
    // column means the sheet is not what we think it is, and quietly correcting
    // it would hide that.
    if (!Number.isFinite(parsed) || parsed <= 0) return null;

    return new Prisma.Decimal(parsed.toFixed(2));
  }

  private toDate(value: string | Date | null): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  async importRows(actor: AuthUser, rows: ImportRow[]): Promise<ImportSummary> {
    const companyId = actor.companyId;
    const summary: ImportSummary = {
      rows: rows.length,
      employeesCreated: 0,
      employeesMatched: 0,
      assetsCreated: 0,
      assetsUpdated: 0,
      assigned: 0,
      skipped: 0,
      pricesSet: 0,
      pricesIgnored: 0,
      pricesLocked: 0,
      specsSet: 0,
      errors: [],
    };

    // v2.29 - the same two rules the Assets service enforces, applied here so a
    // spreadsheet cannot route around them:
    //   * only a cost-visible role may set a price at all;
    //   * a price already recorded is write-once, correctable only by a Super
    //     Admin. Without this, re-uploading a corrected sheet - which the
    //     importer explicitly supports, since it updates in place - would
    //     silently rewrite prices that the UI refuses to let anyone change.
    const mayPrice = canSeeCost(actor);
    const mayCorrectPrice = actor.permissions.includes(PERMISSIONS.PERMISSIONS_MANAGE);
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { baseCurrency: true },
    });
    const baseCurrency = company?.baseCurrency ?? null;

    const employeeRole = await this.prisma.client.role.findFirst({
      where: { companyId, key: 'EMPLOYEE' },
    });
    if (!employeeRole) {
      throw new AppError('INTERNAL_ERROR', 'The EMPLOYEE role is missing; seed the company first.');
    }

    // Caches so repeated categories/subcategories/employees hit the DB once.
    const categoryCache = new Map<string, string>();
    const subcategoryCache = new Map<string, { id: string; key: string }>();
    const employeeCache = new Map<string, string>();

    const ensureCategory = async (name: string): Promise<string> => {
      const key = slug(name) || 'general';
      const cached = categoryCache.get(key);
      if (cached) return cached;
      const cat = await this.prisma.client.category.upsert({
        where: { companyId_key: { companyId, key } },
        create: { companyId, key, name, defaultTrackingType: TrackingType.INDIVIDUAL },
        update: {},
        select: { id: true },
      });
      categoryCache.set(key, cat.id);
      return cat.id;
    };

    /**
     * v2.37 - returns the KEY as well as the id, because specifications are
     * declared per type key and the importer previously had no way to know it.
     *
     * The key comes from the declared type catalogue whenever the sheet names
     * one, and only falls back to slugging. "Monitor / Screen" slugs to
     * `monitor-screen`, while the declared - and seeded - type is `monitor`; so
     * without this an import would quietly create a second monitor type, file
     * the assets under it, and drop every specification, because nothing
     * declares fields for `monitor-screen`.
     *
     * Matched on the catalogue rather than on existing rows because the two can
     * sit under different categories: the seed files monitors under Hardware,
     * while a sheet saying "IT Assets" resolves elsewhere, and a lookup scoped
     * to the category would miss.
     */
    const ensureSubcategory = async (
      categoryId: string,
      name: string,
    ): Promise<{ id: string; key: string }> => {
      const slugged = slug(name) || 'general';
      const declared = ASSET_TYPES.find(
        (t) => t.key === slugged || slug(t.name) === slugged || slug(t.key) === slugged,
      );
      const key = declared?.key ?? slugged;

      const cacheKey = `${categoryId}:${key}`;
      const cached = subcategoryCache.get(cacheKey);
      if (cached) return cached;

      const sub = await this.prisma.client.subcategory.upsert({
        where: { categoryId_key: { categoryId, key } },
        create: { categoryId, key, name },
        update: {},
        select: { id: true, key: true },
      });
      subcategoryCache.set(cacheKey, sub);
      return sub;
    };

    const ensureEmployee = async (
      employeeNumber: string,
      fullName: string | null,
    ): Promise<string> => {
      const cached = employeeCache.get(employeeNumber);
      if (cached) return cached;

      const existing = await this.prisma.client.userProfile.findFirst({
        where: { employeeNumber, user: { companyId } },
        select: { userId: true },
      });
      if (existing) {
        employeeCache.set(employeeNumber, existing.userId);
        summary.employeesMatched += 1;
        return existing.userId;
      }

      const name = (fullName ?? employeeNumber).trim();
      const [firstName, ...rest] = name.split(/\s+/);
      const email = `${employeeNumber.toLowerCase()}@import.local`;

      // Records with no password and INVITED status — assignable now, invitable later.
      const user = await this.prisma.client.user.create({
        data: {
          companyId,
          email,
          passwordHash: null,
          status: 'INVITED',
          roles: { create: { roleId: employeeRole.id } },
          profile: {
            create: {
              firstName: firstName || name,
              lastName: rest.join(' ') || '-',
              employeeNumber,
            },
          },
        },
        select: { id: true },
      });
      employeeCache.set(employeeNumber, user.id);
      summary.employeesCreated += 1;
      return user.id;
    };

    // A running tag sequence for newly-created assets, continuing past any
    // existing "AST-" tags so re-imports never collide.
    const existingCount = await this.prisma.client.asset.count({
      where: { companyId, assetTag: { startsWith: 'AST-' } },
    });
    let tagSeq = existingCount;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row) continue;
      const rowNo = i + 2; // 1-based + header
      try {
        const serial = this.cell(row, 'Asset Id', 'Serial Number', 'Serial');
        const name = this.cell(row, 'Asset Name', 'Name');
        if (!serial && !name) {
          summary.skipped += 1;
          continue;
        }
        const serialStr = serial ? String(serial) : null;
        const nameStr = name ? String(name) : `Asset ${serialStr ?? rowNo}`;

        const categoryName = (this.cell(row, 'Asset Category', 'Category') as string) || 'Hardware';
        const typeName = (this.cell(row, 'Asset Type', 'Type') as string) || 'General';
        const categoryId = await ensureCategory(categoryName);
        const subcategory = await ensureSubcategory(categoryId, typeName);

        const conditionRaw = String(
          this.cell(row, 'Asset Condition', 'Condition') ?? '',
        ).toLowerCase();
        const statusRaw = String(this.cell(row, 'Asset Status', 'Status') ?? '').toLowerCase();
        const condition = CONDITION[conditionRaw] ?? AssetCondition.GOOD;
        let status = STATUS[statusRaw] ?? AssetStatus.AVAILABLE;

        // v2.29. Read for everyone so the sheet can be reported on honestly,
        // applied only where permitted - see the decision below.
        const costCell = this.cell(row, 'Purchase Cost', 'Cost', 'Price', 'Amount');
        const cost = this.parseMoney(costCell);
        const currency =
          (this.cell(row, 'Currency') as string | null)?.toUpperCase().slice(0, 3) || baseCurrency;

        // v2.37 - read against this row's own type; see `specsFrom`.
        const specs = this.specsFrom(row, subcategory.key);
        if (specs) summary.specsSet += 1;

        const purchaseDate = this.toDate(this.cell(row, 'Purchased On', 'Purchase Date'));
        const warrantyEndDate = this.toDate(
          this.cell(row, 'Warranty expires on', 'Warranty End Date', 'Warranty Expiry'),
        );
        const assignmentDate = this.toDate(this.cell(row, 'Date of Asset Assignment'));

        const empNumber = this.cell(row, 'Assigned To Employee Number', 'Employee Number') as
          string | null;
        const empName = this.cell(row, 'Employee Name, if Assigned', 'Employee Name') as
          string | null;

        let assignedUserId: string | null = null;
        if (empNumber) {
          assignedUserId = await ensureEmployee(String(empNumber), empName);
          // An assigned employee implies the asset is out, even if the sheet
          // left the status blank.
          if (status === AssetStatus.AVAILABLE) status = AssetStatus.ASSIGNED;
        }

        // Upsert the asset by serial (idempotent re-import).
        const existingAsset = serialStr
          ? await this.prisma.client.asset.findFirst({
              where: { companyId, serialNumber: serialStr },
              select: { id: true, assetTag: true, purchaseCost: true },
            })
          : null;

        /**
         * Whether this row's price is actually written, and why not when it is
         * not. Counted rather than thrown: one unpriceable row must not fail an
         * import of two hundred good ones.
         */
        let priceToWrite: Prisma.Decimal | null = null;
        if (cost !== null) {
          const alreadyPriced =
            existingAsset?.purchaseCost !== null && existingAsset?.purchaseCost !== undefined;
          if (!mayPrice) {
            summary.pricesIgnored += 1;
          } else if (alreadyPriced && !mayCorrectPrice) {
            summary.pricesLocked += 1;
          } else {
            priceToWrite = cost;
            summary.pricesSet += 1;
          }
        }

        const data = {
          name: nameStr,
          categoryId,
          subcategoryId: subcategory.id,
          trackingType: TrackingType.INDIVIDUAL,
          serialNumber: serialStr,
          purchaseDate,
          warrantyEndDate,
          condition,
          status,
          assignedUserId,
          assignmentDate: assignedUserId ? (assignmentDate ?? new Date()) : null,
          updatedById: actor.id,
          // Spread like the price: a sheet without spec columns must not wipe
          // specifications that are already recorded.
          ...(specs ? { specs } : {}),
          // Spread, not a plain field: writing `purchaseCost: null` when the
          // sheet has no cost column would ERASE a price already recorded, and
          // an import that quietly clears prices is the exact failure the
          // write-once rule exists to prevent.
          ...(priceToWrite !== null
            ? { purchaseCost: priceToWrite, ...(currency ? { currency } : {}) }
            : {}),
        };

        let assetId: string;
        if (existingAsset) {
          await this.prisma.client.asset.update({ where: { id: existingAsset.id }, data });
          summary.assetsUpdated += 1;
          assetId = existingAsset.id;
        } else {
          tagSeq += 1;
          const created = await this.prisma.client.asset.create({
            data: {
              ...data,
              companyId,
              assetTag: `AST-${String(tagSeq).padStart(4, '0')}`,
              qrToken: ulid(),
              createdById: actor.id,
            },
            select: { id: true },
          });
          summary.assetsCreated += 1;
          assetId = created.id;
        }

        // One audit row per price, matching what `setPrice` writes when the
        // same figure is typed in the UI. The bulk summary at the end records
        // that an import happened; it cannot answer "where did this asset's
        // price come from", which is the question asked of a money field.
        if (priceToWrite !== null) {
          await this.audit.record({
            companyId,
            actorId: actor.id,
            action: AuditAction.ASSET_COST_CHANGED,
            entityType: 'Asset',
            entityId: assetId,
            previousValues: { purchaseCost: String(existingAsset?.purchaseCost ?? '') },
            newValues: { purchaseCost: priceToWrite.toString(), currency, source: 'import' },
          });
        }

        if (assignedUserId) summary.assigned += 1;
      } catch (err) {
        const message =
          err instanceof Prisma.PrismaClientKnownRequestError
            ? `${err.code}: ${(err.meta?.target as string[] | undefined)?.join(', ') ?? err.message}`
            : err instanceof Error
              ? err.message
              : 'Unknown error';
        summary.errors.push({ row: rowNo, message });
      }
    }

    await this.audit.record({
      companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_CREATED,
      entityType: 'Asset',
      entityId: 'bulk-import',
      newValues: {
        rows: summary.rows,
        assetsCreated: summary.assetsCreated,
        assetsUpdated: summary.assetsUpdated,
        employeesCreated: summary.employeesCreated,
        pricesSet: summary.pricesSet,
        pricesIgnored: summary.pricesIgnored,
        pricesLocked: summary.pricesLocked,
        specsSet: summary.specsSet,
      },
    });

    this.logger.log(
      `Import by ${actor.id}: +${summary.assetsCreated} assets, ~${summary.assetsUpdated}, ` +
        `+${summary.employeesCreated} employees, ${summary.errors.length} errors, ` +
        `prices ${summary.pricesSet} set / ${summary.pricesIgnored} ignored / ${summary.pricesLocked} locked, ` +
        `specs on ${summary.specsSet} rows`,
    );
    return summary;
  }
}
