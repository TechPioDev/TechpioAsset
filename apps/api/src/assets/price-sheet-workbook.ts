import ExcelJS from 'exceljs';
import { buildWorkbook, HEADER_ROW, type WorkbookHeader } from '../reports/report-workbook.js';
import type { ReportColumn } from '../reports/report-format.js';

/**
 * The price sheet workbook (v2.59) - a thin wrapper over the branded report
 * workbook rather than a change to it.
 *
 * The letterhead, logo, column widths and zebra rows come from buildWorkbook
 * unchanged. This file then reopens the bytes and turns the report into a form:
 * the two "New" columns (and Currency) are unlocked and tinted, everything else
 * is locked by sheet protection so the key column cannot be edited by accident,
 * and an Instructions sheet is added after the data sheet. The data sheet stays
 * FIRST, because that is the one the upload reads.
 *
 * Protection has no password: it guards against a slip, not a person. Anyone
 * can unprotect it, and the server re-validates every cell regardless.
 */

/** Column headings, shared with the reader so the two cannot drift. */
export const PRICE_SHEET_COLUMNS = {
  assetTag: 'Asset tag',
  name: 'Name',
  category: 'Category',
  type: 'Type',
  office: 'Office',
  assignedTo: 'Assigned to',
  currentPrice: 'Current purchase price',
  currency: 'Currency',
  currentDate: 'Current purchase date',
  newPrice: 'New purchase price',
  newDate: 'New purchase date (YYYY-MM-DD)',
} as const;

export interface PriceSheetRow {
  [key: string]: string | number | null;
  assetTag: string;
  name: string;
  category: string;
  type: string;
  office: string;
  assignedTo: string;
  currentPrice: number | null;
  currency: string;
  currentDate: string | null;
  newPrice: null;
  newDate: null;
}

const COLUMNS: ReportColumn[] = [
  { key: 'assetTag', label: PRICE_SHEET_COLUMNS.assetTag },
  { key: 'name', label: PRICE_SHEET_COLUMNS.name },
  { key: 'category', label: PRICE_SHEET_COLUMNS.category },
  { key: 'type', label: PRICE_SHEET_COLUMNS.type },
  { key: 'office', label: PRICE_SHEET_COLUMNS.office },
  { key: 'assignedTo', label: PRICE_SHEET_COLUMNS.assignedTo },
  { key: 'currentPrice', label: PRICE_SHEET_COLUMNS.currentPrice, numeric: true, decimals: 2 },
  { key: 'currency', label: PRICE_SHEET_COLUMNS.currency },
  { key: 'currentDate', label: PRICE_SHEET_COLUMNS.currentDate },
  { key: 'newPrice', label: PRICE_SHEET_COLUMNS.newPrice, numeric: true, decimals: 2 },
  { key: 'newDate', label: PRICE_SHEET_COLUMNS.newDate },
];

/** Pale yellow: the conventional "type here" cell. */
const INPUT_FILL = 'FFFFF7D6';
const INPUT_HEAD = 'FFB45309';

export async function buildPriceSheetWorkbook(
  header: WorkbookHeader,
  rows: PriceSheetRow[],
  baseCurrency: string,
): Promise<Buffer> {
  const base = await buildWorkbook(header, COLUMNS, rows);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(base as unknown as ArrayBuffer);
  const ws = wb.worksheets[0]!;

  const col = (key: string) => COLUMNS.findIndex((c) => c.key === key) + 1;
  const editable = [col('newPrice'), col('newDate'), col('currency')];

  // The header row is found rather than assumed, in case the letterhead grows.
  let headerRow = HEADER_ROW;
  for (let r = 1; r <= 40; r += 1) {
    if (ws.getRow(r).getCell(1).value === PRICE_SHEET_COLUMNS.assetTag) {
      headerRow = r;
      break;
    }
  }

  // Styles are REPLACED, never mutated. A loaded workbook shares one style
  // object between every cell with the same formatting, so assigning
  // `cell.protection` on one cell unlocked the Asset tag column along with it.
  const restyle = (cell: ExcelJS.Cell, patch: Partial<ExcelJS.Style>) => {
    cell.style = { ...cell.style, ...patch };
  };

  for (const c of [col('newPrice'), col('newDate')]) {
    restyle(ws.getRow(headerRow).getCell(c), {
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_HEAD } },
    });
    ws.getColumn(c).width = Math.max(ws.getColumn(c).width ?? 0, 22);
  }

  for (let i = 0; i < rows.length; i += 1) {
    const line = ws.getRow(headerRow + 1 + i);
    for (const c of editable) {
      restyle(line.getCell(c), {
        protection: { locked: false },
        ...(c === col('newPrice') ? { numFmt: '#,##0.00' } : {}),
        // Text, so 2024-03-15 stays exactly as typed instead of becoming a
        // locale-formatted date. A date cell is accepted on upload too.
        ...(c === col('newDate') ? { numFmt: '@' } : {}),
        ...(c !== col('currency')
          ? { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_FILL } } }
          : {}),
      });
    }
    const price = line.getCell(col('newPrice'));
    price.dataValidation = {
      type: 'decimal',
      operator: 'greaterThan',
      formulae: [0],
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: 'Purchase price',
      error: 'Enter the price as a number above zero, with at most 2 decimals.',
    };
  }

  await ws.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatColumns: true,
    formatRows: true,
    autoFilter: true,
    sort: false,
  });

  const help = wb.addWorksheet('Instructions', { views: [{ showGridLines: false }] });
  help.getColumn(1).width = 110;
  const lines: [string, Partial<ExcelJS.Font>?][] = [
    ['How to fill in the price sheet', { size: 16, bold: true, color: { argb: 'FF1D4ED8' } }],
    [''],
    ['1. On the "Price sheet" tab, fill the yellow columns only:', { bold: true }],
    [
      '     New purchase price - a number, e.g. 68000 or 68000.50. No more than 2 decimals, above zero.',
    ],
    [
      '     New purchase date - YYYY-MM-DD, e.g. 2024-03-15. Not in the future and not before 1990.',
    ],
    [
      `     Currency - leave as it is, or a three-letter code. Blank means the company currency (${baseCurrency}).`,
    ],
    ['2. Leave a cell empty to change nothing for that asset.'],
    ['3. Do not edit the Asset tag - it is how each row is matched to its asset.'],
    [
      '4. Upload the saved file on Assets > Price sheet. You will see a preview before anything is saved.',
    ],
    [''],
    ['Rules', { bold: true }],
    [
      '- A price that is already recorded is never changed by the sheet. If it needs correcting, do it from the asset.',
    ],
    [
      '- A purchase date is filled only where none is recorded. A different existing date is reported, not overwritten.',
    ],
    [
      '- A row with any problem is skipped entirely; fix it and upload again. Rows already saved show as unchanged.',
    ],
    ['- Every price and date saved is recorded in the audit log against the asset.'],
    ['- Up to 5,000 rows per upload.'],
  ];
  lines.forEach(([text, font], i) => {
    const cell = help.getRow(i + 1).getCell(1);
    cell.value = text;
    cell.font = { name: 'Calibri', size: 11, ...(font ?? {}) };
  });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
