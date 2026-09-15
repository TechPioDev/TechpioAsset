import ExcelJS from 'exceljs';
import {
  BRAND_LOGO_BASE64,
  BRAND_LOGO_HEIGHT,
  BRAND_LOGO_WIDTH,
} from '../notifications/brand-logo.generated.js';
import type { ReportColumn, ReportRow } from './report-format.js';

/**
 * The branded .xlsx workbook (v2.28).
 *
 * The previous Excel export was SpreadsheetML 2003 - an XML .xls emitted as a
 * plain string. It streamed beautifully and looked like a database dump: no
 * logo, no letterhead, no column widths, and a format warning from Excel on
 * every open. This produces a real .xlsx that a person can put in front of an
 * auditor.
 *
 * WHY THIS ONE BUFFERS, WHEN THE CSV PATH DOES NOT
 *
 * The streamed export exists for a reason worth preserving: buffering a
 * 100,000-row report once held four copies of every row and cost 98.6 MB of
 * heap for a 5.8 MB download. Nothing here undoes that - CSV still streams a
 * page at a time, untouched.
 *
 * But ExcelJS cannot do both. Its streaming writer has no `worksheet.addImage`
 * at all (verified, not assumed - the method is undefined), so a logo and a
 * streamed workbook are mutually exclusive in this library. Rather than pick
 * one and lose the other, the two formats now do different jobs:
 *
 *   XLSX - a presentation document for people. Branded, styled, buffered, and
 *          capped at MAX_WORKBOOK_ROWS so the heap stays bounded.
 *   CSV  - the bulk format for machines. Unbounded and still streaming.
 *
 * The cap is what keeps the old incident from returning by another door. Past
 * it the caller is told to use CSV, which is the correct format for data at
 * that size anyway - nobody reads a 100,000-row spreadsheet, they process it.
 */

/**
 * Above this, XLSX is refused and CSV is offered instead.
 *
 * 20,000 rows of these columns is a few tens of MB at peak - the same order as
 * a large photo, and far below the 98.6 MB that made streaming necessary. It is
 * also about 100x the largest real report in production today, so the ceiling
 * is theoretical rather than something a user will meet.
 */
export const MAX_WORKBOOK_ROWS = 20_000;

/** Fixed layout of the letterhead, referenced by both the writer and its tests. */
const TITLE_ROW = 5;
const META_ROW = 6;
const FILTER_ROW = 7;
const SPACER_ROW = 8;
export const HEADER_ROW = 9;

const BRAND = 'FF1D4ED8';
const INK = 'FF16202B';
const MUTED = 'FF6B7A88';
const RULE = 'FFD3DDE4';
const ZEBRA = 'FFF6F9FB';

/** The house colours, shared with the expense workbook (v2.59) so the two read as one family. */
export const WORKBOOK_COLOURS = { BRAND, INK, MUTED, RULE, ZEBRA } as const;

/**
 * Float the logo over the top-left of a sheet. The product logo unless a
 * company logo (PNG/JPEG bytes) is given. `height` caps the drawn height and
 * the width follows the image's own proportions when they are known.
 */
export function placeWorkbookLogo(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  logo?: { buffer: Buffer; extension: 'png' | 'jpeg'; width: number; height: number } | null,
): void {
  const id = logo
    ? wb.addImage({ buffer: logo.buffer as unknown as ExcelJS.Buffer, extension: logo.extension })
    : wb.addImage({ base64: BRAND_LOGO_BASE64, extension: 'png' });
  ws.addImage(id, {
    tl: { col: 0.25, row: 0.3 },
    ext: logo
      ? { width: logo.width, height: logo.height }
      : { width: BRAND_LOGO_WIDTH, height: BRAND_LOGO_HEIGHT },
  });
}

/** Everything the letterhead needs that is not the table itself. */
export interface WorkbookHeader {
  /** The tenant, not the product - this is their document. */
  companyName: string;
  reportTitle: string;
  /** Who pressed the button, so a circulated file says where it came from. */
  preparedBy: string;
  preparedByPhone?: string | null;
  generatedAt: Date;
  /** Rendered as-is under the title, e.g. "Office: Mohali". */
  filters?: string[];
}

/** Column width in Excel units, from the header and a sample of the data. */
function widthFor(column: ReportColumn, rows: readonly ReportRow[]): number {
  // The filter button sits on top of the heading and covers about three
  // characters of it, so the heading is measured with room for it. Without
  // this, "Other items" rendered as "Other ite" behind its own dropdown.
  let widest = column.label.length + 3;
  // A sample, not the whole set: the point is a sensible width, and scanning
  // 20,000 cells to choose one is more work than writing them.
  for (const row of rows.slice(0, 200)) {
    const value = row[column.key];
    if (value === null || value === undefined) continue;
    // A multi-line cell is as wide as its longest line, not its total length.
    for (const line of String(value).split('\n')) {
      if (line.length > widest) widest = line.length;
    }
  }
  return Math.min(Math.max(widest + 3, 10), 46);
}

/**
 * Height for a row holding a wrapped multi-line cell.
 *
 * Excel auto-fits wrapped text when it opens the file, but only for rows whose
 * height was never set. Since these rows are written by a library that sets one
 * by default, the height is computed here or the consolidated column shows its
 * first line and hides the rest - which is exactly the information the
 * one-row-per-person layout exists to show.
 */
