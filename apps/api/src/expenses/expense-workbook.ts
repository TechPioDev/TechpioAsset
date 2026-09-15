import ExcelJS from 'exceljs';
import { money, sumMoney, type ExpenseLevel } from '@techpioasset/domain';
import type { ExpenseGroupDto } from '@techpioasset/contracts';
import { placeWorkbookLogo, WORKBOOK_COLOURS } from '../reports/report-workbook.js';
import type { ExpenseReportData } from './expenses.service.js';
import {
  changeText,
  contactLines,
  COUNTING_RULES,
  LEVEL_COLOURS,
  LEVEL_LABELS,
  LEVEL_RULE,
  moneyText,
  periodLine,
  SOURCE_LABELS,
  stampInZone,
} from './expense-render.js';

/**
 * The branded expense workbook (v2.59).
 *
 * Same house style as report-workbook.ts - its logo placement and colours are
 * imported, not copied - but several sheets and a taller letterhead carrying
 * the company's phone, email and address, which the owner asked to see on the
 * document itself.
 *
 * RUPEES WITH INDIAN GROUPING IN EXCEL
 *
 * A number format's commas mean "use the reader's thousands separator every
 * three digits", so `#,##,##0` is identical to `#,##0` and only shows lakhs on
 * a PC set to India. The format below instead writes LITERAL commas (`\,`) at
 * fixed positions, chosen by magnitude with Excel's two conditional sections:
 *
 *   ≥ 1,00,00,000   ₹#\,##\,##\,##0.00   → ₹1,25,00,000.00
 *   ≥ 1,00,000      ₹#\,##\,##0.00       → ₹12,50,000.00
 *   otherwise       ₹#,##0.00            → ₹68,000.00 (identical in both systems)
 *
 * The cell still holds a plain number, so sums and filters work. Limit: from
 * 100 crore up the leading group prints three digits (₹123,45,67,890.00), since
 * Excel allows only two conditions. Negative amounts fall to the last section.
 */
export const INR_NUMBER_FORMAT =
  '[>=10000000]"₹"#\\,##\\,##\\,##0.00;[>=100000]"₹"#\\,##\\,##0.00;"₹"#,##0.00';

export function currencyNumberFormat(currency: string): string {
  return currency === 'INR' ? INR_NUMBER_FORMAT : `"${currency} "#,##0.00`;
}

const { BRAND, INK, MUTED, RULE, ZEBRA } = WORKBOOK_COLOURS;
const WHITE = 'FFFFFFFF';
const TOTAL_FILL = 'FFE8EEFB';
const LEVEL_FILLS: Record<ExpenseLevel, string> = {
  HIGH: 'FFFFE8D9',
  NORMAL: 'FFE3EBFD',
  LOW: 'FFD9F5EC',
  NONE: 'FFF1F4F7',
};

export const EXPENSE_SHEETS = {
  SUMMARY: 'Summary',
  SERIES_DAY: 'By day',
  SERIES_MONTH: 'By month',
  TYPE: 'By type',
  CATEGORY: 'By category',
  OFFICE: 'By office',
  VENDOR: 'By vendor',
  LINES: 'All expenses',
} as const;

/** First table row after the letterhead on every sheet. */
export const EXPENSE_HEADER_ROW = 12;

interface Column {
  header: string;
  width: number;
  kind?: 'money' | 'count' | 'pct' | 'text';
}

