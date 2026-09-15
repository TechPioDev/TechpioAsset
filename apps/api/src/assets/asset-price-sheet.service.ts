import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { AuthUser } from '@techpioasset/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { assetScopeFilter } from '../common/scope.js';
import { MAX_WORKBOOK_ROWS } from '../reports/report-workbook.js';
import { buildPriceSheetWorkbook, PRICE_SHEET_COLUMNS } from './price-sheet-workbook.js';

/**
 * The price sheet (v2.59): purchase price and purchase date for assets that
 * already exist, filled in by Excel round-trip.
 *
 * Production arrived with every asset unpriced and almost none dated, and
 * typing 167 prices one asset page at a time is not a job anyone finishes. So
 * Finance downloads a sheet of the estate, fills two columns, and uploads it.
 *
 * The rules are the ones a single price entry already obeys, applied to a
 * spreadsheet so it cannot route around them:
 *
 *   - A recorded price is write-once. The sheet NEVER changes one - not even
 *     for a Super Admin, who may correct a price from the asset itself, where
 *     the correction is one deliberate act rather than one cell among thousands.
 *   - A purchase date is filled only where none is recorded. A different date
 *     already on the asset is reported, not overwritten.
 *   - Every price and every date written gets its own audit row, in the same
 *     shape the asset page writes, so "where did this figure come from" is
 *     answerable per asset rather than only as "an upload happened".
 *
 * Writes are guarded in the UPDATE itself (`purchaseCost IS NULL`), not only in
 * the check before it, so a price someone records between preview and apply
 * cannot be overwritten by a sheet that was checked a minute earlier.
 */

/**
 * Most rows one upload may fill in. Counted on rows that carry a new price or
 * date, not on the whole sheet: the downloaded sheet lists every asset, and a
 * large estate must still be able to send back the one it downloaded.
 */
export const MAX_PRICE_SHEET_ROWS = 5000;

/** Absolute ceiling on rows read at all - the branded workbook's own cap. */
const MAX_SHEET_LINES = 20_000;

/** Earliest purchase date accepted - older is a typo, not a laptop. */
const EARLIEST_PURCHASE_DATE = '1990-01-01';

export type PriceSheetOutcome = 'WILL_SET_PRICE' | 'WILL_SET_DATE' | 'UNCHANGED' | 'ERROR';

export interface PriceSheetRowResult {
  /** The row number as Excel shows it, so a person can find it. */
  row: number;
  assetTag: string;
  assetId: string | null;
  assetName: string | null;
  /** One or both of the WILL_SET codes, or exactly UNCHANGED, or exactly ERROR. */
  outcomes: PriceSheetOutcome[];
  currentPrice: string | null;
  newPrice: string | null;
  currency: string | null;
  currentDate: string | null;
  newDate: string | null;
  /** Why a row is an error, or a note on something left alone. */
  messages: string[];
  /** True once written (commit only). */
  applied: boolean;
}

export interface PriceSheetResult {
  dryRun: boolean;
  rows: number;
  counts: {
    /** Rows that will change (or did), whatever they set. */
    toChange: number;
    pricesToSet: number;
    datesToSet: number;
    /** Rows that change nothing: left blank, or holding what is already recorded. */
    unchanged: number;
    /** Of those, rows with neither new column filled in (not listed in results). */
    blank: number;
    errors: number;
  };
  /** What was actually written. All zero on a dry run. */
  applied: { rows: number; prices: number; dates: number };
  results: PriceSheetRowResult[];
}

type Cell = string | number | Date | null;

/** An ExcelJS cell as a plain value: rich text, hyperlinks and formulas unwrapped. */
function plain(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    const o = v as {
      text?: unknown;
      result?: unknown;
      richText?: { text: string }[];
      error?: unknown;
    };
    if (Array.isArray(o.richText)) return plain(o.richText.map((r) => r.text).join(''));
    if (typeof o.text === 'string') return plain(o.text);
    if ('result' in o) return plain((o.result ?? null) as ExcelJS.CellValue);
  }
  return null;
}

