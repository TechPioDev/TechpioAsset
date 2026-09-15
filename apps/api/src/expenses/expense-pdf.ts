import { existsSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { money, type ExpenseLevel } from '@techpioasset/domain';
import type { ExpenseGroupDto } from '@techpioasset/contracts';
import {
  BRAND_LOGO_BASE64,
  BRAND_LOGO_HEIGHT,
  BRAND_LOGO_WIDTH,
} from '../notifications/brand-logo.generated.js';
import type { ExpenseReportData } from './expenses.service.js';
import {
  changeText,
  compactMoney,
  contactLines,
  COUNTING_RULES,
  LEVEL_COLOURS,
  LEVEL_LABELS,
  LEVEL_RULE,
  moneyText,
  shortDate,
  SOURCE_LABELS,
  stampInZone,
} from './expense-render.js';

/**
 * The expense report as an A4 PDF (v2.59), drawn with pdfkit vectors.
 *
 * THE RUPEE SIGN
 *
 * PDF's fourteen built-in fonts (Helvetica and friends) have no ₹ glyph - it
 * prints as nothing. The report embeds Inter (SIL Open Font License, shipped in
 * apps/api/assets/fonts with its licence), which has one; pdfkit subsets it so
 * only the characters used are carried in the file. If the font files are ever
 * missing from a build, the report falls back to Helvetica and writes "INR "
 * instead of "₹" rather than printing blanks - `usedRupeeGlyph` says which
 * happened.
 */

const PAGE = { width: 595.28, height: 841.89 };
const M = 40;
const W = PAGE.width - M * 2;
const CONTENT_BOTTOM = PAGE.height - 56;

const C = {
  brand: '#1D4ED8',
  brandSoft: '#E8EEFB',
  ink: '#16202B',
  muted: '#6B7A88',
  rule: '#D3DDE4',
  soft: '#F6F9FB',
  warnFill: '#FFF4E6',
  warnLine: '#F59F00',
  warnInk: '#9A3412',
  up: '#E8590C',
  down: '#0CA678',
};

const level = (l: ExpenseLevel) => `#${LEVEL_COLOURS[l]}`;

function fontDirectory(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../assets/fonts'),
    path.resolve(process.cwd(), 'assets/fonts'),
    path.resolve(process.cwd(), 'apps/api/assets/fonts'),
  ];
  return candidates.find((dir) => existsSync(path.join(dir, 'Inter-Regular.woff'))) ?? null;
}

export interface ExpensePdfResult {
  buffer: Buffer;
  pages: number;
  usedRupeeGlyph: boolean;
}