const font = (extra: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({
  name: 'Calibri',
  size: 10,
  color: { argb: INK },
  ...extra,
});

export async function buildExpenseWorkbook(data: ExpenseReportData): Promise<Buffer> {
  const { summary, company } = data;
  const currency = summary.currency;
  const fmt = currencyNumberFormat(currency);

  const wb = new ExcelJS.Workbook();
  wb.creator = data.preparedBy;
  wb.company = company.name;
  wb.created = data.generatedAt;
  wb.title = 'Expense report';

  const sheet = (name: string, columns: Column[]) => {
    const ws = wb.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: EXPENSE_HEADER_ROW, showGridLines: false }],
      pageSetup: {
        orientation: columns.length > 5 ? 'landscape' : 'portrait',
        paperSize: 9, // A4
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
        printTitlesRow: `${EXPENSE_HEADER_ROW}:${EXPENSE_HEADER_ROW}`,
      },
      headerFooter: {
        oddFooter: `&L&8Confidential — generated for ${company.name.replace(/&/g, '&&')}&R&8Page &P of &N`,
      },
    });
    ws.columns = columns.map((c) => ({ width: c.width }));
    letterhead(wb, ws, data, name, Math.max(columns.length, 4));
    return ws;
  };

  const headings = (ws: ExcelJS.Worksheet, rowNo: number, columns: Column[]) => {
    const row = ws.getRow(rowNo);
    row.height = 20;
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = c.header;
      cell.font = font({ bold: true, color: { argb: WHITE } });
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: c.kind && c.kind !== 'text' ? 'right' : 'left',
      };
    });
  };

  const put = (
    ws: ExcelJS.Worksheet,
    rowNo: number,
    columns: Column[],
    values: Array<string | number | null>,
    options: { zebra?: boolean; total?: boolean; numFmt?: string } = {},
  ) => {
    const row = ws.getRow(rowNo);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const value = values[i];
      cell.value = value === null || value === undefined ? '' : value;
      cell.font = font(options.total ? { bold: true } : {});
      cell.alignment = {
        vertical: 'top',
        horizontal: c.kind && c.kind !== 'text' ? 'right' : 'left',
        wrapText: c.kind === 'text',
      };
      if (typeof value === 'number') {
        if (c.kind === 'money') cell.numFmt = options.numFmt ?? fmt;
        if (c.kind === 'count') cell.numFmt = '#,##0';
        if (c.kind === 'pct') cell.numFmt = '0.0"%"';
      }
      if (options.total) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } };
        cell.border = { top: { style: 'thin', color: { argb: BRAND } } };
      } else {
        if (options.zebra)
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
        cell.border = { bottom: { style: 'hair', color: { argb: RULE } } };
      }
    });
    return row;
  };

  const sectionTitle = (ws: ExcelJS.Worksheet, rowNo: number, text: string) => {
    const cell = ws.getRow(rowNo).getCell(1);
    cell.value = text;
    cell.font = font({ size: 12, bold: true, color: { argb: BRAND } });
    ws.getRow(rowNo).height = 20;
  };

  const n = (amount: string) => money(amount).toNumber();

  // ---- Summary -----------------------------------------------------------
  {
    const cols: Column[] = [
      { header: 'Measure', width: 38, kind: 'text' },
      { header: 'Items', width: 12, kind: 'count' },
      { header: `Amount (${currency})`, width: 22, kind: 'money' },
      { header: 'Share / note', width: 44, kind: 'text' },
    ];
    const ws = sheet(EXPENSE_SHEETS.SUMMARY, cols);
    let r = EXPENSE_HEADER_ROW;
    headings(ws, r, cols);
    const t = summary.totals;
    const unit = summary.period.granularity === 'DAY' ? 'day' : 'month';
    const kpis: Array<Array<string | number | null>> = [
      ['Total spend', t.count, n(t.total), summary.period.rangeLabel],
      [`Previous period`, null, n(t.previousTotal), summary.previousPeriod.rangeLabel],
      ['Change vs previous period', null, null, changeText(t.changePct)],
      [
        `Highest ${unit}`,
        null,
        summary.highestBucket ? n(summary.highestBucket.total) : null,
        summary.highestBucket?.label ?? 'No spending in this period',
      ],
      [
        `Lowest ${unit} with spending`,
        null,
        summary.lowestBucket ? n(summary.lowestBucket.total) : null,
        summary.lowestBucket?.label ?? '—',
      ],
      [
        'Biggest asset type',
        summary.byType[0]?.count ?? null,
        summary.byType[0] ? n(summary.byType[0].total) : null,
        summary.byType[0]?.name ?? '—',
      ],
      [
        'Biggest category',
        summary.byCategory[0]?.count ?? null,
        summary.byCategory[0] ? n(summary.byCategory[0].total) : null,
        summary.byCategory[0]?.name ?? '—',
      ],
    ];
    kpis.forEach((values, i) => put(ws, ++r, cols, values, { zebra: i % 2 === 1 }));
    ws.getRow(EXPENSE_HEADER_ROW + 1).getCell(3).font = font({
      bold: true,
      size: 12,
      color: { argb: BRAND },
    });

    r += 2;
    sectionTitle(ws, r, 'By source');
    headings(ws, ++r, [
      { header: 'Source', width: 0, kind: 'text' },
      { header: 'Items', width: 0, kind: 'count' },
      { header: `Amount (${currency})`, width: 0, kind: 'money' },
      { header: 'Share', width: 0, kind: 'pct' },
    ]);
    const shareCols: Column[] = [
      cols[0]!,
      cols[1]!,
      cols[2]!,
      { header: 'Share', width: 0, kind: 'pct' },
    ];
    (['ASSET', 'MAINTENANCE', 'LICENCE'] as const).forEach((source, i) => {
      const s = t.bySource[source];
      const share = money(t.total).isZero()
        ? 0
        : money(s.total).dividedBy(t.total).times(100).toDecimalPlaces(1).toNumber();
      put(ws, ++r, shareCols, [SOURCE_LABELS[source], s.count, n(s.total), share], {
        zebra: i % 2 === 1,
      });
    });
    put(ws, ++r, shareCols, ['Total', t.count, n(t.total), money(t.total).isZero() ? 0 : 100], {
      total: true,
    });

    if (summary.otherCurrencies.length > 0) {
      r += 2;
      sectionTitle(ws, r, 'Other currencies (not converted, not in the totals above)');
      headings(ws, ++r, [
        { header: 'Currency', width: 0, kind: 'text' },
        cols[1]!,
        { header: 'Amount', width: 0, kind: 'money' },
        { header: 'As text', width: 0, kind: 'text' },
      ]);
      summary.otherCurrencies.forEach((o, i) =>
        put(ws, ++r, cols, [o.currency, o.count, n(o.total), moneyText(o.total, o.currency)], {
          zebra: i % 2 === 1,
          numFmt: `"${o.currency} "#,##0.00`,
        }),
      );
    }

    r += 2;
    sectionTitle(ws, r, 'Missing data');
    const notes = summary.dataGaps.notes.length
      ? summary.dataGaps.notes
      : ['Nothing missing: every asset, completed repair and licence has a cost and a date.'];
    for (const note of notes) {
      r += 1;
      ws.mergeCells(r, 1, r, 4);
      const cell = ws.getRow(r).getCell(1);
      cell.value = `•  ${note}`;
      cell.font = font({ color: { argb: summary.dataGaps.notes.length ? 'FF9A3412' : MUTED } });
      cell.alignment = { wrapText: true, vertical: 'top' };
      ws.getRow(r).height = note.length > 95 ? 28 : 16;
    }

    r += 2;
    sectionTitle(ws, r, 'How this report counts');
    for (const line of [...COUNTING_RULES, LEVEL_RULE]) {
      r += 1;
      ws.mergeCells(r, 1, r, 4);
      const cell = ws.getRow(r).getCell(1);
      cell.value = `•  ${line}`;
      cell.font = font({ color: { argb: MUTED }, size: 9 });
      cell.alignment = { wrapText: true, vertical: 'top' };
      ws.getRow(r).height = line.length > 220 ? 40 : line.length > 110 ? 28 : 15;
    }
  }

  // ---- series ------------------------------------------------------------
  {
    const daily = summary.period.granularity === 'DAY';
    const cols: Column[] = [
      { header: daily ? 'Day' : 'Month', width: 18, kind: 'text' },
      { header: 'Items', width: 10, kind: 'count' },
      { header: `Amount (${currency})`, width: 22, kind: 'money' },
      { header: 'Level', width: 12, kind: 'text' },
      { header: 'Note', width: 36, kind: 'text' },
    ];
    const ws = sheet(daily ? EXPENSE_SHEETS.SERIES_DAY : EXPENSE_SHEETS.SERIES_MONTH, cols);
    headings(ws, EXPENSE_HEADER_ROW, cols);
    let r = EXPENSE_HEADER_ROW;
    summary.series.forEach((p, i) => {
      put(
        ws,
        ++r,
        cols,
        [
          p.label,
          p.count,
          n(p.total),
          LEVEL_LABELS[p.level],
          p.partial ? 'Partial month - only the days inside the period' : null,
        ],
        { zebra: i % 2 === 1 },
      );
      const level = ws.getRow(r).getCell(4);
      level.font = font({
        bold: p.level !== 'NONE',
        color: { argb: `FF${LEVEL_COLOURS[p.level]}` },
      });
      level.alignment = { horizontal: 'center', vertical: 'top' };
    });
    if (summary.series.length > 0) {
      // Conditional, not static, colours: re-sorting or editing the sheet keeps them right.
      const ref = `D${EXPENSE_HEADER_ROW + 1}:D${r}`;
      ws.addConditionalFormatting({
        ref,
        rules: (['HIGH', 'NORMAL', 'LOW', 'NONE'] as const).map((level, priority) => ({
          type: 'containsText',
          operator: 'containsText',
          text: LEVEL_LABELS[level],
          priority: priority + 1,
          style: {
            fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: LEVEL_FILLS[level] } },
          },
        })),
      });
    }
    put(ws, ++r, cols, ['Total', summary.totals.count, n(summary.totals.total), null, null], {
      total: true,
    });
    r += 2;
    ws.mergeCells(r, 1, r, 5);
    const rule = ws.getRow(r).getCell(1);
    rule.value = LEVEL_RULE;
    rule.font = font({ size: 9, color: { argb: MUTED } });
    rule.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(r).height = 42;
  }

  // ---- breakdowns --------------------------------------------------------
  const breakdown = (name: string, label: string, groups: ExpenseGroupDto[]) => {
    const cols: Column[] = [
      { header: label, width: 40, kind: 'text' },
      { header: 'Items', width: 10, kind: 'count' },
      { header: `Amount (${currency})`, width: 22, kind: 'money' },
      { header: 'Share', width: 10, kind: 'pct' },
    ];
    const ws = sheet(name, cols);
    headings(ws, EXPENSE_HEADER_ROW, cols);
    let r = EXPENSE_HEADER_ROW;
    if (groups.length === 0) {
      put(ws, ++r, cols, ['No expenses in this period', null, null, null]);
      ws.getRow(r).getCell(1).font = font({ italic: true, color: { argb: MUTED } });
    }
    groups.forEach((g, i) =>
      put(ws, ++r, cols, [g.name, g.count, n(g.total), g.sharePct], { zebra: i % 2 === 1 }),
    );
    put(
      ws,
      ++r,
      cols,
      [
        'Total',
        groups.reduce((a, g) => a + g.count, 0),
        sumMoney(groups.map((g) => g.total)).toNumber(),
        groups.length ? 100 : 0,
      ],
      { total: true },
    );
    if (groups.length > 0) {
      ws.autoFilter = {
        from: { row: EXPENSE_HEADER_ROW, column: 1 },
        to: { row: r - 1, column: 4 },
      };
    }
  };
  breakdown(EXPENSE_SHEETS.TYPE, 'Asset type', summary.byType);
  breakdown(EXPENSE_SHEETS.CATEGORY, 'Category', summary.byCategory);
  breakdown(EXPENSE_SHEETS.OFFICE, 'Office', summary.byOffice);
  breakdown(EXPENSE_SHEETS.VENDOR, 'Vendor', summary.byVendor);

  // ---- every line --------------------------------------------------------
  {
    const cols: Column[] = [
      { header: 'Date', width: 13, kind: 'text' },
      { header: 'Source', width: 22, kind: 'text' },
      { header: 'Title', width: 36, kind: 'text' },
      { header: 'Category', width: 20, kind: 'text' },
      { header: 'Type', width: 18, kind: 'text' },
      { header: 'Office', width: 16, kind: 'text' },
      { header: 'Vendor', width: 20, kind: 'text' },
      { header: 'Currency', width: 10, kind: 'text' },
      { header: 'Amount', width: 20, kind: 'money' },
    ];
    const ws = sheet(EXPENSE_SHEETS.LINES, cols);
    headings(ws, EXPENSE_HEADER_ROW, cols);
    let r = EXPENSE_HEADER_ROW;
    if (data.lines.length === 0) {
      put(ws, ++r, cols, [
        'No expenses in this period',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ]);
      ws.getRow(r).getCell(1).font = font({ italic: true, color: { argb: MUTED } });
    }
    data.lines.forEach((line, i) => {
      put(
        ws,
        ++r,
        cols,
        [
          line.localDate,
          SOURCE_LABELS[line.source],
          line.title,
          line.category,
          line.type,
          line.office,
          line.vendor,
          line.currency,
          n(line.amount),
        ],
        { zebra: i % 2 === 1, numFmt: currencyNumberFormat(line.currency) },
      );
    });
    if (data.lines.length > 0) {
      ws.autoFilter = {
        from: { row: EXPENSE_HEADER_ROW, column: 1 },
        to: { row: r, column: cols.length },
      };
    }
    const baseLines = data.lines.filter((l) => l.currency === currency);
    put(
      ws,
      ++r,
      cols,
      [
        `Total (${currency} only)`,
        null,
        null,
        null,
        null,
        null,
        null,
        currency,
        sumMoney(baseLines.map((l) => l.amount)).toNumber(),
      ],
      { total: true },
    );
    if (data.linesTruncated) {
      r += 2;
      ws.getRow(r).getCell(1).value =
        `Only the first ${data.lines.length.toLocaleString('en-IN')} lines are listed; the totals on the other sheets include every line.`;
      ws.getRow(r).getCell(1).font = font({ italic: true, color: { argb: 'FF9A3412' } });
    }
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** Rows 1-11 of every sheet: logo, company, contact, title, period, who and when. */
function letterhead(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  data: ExpenseReportData,
  sheetName: string,
  span: number,
): void {
  const { company, summary } = data;
  const logo = company.logo
    ? {
        buffer: company.logo.buffer,
        extension: 'png' as const,
        height: 48,
        width: Math.round((48 * company.logo.width) / company.logo.height),
      }
    : null;
  placeWorkbookLogo(wb, ws, logo);
  for (let r = 1; r <= 3; r += 1) ws.getRow(r).height = 17;
  ws.getRow(4).height = 6;

  const band = (rowNo: number, text: string, style: Partial<ExcelJS.Font>, height: number) => {
    const row = ws.getRow(rowNo);
    row.height = height;
    ws.mergeCells(rowNo, 1, rowNo, span);
    const cell = row.getCell(1);
    cell.value = text;
    cell.font = { name: 'Calibri', ...style };
    cell.alignment = { vertical: 'middle' };
  };

  const contact = contactLines(company);
  band(
    5,
    company.legalName && company.legalName !== company.name
      ? `${company.name} (${company.legalName})`
      : company.name,
    { size: 14, bold: true, color: { argb: INK } },
    20,
  );
  band(6, contact[0] ?? '', { size: 10, color: { argb: INK } }, 14);
  band(7, contact[1] ?? '', { size: 10, color: { argb: MUTED } }, 14);
  band(
    8,
    sheetName === 'Summary' ? 'Expense report' : `Expense report — ${sheetName}`,
    { size: 18, bold: true, color: { argb: BRAND } },
    26,
  );
  band(
    9,
    [periodLine(data), `Figures in ${summary.currency}`, ...data.filterLabels].join('   ·   '),
    { size: 10, color: { argb: INK } },
    15,
  );
  band(
    10,
    `Generated ${stampInZone(data.generatedAt, summary.period.timezone)} (${summary.period.timezone}) by ${data.preparedBy}`,
    { size: 10, color: { argb: MUTED } },
    15,
  );
  ws.getRow(11).height = 6;
}