const normaliseHeader = (s: string) =>
  s
    // "New purchase date (YYYY-MM-DD)" is the date column, hint or no hint.
    .replace(/\(.*\)/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** YYYY-MM-DD for a stored purchase date. Dates are stored at UTC midnight. */
function isoDay(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Today in the company's own zone, as YYYY-MM-DD. */
function todayIn(timeZone: string): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** "₹1,20,000.00" for a message; other currencies keep their code. */
function moneyLabel(amount: string, currency: string | null): string {
  const [whole, fraction = '00'] = new Prisma.Decimal(amount).toFixed(2).split('.');
  if (!currency || currency === 'INR') {
    const last3 = whole!.slice(-3);
    const rest = whole!.slice(0, -3);
    const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
    return `₹${grouped}.${fraction}`;
  }
  return `${currency} ${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

/**
 * A price cell. Exported for unit tests: a cell read as the WRONG number is
 * worse than one refused, and both look the same in a summary.
 *
 * Unlike the asset importer's reader, this never rounds and never guesses - a
 * third decimal, a minus sign or a zero is an error with its own message, since
 * the whole point of this sheet is that the figure typed is the figure kept.
 */
export function parsePriceCell(
  raw: Cell,
): { ok: true; value: string } | { ok: false; message: string } {
  if (raw === null) return { ok: false, message: 'Price is empty' };
  if (raw instanceof Date)
    return { ok: false, message: 'New purchase price is a date, not a number' };

  let text: string;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, message: 'New purchase price is not a number' };
    text = String(raw);
    if (/e/i.test(text)) return { ok: false, message: 'New purchase price is too large' };
  } else {
    text = raw
      .replace(/[₹$£€]/g, '')
      .replace(/\b(inr|rs|usd|eur|gbp)\b\.?/gi, '')
      .replace(/[,\s]/g, '')
      .trim();
  }

  if (/^-/.test(text)) return { ok: false, message: 'New purchase price cannot be negative' };
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return { ok: false, message: `New purchase price "${String(raw)}" is not a number` };
  }
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > 2) {
    return { ok: false, message: 'New purchase price has more than 2 decimal places' };
  }
  const digits = whole!.replace(/^0+(?=\d)/, '');
  if (digits.length > 12) return { ok: false, message: 'New purchase price is too large' };
  const value = new Prisma.Decimal(text);
  if (value.lte(0)) return { ok: false, message: 'New purchase price must be more than zero' };
  return { ok: true, value: value.toFixed(2) };
}

/**
 * A date cell as YYYY-MM-DD. Exported for unit tests.
 *
 * Excel turns a typed date into a real date cell whatever the column format,
 * so both a date cell and the YYYY-MM-DD text are accepted. Day/month text is
 * refused rather than guessed: 03/04/2024 is March to one reader and April to
 * the next, and a wrong purchase date is silently wrong forever.
 */
export function parseDateCell(
  raw: Cell,
  today: string,
): { ok: true; value: string } | { ok: false; message: string } {
  if (raw === null) return { ok: false, message: 'Date is empty' };
  let iso: string | null = null;
  if (raw instanceof Date) {
    // ExcelJS reads a date cell as that calendar day at UTC midnight.
    if (Number.isNaN(raw.getTime()))
      return { ok: false, message: 'New purchase date is not a date' };
    iso = raw.toISOString().slice(0, 10);
  } else if (typeof raw === 'number') {
    // A date pasted or typed into the text-formatted column arrives as Excel's
    // day serial (days since 1899-12-30) rather than as a date cell. Whole
    // numbers only: a fraction is a time, or not a date at all.
    if (!Number.isInteger(raw) || raw < 1 || raw > 2958465) {
      return { ok: false, message: `New purchase date "${raw}" is not in the format YYYY-MM-DD` };
    }
    iso = new Date(Date.UTC(1899, 11, 30) + raw * 86_400_000).toISOString().slice(0, 10);
  } else if (typeof raw === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/.exec(raw.trim());
    if (m) {
      const [, y, mo, d] = m;
      const probe = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
      if (
        probe.getUTCFullYear() === Number(y) &&
        probe.getUTCMonth() === Number(mo) - 1 &&
        probe.getUTCDate() === Number(d)
      ) {
        iso = `${y}-${mo}-${d}`;
      } else {
        return { ok: false, message: `New purchase date "${raw}" is not a real date` };
      }
    }
  }
  if (!iso) {
    return {
      ok: false,
      message: `New purchase date "${String(raw)}" is not in the format YYYY-MM-DD`,
    };
  }
  if (iso < EARLIEST_PURCHASE_DATE) {
    return { ok: false, message: 'New purchase date is before 1990' };
  }
  if (iso > today) return { ok: false, message: 'New purchase date is in the future' };
  return { ok: true, value: iso };
}

interface SheetLine {
  row: number;
  tag: string;
  price: Cell;
  date: Cell;
  currency: Cell;
}

@Injectable()
export class AssetPriceSheetService {
  private readonly logger = new Logger(AssetPriceSheetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Download
  // ───────────────────────────────────────────────────────────────────────────

  async download(actor: AuthUser): Promise<{ file: Buffer; filename: string; rows: number }> {
    const company = await this.prisma.client.company.findUniqueOrThrow({
      where: { id: actor.companyId },
      select: { name: true, baseCurrency: true, timezone: true },
    });

    // The asset list's own scope; soft-deleted rows are excluded globally.
    // One past the workbook's cap, so an estate too large for one sheet is
    // refused with a message rather than read whole into memory.
    const assets = await this.prisma.client.asset.findMany({
      where: assetScopeFilter(actor),
      take: MAX_WORKBOOK_ROWS + 1,
      select: {
        assetTag: true,
        name: true,
        purchaseCost: true,
        currency: true,
        purchaseDate: true,
        category: { select: { name: true } },
        subcategory: { select: { name: true } },
        office: { select: { name: true } },
        assignedUser: {
          select: { email: true, profile: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (assets.length > MAX_WORKBOOK_ROWS) {
      throw new AppError(
        'VALIDATION_FAILED',
        `More than ${MAX_WORKBOOK_ROWS.toLocaleString('en-IN')} assets are too many for one price sheet`,
      );
    }

    const text = (v: string | null | undefined) => (v ?? '').trim();
    assets.sort(
      (a, b) =>
        text(a.category?.name).localeCompare(text(b.category?.name)) ||
        text(a.subcategory?.name).localeCompare(text(b.subcategory?.name)) ||
        a.assetTag.localeCompare(b.assetTag, undefined, { numeric: true }),
    );

    const rows = assets.map((a) => {
      const holder = a.assignedUser
        ? [a.assignedUser.profile?.firstName, a.assignedUser.profile?.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || a.assignedUser.email
        : '';
      return {
        assetTag: a.assetTag,
        name: a.name,
        category: a.category?.name ?? '',
        type: a.subcategory?.name ?? '',
        office: a.office?.name ?? '',
        assignedTo: holder,
        currentPrice: a.purchaseCost !== null ? Number(a.purchaseCost) : null,
        currency: a.currency ?? company.baseCurrency,
        currentDate: isoDay(a.purchaseDate),
        newPrice: null,
        newDate: null,
      };
    });

    const preparedBy =
      [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim() || actor.email;
    const file = await buildPriceSheetWorkbook(
      {
        companyName: company.name,
        reportTitle: 'Price sheet',
        preparedBy,
        preparedByPhone: actor.phone ?? null,
        generatedAt: new Date(),
        filters: ['Fill "New purchase price" and "New purchase date" - see the Instructions sheet'],
      },
      rows,
      company.baseCurrency,
    );

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.REPORT_EXPORTED,
      entityType: 'Report',
      entityId: 'ASSET_PRICE_SHEET',
      newValues: { format: 'XLSX', rows: rows.length, delivery: 'DOWNLOAD' },
    });

    return {
      file,
      filename: `price-sheet-${todayIn(company.timezone)}.xlsx`,
      rows: rows.length,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Upload
  // ───────────────────────────────────────────────────────────────────────────

  /** Reads the uploaded workbook into lines keyed by the sheet's own columns. */
  async readSheet(buffer: Buffer): Promise<{ lines: SheetLine[]; blank: number }> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new AppError('FILE_REJECTED', 'That file could not be read as an Excel workbook', {
        detail: 'Upload the .xlsx price sheet downloaded from this page.',
      });
    }

    const candidates = [
      wb.worksheets.find((w) => normaliseHeader(w.name) === 'pricesheet'),
      ...wb.worksheets,
    ].filter((w): w is ExcelJS.Worksheet => Boolean(w));

    const wanted = {
      tag: normaliseHeader(PRICE_SHEET_COLUMNS.assetTag),
      price: normaliseHeader(PRICE_SHEET_COLUMNS.newPrice),
      date: normaliseHeader(PRICE_SHEET_COLUMNS.newDate),
      currency: normaliseHeader(PRICE_SHEET_COLUMNS.currency),
    };

    for (const ws of candidates) {
      // The letterhead sits above the table, so the heading row is searched for.
      for (let r = 1; r <= Math.min(40, ws.rowCount); r += 1) {
        const cols: Partial<Record<keyof typeof wanted, number>> = {};
        ws.getRow(r).eachCell({ includeEmpty: false }, (cell, colNumber) => {
          const heading = plain(cell.value);
          if (typeof heading !== 'string') return;
          const key = normaliseHeader(heading);
          for (const [name, target] of Object.entries(wanted)) {
            if (key === target && cols[name as keyof typeof wanted] === undefined) {
              cols[name as keyof typeof wanted] = colNumber;
            }
          }
        });
        if (cols.tag === undefined) continue;
        if (cols.price === undefined && cols.date === undefined) {
          throw new AppError(
            'FILE_REJECTED',
            'This sheet has no "New purchase price" or "New purchase date" column',
            {
              detail: 'Download a fresh price sheet and fill in that one.',
            },
          );
        }

        if (ws.rowCount - r > MAX_SHEET_LINES) {
          throw new AppError(
            'FILE_REJECTED',
            `The sheet has more than ${MAX_SHEET_LINES.toLocaleString('en-IN')} rows`,
            { detail: 'Split it into smaller sheets and upload each one.' },
          );
        }
        const lines: SheetLine[] = [];
        let blank = 0;
        for (let i = r + 1; i <= ws.rowCount; i += 1) {
          const row = ws.getRow(i);
          const get = (col: number | undefined): Cell =>
            col === undefined ? null : plain(row.getCell(col).value);
          const tagCell = get(cols.tag);
          const line: SheetLine = {
            row: i,
            tag:
              tagCell === null
                ? ''
                : String(tagCell instanceof Date ? tagCell.toISOString() : tagCell).trim(),
            price: get(cols.price),
            date: get(cols.date),
            currency: get(cols.currency),
          };
          // Nothing asked of this row: a listed asset left alone, or a blank line.
          // Currency alone is not a request - it only labels a price.
          if (line.price === null && line.date === null) {
            if (line.tag) blank += 1;
            continue;
          }
          lines.push(line);
          if (lines.length > MAX_PRICE_SHEET_ROWS) {
            throw new AppError(
              'FILE_REJECTED',
              `More than ${MAX_PRICE_SHEET_ROWS.toLocaleString('en-IN')} rows are filled in`,
              { detail: 'Split them across smaller uploads.' },
            );
          }
        }
        return { lines, blank };
      }
    }

    throw new AppError('FILE_REJECTED', 'This does not look like a price sheet', {
      detail:
        'No "Asset tag" column was found. Download the price sheet from this page and fill in that one.',
    });
  }

  async upload(actor: AuthUser, buffer: Buffer, dryRun: boolean): Promise<PriceSheetResult> {
    const { lines, blank } = await this.readSheet(buffer);
    const company = await this.prisma.client.company.findUniqueOrThrow({
      where: { id: actor.companyId },
      select: { baseCurrency: true, timezone: true },
    });
    const today = todayIn(company.timezone);

    // One query for every tag in the sheet, within the same scope the download
    // used. A tag from another company is simply not found - the answer is the
    // same as for a typo, so the sheet reveals nothing about other tenants.
    const tags = [...new Set(lines.map((l) => l.tag).filter(Boolean))];
    const assets = tags.length
      ? await this.prisma.client.asset.findMany({
          where: { AND: [assetScopeFilter(actor), { assetTag: { in: tags } }] },
          // Tags are unique per company, so this can never exceed the tag list,
          // which readSheet already capped.
          take: MAX_PRICE_SHEET_ROWS,
          select: {
            id: true,
            assetTag: true,
            name: true,
            purchaseCost: true,
            currency: true,
            purchaseDate: true,
          },
        })
      : [];
    const byTag = new Map(assets.map((a) => [a.assetTag, a]));

    const seen = new Map<string, number>();
    const results: PriceSheetRowResult[] = [];

    for (const line of lines) {
      const asset = line.tag ? byTag.get(line.tag) : undefined;
      const result: PriceSheetRowResult = {
        row: line.row,
        assetTag: line.tag,
        assetId: asset?.id ?? null,
        assetName: asset?.name ?? null,
        outcomes: [],
        currentPrice: asset?.purchaseCost != null ? asset.purchaseCost.toFixed(2) : null,
        newPrice: null,
        currency: null,
        currentDate: isoDay(asset?.purchaseDate ?? null),
        newDate: null,
        messages: [],
        applied: false,
      };
      results.push(result);
      const errors: string[] = [];
      const willSet: PriceSheetOutcome[] = [];

      if (!line.tag) {
        errors.push('Asset tag is missing');
      } else if (seen.has(line.tag)) {
        errors.push(
          `Asset tag ${line.tag} appears more than once (first on row ${seen.get(line.tag)})`,
        );
      } else {
        seen.set(line.tag, line.row);
        if (!asset) errors.push(`No asset with tag ${line.tag} in this company`);
      }

      // Price.
      if (line.price !== null) {
        const parsed = parsePriceCell(line.price);
        let currency: string | null = null;
        if (line.currency === null) {
          currency = asset?.currency ?? company.baseCurrency;
        } else if (typeof line.currency === 'string' && /^[A-Za-z]{3}$/.test(line.currency)) {
          currency = line.currency.toUpperCase();
        } else {
          errors.push(`Currency "${String(line.currency)}" is not a three-letter code such as INR`);
        }

        if (!parsed.ok) {
          errors.push(parsed.message);
        } else {
          result.newPrice = parsed.value;
          result.currency = currency;
          if (asset && asset.purchaseCost !== null) {
            if (asset.purchaseCost.equals(parsed.value)) {
              result.messages.push('Same price already recorded');
            } else {
              errors.push(
                `Price already recorded (${moneyLabel(asset.purchaseCost.toFixed(2), asset.currency ?? company.baseCurrency)}); correct it from the asset`,
              );
            }
          } else if (asset) {
            willSet.push('WILL_SET_PRICE');
          }
        }
      }

      // Date.
      if (line.date !== null) {
        const parsed = parseDateCell(line.date, today);
        if (!parsed.ok) {
          errors.push(parsed.message);
        } else {
          result.newDate = parsed.value;
          if (asset && asset.purchaseDate !== null) {
            const current = isoDay(asset.purchaseDate)!;
            if (current === parsed.value) {
              result.messages.push('Same purchase date already recorded');
            } else {
              errors.push(`Purchase date already recorded (${current}); correct it from the asset`);
            }
          } else if (asset) {
            willSet.push('WILL_SET_DATE');
          }
        }
      }

      // A row with any error changes nothing - half of a row applied is harder
      // to reason about than none of it, and the fix is one re-upload.
      if (errors.length) {
        result.outcomes = ['ERROR'];
        result.messages = errors;
      } else if (willSet.length) {
        result.outcomes = willSet;
      } else {
        result.outcomes = ['UNCHANGED'];
      }
    }

    const applied = { rows: 0, prices: 0, dates: 0 };
    if (!dryRun) {
      for (const result of results) {
        if (result.outcomes.includes('ERROR') || result.outcomes.includes('UNCHANGED')) continue;
        try {
          const wrote = await this.applyRow(actor, result);
          applied.rows += 1;
          if (wrote.price) applied.prices += 1;
          if (wrote.date) applied.dates += 1;
          result.applied = true;
        } catch (err) {
          result.outcomes = ['ERROR'];
          result.messages = [err instanceof AppError ? err.message : 'Could not be saved'];
          if (!(err instanceof AppError)) {
            this.logger.error(`Price sheet row ${result.row} failed: ${(err as Error).message}`);
          }
        }
      }

      // The trail says an upload happened; the per-asset rows say what it did.
      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.ASSET_UPDATED,
        entityType: 'Asset',
        entityId: 'bulk-price-sheet',
        newValues: { sheetRows: results.length, ...applied, source: 'price-sheet' },
      });
      this.logger.log(
        `Price sheet by ${actor.id}: ${applied.prices} prices, ${applied.dates} dates on ${applied.rows} assets`,
      );
    }

    const counts = {
      toChange: 0,
      pricesToSet: 0,
      datesToSet: 0,
      unchanged: blank,
      blank,
      errors: 0,
    };
    for (const r of results) {
      if (r.outcomes.includes('ERROR')) counts.errors += 1;
      else if (r.outcomes.includes('UNCHANGED')) counts.unchanged += 1;
      else {
        counts.toChange += 1;
        if (r.outcomes.includes('WILL_SET_PRICE')) counts.pricesToSet += 1;
        if (r.outcomes.includes('WILL_SET_DATE')) counts.datesToSet += 1;
      }
    }

    return { dryRun, rows: results.length + blank, counts, applied, results };
  }

  /**
   * Writes one row in its own transaction. The WHERE carries the write-once
   * rule, so a price or date recorded since the check makes this a no-op that
   * is reported, never an overwrite.
   */
  private async applyRow(
    actor: AuthUser,
    row: PriceSheetRowResult,
  ): Promise<{ price: boolean; date: boolean }> {
    const setPrice = row.outcomes.includes('WILL_SET_PRICE') && row.newPrice !== null;
    const setDate = row.outcomes.includes('WILL_SET_DATE') && row.newDate !== null;
    const assetId = row.assetId!;

    await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.asset.updateMany({
        where: {
          id: assetId,
          companyId: actor.companyId,
          deletedAt: null,
          ...(setPrice ? { purchaseCost: null } : {}),
          ...(setDate ? { purchaseDate: null } : {}),
        },
        data: {
          ...(setPrice
            ? {
                purchaseCost: new Prisma.Decimal(row.newPrice!),
                ...(row.currency ? { currency: row.currency } : {}),
              }
            : {}),
          ...(setDate ? { purchaseDate: new Date(`${row.newDate}T00:00:00.000Z`) } : {}),
          updatedById: actor.id,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new AppError(
          'CONFLICT',
          'The asset changed after the sheet was checked (a price or date was recorded meanwhile); nothing was saved for this row',
        );
      }
    });

    // Same entries the asset page writes: ASSET_COST_CHANGED per price, as
    // setPrice and the importer record it; ASSET_UPDATED for the date.
    if (setPrice) {
      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.ASSET_COST_CHANGED,
        entityType: 'Asset',
        entityId: assetId,
        previousValues: { purchaseCost: '' },
        newValues: { purchaseCost: row.newPrice, currency: row.currency, source: 'price-sheet' },
      });
    }
    if (setDate) {
      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.ASSET_UPDATED,
        entityType: 'Asset',
        entityId: assetId,
        previousValues: { purchaseDate: null },
        newValues: { purchaseDate: row.newDate, source: 'price-sheet' },
      });
    }
    return { price: setPrice, date: setDate };
  }
}