export async function buildExpensePdf(data: ExpenseReportData): Promise<ExpensePdfResult> {
  const { summary, company } = data;
  const currency = summary.currency;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: M, left: M, right: M, bottom: 20 },
    bufferPages: true,
    info: {
      Title: `Expense report — ${summary.period.rangeLabel}`,
      Author: data.preparedBy,
      Subject: `Expenses for ${company.name}`,
      Creator: 'PioAssets',
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  const fonts = fontDirectory();
  const REG = 'Body';
  const BOLD = 'Bold';
  if (fonts) {
    doc.registerFont(REG, path.join(fonts, 'Inter-Regular.woff'));
    doc.registerFont(BOLD, path.join(fonts, 'Inter-SemiBold.woff'));
  } else {
    doc.registerFont(REG, 'Helvetica');
    doc.registerFont(BOLD, 'Helvetica-Bold');
  }
  const rupee = fonts ? '₹' : 'INR ';
  const amount = (value: string, cur = currency) => moneyText(value, cur, rupee);

  // ---- primitives ----------------------------------------------------------

  const text = (
    value: string,
    x: number,
    y: number,
    opts: {
      size?: number;
      bold?: boolean;
      color?: string;
      width?: number;
      align?: 'left' | 'right' | 'center';
    } = {},
  ) => {
    doc
      .font(opts.bold ? BOLD : REG)
      .fontSize(opts.size ?? 9)
      .fillColor(opts.color ?? C.ink);
    const width = opts.width;
    const shown = width ? fit(value, width) : value;
    doc.text(shown, x, y, { width, align: opts.align ?? 'left', lineBreak: false });
  };

  /** Truncate with an ellipsis to fit `width` at the current font. */
  const fit = (value: string, width: number) => {
    if (doc.widthOfString(value) <= width) return value;
    let cut = value;
    while (cut.length > 1 && doc.widthOfString(`${cut}…`) > width) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  };

  /** Largest size (down to `min`) at which `value` fits `width`. */
  const sizeToFit = (value: string, width: number, size: number, min: number, bold = true) => {
    doc.font(bold ? BOLD : REG);
    let s = size;
    while (s > min && doc.fontSize(s).widthOfString(value) > width) s -= 0.5;
    return s;
  };

  const paragraph = (
    value: string,
    x: number,
    y: number,
    width: number,
    size: number,
    color: string,
  ) => {
    doc.font(REG).fontSize(size).fillColor(color);
    const height = doc.heightOfString(value, { width });
    doc.text(value, x, y, { width, lineGap: 1.5 });
    return height + 3;
  };

  const measure = (value: string, width: number, size: number) => {
    doc.font(REG).fontSize(size);
    return doc.heightOfString(value, { width, lineGap: 1.5 }) + 3;
  };

  let y = M;
  const ensure = (needed: number) => {
    if (y + needed <= CONTENT_BOTTOM) return;
    doc.addPage();
    y = M;
  };

  const sectionTitle = (title: string, sub?: string) => {
    ensure(40);
    text(title, M, y, { size: 12.5, bold: true, color: C.ink });
    if (sub) text(sub, M, y + 3.5, { size: 8, color: C.muted, width: W, align: 'right' });
    y += 20;
  };

  // ---- letterhead --------------------------------------------------------------

  const logoHeight = 38;
  if (company.logo) {
    const width = Math.min(170, (logoHeight * company.logo.width) / company.logo.height);
    doc.image(company.logo.buffer, M, y, { fit: [width, logoHeight] });
  } else {
    doc.image(Buffer.from(BRAND_LOGO_BASE64, 'base64'), M, y, {
      width: (logoHeight * BRAND_LOGO_WIDTH) / BRAND_LOGO_HEIGHT,
      height: logoHeight,
    });
  }
  const headRight = M + 190;
  const headWidth = W - 190;
  text(company.name, headRight, y, {
    size: sizeToFit(company.name, headWidth, 15, 10),
    bold: true,
    width: headWidth,
    align: 'right',
  });
  const contact = contactLines(company);
  let contactY = y + 21;
  if (company.legalName && company.legalName !== company.name) {
    text(company.legalName, headRight, contactY, {
      size: 8,
      color: C.muted,
      width: headWidth,
      align: 'right',
    });
    contactY += 11;
  }
  for (const line of contact) {
    text(line, headRight, contactY, { size: 8, color: C.muted, width: headWidth, align: 'right' });
    contactY += 11;
  }
  y = Math.max(y + logoHeight, contactY) + 8;
  doc.rect(M, y, W, 2.5).fill(C.brand);
  y += 16;

  text('Expense report', M, y, { size: 22, bold: true, color: C.ink });
  const pill = summary.period.label;
  doc.font(BOLD).fontSize(8.5);
  const pillWidth = doc.widthOfString(pill) + 18;
  doc.roundedRect(M + W - pillWidth, y + 6, pillWidth, 18, 9).fill(C.brandSoft);
  text(pill, M + W - pillWidth, y + 10.5, {
    size: 8.5,
    bold: true,
    color: C.brand,
    width: pillWidth,
    align: 'center',
  });
  y += 32;
  text(
    [summary.period.rangeLabel, `Figures in ${currency}`, ...data.filterLabels].join('   ·   '),
    M,
    y,
    { size: 10, color: C.ink, width: W },
  );
  y += 15;
  text(
    `Generated ${stampInZone(data.generatedAt, summary.period.timezone)} (${summary.period.timezone}) by ${data.preparedBy}`,
    M,
    y,
    { size: 8.5, color: C.muted, width: W },
  );
  y += 22;

  // ---- KPI cards ---------------------------------------------------------------

  const t = summary.totals;
  const unit = summary.period.granularity === 'DAY' ? 'day' : 'month';
  const topType = summary.byType[0];
  const cards: Array<{
    label: string;
    value: string;
    sub: string;
    color?: string;
    small?: boolean;
  }> = [
    {
      label: 'TOTAL SPEND',
      value: amount(t.total),
      sub: `${t.count.toLocaleString('en-IN')} expense ${t.count === 1 ? 'line' : 'lines'}`,
    },
    {
      label: 'VS PREVIOUS PERIOD',
      value: t.changePct === null ? '—' : changeText(t.changePct),
      sub:
        t.changePct === null
          ? 'No spend in the previous period'
          : `Previous: ${amount(t.previousTotal)}`,
      color: t.changePct === null || t.changePct === 0 ? C.ink : t.changePct > 0 ? C.up : C.down,
    },
    {
      label: 'BIGGEST ASSET TYPE',
      value: topType?.name ?? '—',
      sub: topType ? `${amount(topType.total)} · ${topType.sharePct}%` : 'No spending yet',
      small: true,
    },
    {
      label: `HIGHEST ${unit.toUpperCase()}`,
      value: summary.highestBucket?.label ?? '—',
      sub: summary.highestBucket ? amount(summary.highestBucket.total) : 'No spending yet',
      small: true,
    },
  ];
  const gap = 10;
  const cardW = (W - gap * 3) / 4;
  const cardH = 70;
  cards.forEach((card, i) => {
    const x = M + i * (cardW + gap);
    doc.roundedRect(x, y, cardW, cardH, 6).fill(C.soft);
    doc.rect(x, y, cardW, 3).fill(i === 0 ? C.brand : C.rule);
    text(card.label, x + 10, y + 12, { size: 7, bold: true, color: C.muted, width: cardW - 20 });
    const size = sizeToFit(card.value, cardW - 20, card.small ? 12 : 14, 7.5);
    text(card.value, x + 10, y + 27, {
      size,
      bold: true,
      color: card.color ?? C.ink,
      width: cardW - 20,
    });
    text(card.sub, x + 10, y + 50, {
      size: sizeToFit(card.sub, cardW - 20, 7.5, 6, false),
      color: C.muted,
      width: cardW - 20,
    });
  });
  y += cardH + 12;

  // ---- by source strip -----------------------------------------------------------

  const sources = ['ASSET', 'MAINTENANCE', 'LICENCE'] as const;
  const stripW = W / 3;
  doc.rect(M, y, W, 32).fill('#FFFFFF');
  doc
    .moveTo(M, y)
    .lineTo(M + W, y)
    .lineWidth(0.6)
    .strokeColor(C.rule)
    .stroke();
  doc
    .moveTo(M, y + 32)
    .lineTo(M + W, y + 32)
    .stroke();
  const sourceColours = [C.brand, '#7048E8', '#0B7285'];
  sources.forEach((source, i) => {
    const x = M + i * stripW;
    doc.circle(x + 6, y + 11, 3).fill(sourceColours[i]!);
    text(SOURCE_LABELS[source], x + 14, y + 6.5, { size: 7.5, color: C.muted, width: stripW - 20 });
    const s = t.bySource[source];
    text(`${amount(s.total)}  (${s.count})`, x + 14, y + 17, {
      size: 9,
      bold: true,
      width: stripW - 20,
    });
  });
  y += 46;

  // ---- series chart ------------------------------------------------------------

  const series = summary.series;
  sectionTitle(`Spend by ${unit}`, `${summary.period.rangeLabel}`);
  const chartH = 170;
  const axisW = 52;
  const plotX = M + axisW;
  const plotW = W - axisW;
  const plotTop = y + 6;
  const plotH = chartH - 34;
  const baseY = plotTop + plotH;

  const max = series.reduce((m, p) => Math.max(m, money(p.total).toNumber()), 0);
  // Axis scale only - every printed amount is exact text from the summary.
  const niceMax = (() => {
    if (max <= 0) return 1;
    const raw = max / 4;
    const power = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * power).find((s) => s * 4 >= max) ?? 10 * power;
    return step * 4;
  })();

  for (let i = 0; i <= 4; i += 1) {
    const gy = baseY - (plotH * i) / 4;
    doc
      .moveTo(plotX, gy)
      .lineTo(plotX + plotW, gy)
      .lineWidth(i === 0 ? 0.8 : 0.4)
      .strokeColor(i === 0 ? C.muted : C.rule)
      .stroke();
    if (max > 0) {
      text(compactMoney(String((niceMax * i) / 4), currency, rupee), M, gy - 4, {
        size: 7,
        color: C.muted,
        width: axisW - 8,
        align: 'right',
      });
    }
  }

  if (max <= 0) {
    text('No expenses were recorded in this period.', plotX, plotTop + plotH / 2 - 6, {
      size: 10,
      color: C.muted,
      width: plotW,
      align: 'center',
    });
  }

  const slot = plotW / Math.max(series.length, 1);
  const barW = Math.min(slot * 0.62, 34);
  const labelEvery = Math.ceil(series.length / (series.length > 14 ? 10 : 14));
  series.forEach((point, i) => {
    const value = money(point.total).toNumber();
    const cx = plotX + slot * i + slot / 2;
    if (value > 0) {
      const h = Math.max((value / niceMax) * plotH, 1.5);
      doc.save();
      if (point.partial) doc.fillOpacity(0.55);
      doc
        .roundedRect(cx - barW / 2, baseY - h, barW, h, Math.min(2.5, barW / 4))
        .fill(level(point.level));
      doc.restore();
      if (series.length <= 12) {
        text(compactMoney(point.total, currency, rupee), cx - slot / 2, baseY - h - 11, {
          size: 6.5,
          color: C.ink,
          width: slot,
          align: 'center',
        });
      }
    }
    if (i % labelEvery === 0) {
      text(point.label, cx - (slot * labelEvery) / 2, baseY + 5, {
        size: 6.8,
        color: C.muted,
        width: slot * labelEvery,
        align: 'center',
      });
    }
  });

  // legend
  const legendY = baseY + 19;
  let lx = plotX;
  for (const l of ['HIGH', 'NORMAL', 'LOW'] as const) {
    doc.roundedRect(lx, legendY, 9, 9, 2).fill(level(l));
    text(`${LEVEL_LABELS[l]} spend`, lx + 13, legendY + 0.5, { size: 7.5, color: C.ink });
    doc.font(REG).fontSize(7.5);
    lx += 13 + doc.widthOfString(`${LEVEL_LABELS[l]} spend`) + 16;
  }
  if (series.some((p) => p.partial)) {
    doc.save().fillOpacity(0.55).roundedRect(lx, legendY, 9, 9, 2).fill(C.brand).restore();
    text('Faded: month only partly in the period', lx + 13, legendY + 0.5, {
      size: 7.5,
      color: C.muted,
    });
  }
  y = plotTop + chartH + 4;
  y += paragraph(LEVEL_RULE, M, y, W, 7.2, C.muted) + 8;

  // ---- data gaps / other currencies ----------------------------------------------

  const notes = [...summary.dataGaps.notes];
  if (summary.otherCurrencies.length > 0) {
    notes.push(
      `Also recorded in other currencies, not converted and not in the totals: ${summary.otherCurrencies
        .map((o) => `${amount(o.total, o.currency)} (${o.count})`)
        .join(', ')}.`,
    );
  }
  if (data.linesTruncated) {
    notes.push(
      'The line list was cut at 20,000 lines; every total above still includes all lines.',
    );
  }
  if (notes.length > 0) {
    const bodyW = W - 28;
    const bodyH = notes.reduce((h, note) => h + measure(`•  ${note}`, bodyW, 8.8), 0);
    const boxH = bodyH + 32;
    ensure(boxH + 10);
    doc.roundedRect(M, y, W, boxH, 6).fillAndStroke(C.warnFill, C.warnLine);
    text('Missing data — these figures may be incomplete', M + 14, y + 10, {
      size: 9.5,
      bold: true,
      color: C.warnInk,
    });
    let ny = y + 26;
    for (const note of notes) ny += paragraph(`•  ${note}`, M + 14, ny, bodyW, 8.8, C.warnInk);
    y += boxH + 14;
  }

  // ---- top types and categories -----------------------------------------------

  const hbars = (
    title: string,
    groups: ExpenseGroupDto[],
    x: number,
    top: number,
    width: number,
  ) => {
    text(title, x, top, { size: 10, bold: true });
    let ry = top + 18;
    const shown = groups.slice(0, 6);
    if (shown.length === 0) {
      text('No spending in this period', x, ry, { size: 8.5, color: C.muted });
      return ry + 16;
    }
    const peak = money(shown[0]!.total).toNumber() || 1;
    const nameW = width * 0.36;
    const amountW = width * 0.3;
    const barSpace = width - nameW - amountW - 8;
    for (const g of shown) {
      text(g.name, x, ry + 1, { size: 8.2, width: nameW - 6 });
      const bw = Math.max((money(g.total).toNumber() / peak) * barSpace, 2);
      doc.roundedRect(x + nameW, ry + 1.5, barSpace, 9, 2).fill(C.soft);
      doc.roundedRect(x + nameW, ry + 1.5, bw, 9, 2).fill(C.brand);
      text(amount(g.total), x + nameW + barSpace + 8, ry + 1, {
        size: 8,
        bold: true,
        width: amountW,
        align: 'right',
      });
      ry += 19;
    }
    return ry;
  };
  // With nothing spent, the chart already says so; empty breakdowns and tables
  // would only add a page of headings.
  const anything = t.count > 0;
  if (anything) {
    const rows = Math.max(
      Math.min(summary.byType.length, 6),
      Math.min(summary.byCategory.length, 6),
      1,
    );
    const needed = 50 + rows * 19;
    ensure(needed);
    sectionTitle('Where the money went');
    const colW = (W - 24) / 2;
    const a = hbars('Top asset types', summary.byType, M, y, colW);
    const b = hbars('Top categories', summary.byCategory, M + colW + 24, y, colW);
    y = Math.max(a, b) + 14;
  }

  // ---- tables ----------------------------------------------------------------------

  interface Col {
    label: string;
    width: number;
    align?: 'left' | 'right';
  }
  const table = (title: string, cols: Col[], rows: string[][], totals?: string[]) => {
    const rowH = 17;
    const head = () => {
      doc.rect(M, y, W, rowH + 1).fill(C.brand);
      let x = M;
      for (const c of cols) {
        text(c.label, x + 6, y + 5, {
          size: 7.8,
          bold: true,
          color: '#FFFFFF',
          width: c.width - 12,
          align: c.align ?? 'left',
        });
        x += c.width;
      }
      y += rowH + 1;
    };
    // A short table moves to the next page whole rather than leaving two rows behind.
    const full = 20 + (rows.length + (totals ? 1 : 0) + 1) * rowH + 16;
    ensure(rows.length <= 15 ? full : rowH * 3 + 26);
    sectionTitle(title);
    head();
    if (rows.length === 0) {
      text('No expenses in this period.', M + 6, y + 5, { size: 8.5, color: C.muted });
      y += rowH + 12;
      return;
    }
    rows.forEach((cells, i) => {
      if (y + rowH > CONTENT_BOTTOM) {
        doc.addPage();
        y = M;
        text(`${title} (continued)`, M, y, { size: 10, bold: true, color: C.muted });
        y += 16;
        head();
      }
      if (i % 2 === 1) doc.rect(M, y, W, rowH).fill(C.soft);
      let x = M;
      cells.forEach((cell, c) => {
        const col = cols[c]!;
        text(cell, x + 6, y + 5, { size: 8, width: col.width - 12, align: col.align ?? 'left' });
        x += col.width;
      });
      doc
        .moveTo(M, y + rowH)
        .lineTo(M + W, y + rowH)
        .lineWidth(0.3)
        .strokeColor(C.rule)
        .stroke();
      y += rowH;
    });
    if (totals) {
      if (y + rowH > CONTENT_BOTTOM) {
        doc.addPage();
        y = M;
      }
      doc.rect(M, y, W, rowH).fill(C.brandSoft);
      let x = M;
      totals.forEach((cell, c) => {
        const col = cols[c]!;
        text(cell, x + 6, y + 5, {
          size: 8,
          bold: true,
          width: col.width - 12,
          align: col.align ?? 'left',
        });
        x += col.width;
      });
      y += rowH;
    }
    y += 16;
  };

  const groupCols = (label: string): Col[] => [
    { label, width: W - 60 - 130 - 60 },
    { label: 'Items', width: 60, align: 'right' },
    { label: `Amount (${currency})`, width: 130, align: 'right' },
    { label: 'Share', width: 60, align: 'right' },
  ];
  const groupRows = (groups: ExpenseGroupDto[]) =>
    groups.map((g) => [
      g.name,
      g.count.toLocaleString('en-IN'),
      amount(g.total),
      `${g.sharePct.toFixed(1)}%`,
    ]);
  const groupTotal = (groups: ExpenseGroupDto[]) => [
    'Total',
    groups.reduce((n, g) => n + g.count, 0).toLocaleString('en-IN'),
    amount(t.total),
    groups.length ? '100.0%' : '0.0%',
  ];

  if (anything) {
    table(
      'By asset type',
      groupCols('Asset type'),
      groupRows(summary.byType),
      groupTotal(summary.byType),
    );
    table(
      'By category',
      groupCols('Category'),
      groupRows(summary.byCategory),
      groupTotal(summary.byCategory),
    );
    table(
      'By office',
      groupCols('Office'),
      groupRows(summary.byOffice),
      groupTotal(summary.byOffice),
    );
    table(
      'By vendor',
      groupCols('Vendor'),
      groupRows(summary.byVendor),
      groupTotal(summary.byVendor),
    );

    table(
      'Top 10 expenses',
      [
        { label: 'Date', width: 70 },
        { label: 'Source', width: 88 },
        { label: 'Item', width: W - 70 - 88 - 120 - 105 },
        { label: 'Category · type', width: 120 },
        { label: 'Amount', width: 105, align: 'right' },
      ],
      summary.topExpenses.map((line) => [
        shortDate(line.localDate),
        SOURCE_LABELS[line.source],
        line.title,
        [line.category, line.type].filter(Boolean).join(' · ') || '—',
        amount(line.amount, line.currency),
      ]),
    );
  }

  // ---- counting rules --------------------------------------------------------------

  {
    const width = W;
    const body = COUNTING_RULES.map((r) => `•  ${r}`);
    const h = body.reduce((sum, line) => sum + measure(line, width, 7.8), 0) + 24;
    ensure(h);
    text('How this report counts', M, y, { size: 10, bold: true, color: C.ink });
    y += 16;
    for (const line of body) y += paragraph(line, M, y, width, 7.8, C.muted);
  }

  // ---- footer on every page ----------------------------------------------------

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = PAGE.height - 34;
    doc
      .moveTo(M, fy - 8)
      .lineTo(M + W, fy - 8)
      .lineWidth(0.5)
      .strokeColor(C.rule)
      .stroke();
    text(`Confidential — generated for ${company.name}`, M, fy, {
      size: 7.5,
      color: C.muted,
      width: W * 0.7,
    });
    text(`Page ${i + 1} of ${range.count}`, M + W * 0.7, fy, {
      size: 7.5,
      color: C.muted,
      width: W * 0.3,
      align: 'right',
    });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  await finished;
  return { buffer: Buffer.concat(chunks), pages: range.count, usedRupeeGlyph: Boolean(fonts) };
}