function heightFor(row: ReportRow): number | null {
  let lines = 1;
  for (const value of Object.values(row)) {
    if (typeof value !== 'string') continue;
    const count = value.split('\n').length;
    if (count > lines) lines = count;
  }
  return lines > 1 ? lines * 14 + 4 : null;
}

/**
 * Build the workbook. Returns the .xlsx bytes.
 *
 * Throws if the row count exceeds MAX_WORKBOOK_ROWS; the caller turns that into
 * a message naming CSV, rather than an out-of-memory an hour later.
 */
export async function buildWorkbook(
  header: WorkbookHeader,
  columns: readonly ReportColumn[],
  rows: readonly ReportRow[],
): Promise<Buffer> {
  if (rows.length > MAX_WORKBOOK_ROWS) {
    throw new Error(
      `This report has ${rows.length.toLocaleString()} rows, more than the ${MAX_WORKBOOK_ROWS.toLocaleString()} an Excel file holds here. Export it as CSV instead.`,
    );
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = header.preparedBy;
  wb.company = header.companyName;
  wb.created = header.generatedAt;

  const ws = wb.addWorksheet(header.reportTitle.slice(0, 31), {
    // Gridlines off: the data rows carry their own hairline rule, and with
    // gridlines on, the empty cells behind the letterhead drew a grid straight
    // through the logo.
    views: [{ state: 'frozen', ySplit: HEADER_ROW, showGridLines: false }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
      // The column headings repeat on every printed page. A ten-page inventory
      // whose later pages are unlabelled columns is not a document anyone can read.
      printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
    },
  });

  ws.columns = columns.map((c) => ({ key: c.key, width: widthFor(c, rows) }));

  // ---- letterhead -------------------------------------------------------

  // The logo floats over rows 1-3 rather than living in a cell, so it never
  // stretches a column that the table below has to size for its own data.
  placeWorkbookLogo(wb, ws);
  for (let r = 1; r <= 3; r += 1) ws.getRow(r).height = 17;

  const lastCol = columns.length;
  const band = (rowNo: number, text: string, style: Partial<ExcelJS.Font>, height: number) => {
    const row = ws.getRow(rowNo);
    row.height = height;
    if (lastCol > 1) ws.mergeCells(rowNo, 1, rowNo, lastCol);
    const cell = row.getCell(1);
    cell.value = text;
    cell.font = { name: 'Calibri', ...style };
    cell.alignment = { vertical: 'middle' };
    return cell;
  };

  band(TITLE_ROW, header.reportTitle, { size: 18, bold: true, color: { argb: BRAND } }, 26);

  const who = [
    header.companyName,
    `Prepared by ${header.preparedBy}`,
    header.preparedByPhone || null,
  ].filter(Boolean);
  band(META_ROW, who.join('   ·   '), { size: 10, color: { argb: INK } }, 15);

  const when = [
    `Generated ${formatStamp(header.generatedAt)}`,
    ...(header.filters ?? []),
    `${rows.length.toLocaleString()} ${rows.length === 1 ? 'row' : 'rows'}`,
  ];
  band(FILTER_ROW, when.join('   ·   '), { size: 10, color: { argb: MUTED } }, 15);

  ws.getRow(SPACER_ROW).height = 6;

  // ---- column headings --------------------------------------------------

  const head = ws.getRow(HEADER_ROW);
  head.height = 22;
  columns.forEach((column, i) => {
    const cell = head.getCell(i + 1);
    cell.value = column.label;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    // Headings are left-aligned even over numeric columns, which the figures
    // below are not. The filter button occupies the right edge of the heading
    // cell, and right-aligned text ends exactly there - so "Other items" read
    // as "Other ite" no matter how wide the column was made. Widening cannot
    // fix it; only moving the text away from that edge can.
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });

  // ---- data -------------------------------------------------------------

  rows.forEach((row, i) => {
    const line = ws.getRow(HEADER_ROW + 1 + i);
    const height = heightFor(row);
    if (height !== null) line.height = height;

    columns.forEach((column, c) => {
      const cell = line.getCell(c + 1);
      const value = row[column.key];
      // Blank, not zero and not "null": an unrecorded figure is not a figure.
      cell.value = value === null || value === undefined ? '' : value;
      if (column.numeric && typeof value === 'number') {
        cell.numFmt = column.decimals ? `#,##0.${'0'.repeat(column.decimals)}` : '#,##0';
      }
      cell.font = { name: 'Calibri', size: 10, color: { argb: INK } };
      cell.alignment = {
        vertical: 'top',
        horizontal: column.numeric ? 'right' : 'left',
        wrapText: true,
      };
      if (i % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
      }
      cell.border = { bottom: { style: 'hair', color: { argb: RULE } } };
    });
  });

  // Filter buttons on the headings, so the recipient can slice the sheet
  // without being given a second export.
  if (rows.length > 0) {
    ws.autoFilter = {
      from: { row: HEADER_ROW, column: 1 },
      to: { row: HEADER_ROW + rows.length, column: lastCol },
    };
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** "31 Aug 2026, 14:32" - unambiguous to a reader in any locale. */
function formatStamp(at: Date): string {
  const date = at.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}
