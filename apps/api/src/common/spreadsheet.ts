import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { AppError } from './errors/app-error.js';

/**
 * Reading an uploaded sheet into header-keyed rows (v2.52).
 *
 * Lifted out of the asset importer so the vendor catalogue can use the same
 * reader rather than grow a second one that drifts. The behaviour is unchanged;
 * the only thing that varies between callers is which header row to look for.
 *
 * Excel and CSV both, because a supplier exporting from its own system gets
 * whichever its system offers and neither is unreasonable.
 */

export type SheetRow = Record<string, string | number | Date | null>;

/** Excel is a zip; the old binary format is an OLE2 compound file. */
function looksLikeWorkbook(data: Buffer): boolean {
  const zip = [0x50, 0x4b, 0x03, 0x04];
  const ole2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const matches = (sig: number[]) =>
    data.length >= sig.length && sig.every((byte, i) => data[i] === byte);
  return matches(zip) || matches(ole2);
}

const text = (v: ExcelJS.CellValue): string => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown };
    if (typeof o.text === 'string') return o.text;
    if (o.result != null) return String(o.result);
    return '';
  }
  return String(v);
};

const value = (v: ExcelJS.CellValue): string | number | Date | null => {
  if (v == null || v === '') return null;
  if (v instanceof Date || typeof v === 'number') return v;
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown };
    return o.text ?? (o.result != null ? String(o.result) : null);
  }
  return String(v).trim();
};

/**
 * Read the first sheet into rows keyed by their column heading.
 *
 * `headerHint` names the column that marks the header row, because these files
 * often carry a company banner or a title above it. Without a match the first
 * row is used, which is right for anything exported by a machine.
 */
export async function parseSheet(
  buffer: Buffer,
  options: { headerHint?: RegExp } = {},
): Promise<SheetRow[]> {
  const wb = new ExcelJS.Workbook();
  if (looksLikeWorkbook(buffer)) {
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new AppError('FILE_REJECTED', 'That file could not be read as an Excel workbook.');
    }
  } else {
    // Not a workbook, so try it as CSV. A file that is neither fails here with
    // a message about the file rather than a stack trace about a parser.
    try {
      await wb.csv.read(Readable.from(buffer.toString('utf8')));
    } catch {
      throw new AppError('FILE_REJECTED', 'That file could not be read as a spreadsheet or CSV.');
    }
  }

  const ws = wb.worksheets[0];
  if (!ws) throw new AppError('FILE_REJECTED', 'The file has no sheets.');

  let headerRow = 1;
  let headers: string[] = [];
  if (options.headerHint) {
    for (let r = 1; r <= Math.min(10, ws.rowCount); r += 1) {
      const cells = (ws.getRow(r).values as ExcelJS.CellValue[]).slice(1).map(text);
      if (cells.some((c) => options.headerHint!.test(c))) {
        headers = cells;
        headerRow = r;
        break;
      }
    }
  }
  if (!headers.length) {
    headers = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map(text);
  }

  const rows: SheetRow[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r += 1) {
    const cells = (ws.getRow(r).values as ExcelJS.CellValue[]).slice(1);
    const obj: SheetRow = {};
    let hasData = false;
    headers.forEach((h, idx) => {
      if (!h) return;
      const v = value(cells[idx] ?? null);
      obj[h] = v;
      if (v != null) hasData = true;
    });
    // A blank line in the middle of a sheet is formatting, not a record.
    if (hasData) rows.push(obj);
  }
  return rows;
}

/**
 * Case- and space-insensitive lookup of a cell by any of several headings.
 *
 * Sheets arrive with "SKU", "Sku", "sku " and "Vendor SKU" meaning the same
 * column, and refusing all but one spelling makes the importer the supplier's
 * problem rather than their exporter's.
 */
export function cell(row: SheetRow, ...names: string[]): string | number | Date | null {
  const normalise = (s: string) => s.replace(/[\s_]+/g, '').toLowerCase();
  const wanted = names.map(normalise);
  for (const [key, v] of Object.entries(row)) {
    if (wanted.includes(normalise(key))) return v;
  }
  return null;
}

/** The same, as trimmed text. */
export function cellText(row: SheetRow, ...names: string[]): string {
  const v = cell(row, ...names);
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}
