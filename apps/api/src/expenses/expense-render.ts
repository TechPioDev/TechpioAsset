import Decimal from 'decimal.js';
import type { ExpenseQuery } from '@techpioasset/contracts';
import { formatMoneyText, money, type ExpenseLevel } from '@techpioasset/domain';
import type { ExpenseCompany, ExpenseReportData } from './expenses.service.js';

/** Pieces both the PDF and the workbook print, so the two files say the same thing. */

export const LEVEL_LABELS: Record<ExpenseLevel, string> = {
  HIGH: 'High',
  NORMAL: 'Normal',
  LOW: 'Low',
  NONE: 'No spend',
};

/** Bar and badge colours (hex, no #). High is warm, low is cool-green, normal is the brand blue. */
export const LEVEL_COLOURS: Record<ExpenseLevel, string> = {
  HIGH: 'E8590C',
  NORMAL: '1D4ED8',
  LOW: '0CA678',
  NONE: 'CBD5E1',
};

export const SOURCE_LABELS = {
  ASSET: 'Asset purchases',
  MAINTENANCE: 'Repairs & maintenance',
  LICENCE: 'Software licences',
} as const;

export const COUNTING_RULES = [
  'Asset purchases: the purchase price of each asset, dated by its purchase date.',
  'Repairs & maintenance: the service cost of each completed (approved) job, dated when it was closed. Jobs still awaiting approval are not counted.',
  'Software licences: the licence cost dated by its purchase date, plus the cost of each recorded renewal dated by the renewal.',
  'Invoices are not added: an invoice is the bill for the same purchase and would count it twice.',
  'Amounts in another currency are listed separately and never converted or added to the totals.',
];

export const LEVEL_RULE =
  'High / Normal / Low compares each day or month that had spending with the median of all such days or months in the period: 1.25× the median or more is High, 0.75× or less is Low, anything between is Normal. With fewer than three spending days or months, all are Normal.';

/** "15 Sep 2026, 18:40" on the company's wall clock. */
export function stampInZone(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  // Month names written out here: en-GB spells September "Sept" on newer ICU.
  const date = shortDate(`${get('year')}-${get('month')}-${get('day')}`);
  return `${date}, ${get('hour')}:${get('minute')}`;
}

/** "15 Sep 2026" from YYYY-MM-DD. */
export function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}

/** Phone and email on one line, address on another; blanks dropped. */
export function contactLines(company: ExpenseCompany): string[] {
  const first = [company.contactPhone, company.contactEmail]
    .filter((v) => v && v.trim())
    .join('   ·   ');
  return [first, company.address?.trim() ?? ''].filter(Boolean);
}

export function moneyText(amount: string, currency: string, rupee?: string): string {
  return formatMoneyText(amount, currency, rupee ? { rupee } : {});
}

/**
 * Compact axis label: ₹12.5L, ₹1.2Cr, ₹950 (INR); USD 1.2M elsewhere.
 * Only for chart axes - every printed figure elsewhere is exact.
 */
export function compactMoney(amount: Decimal | string, currency: string, rupee = '₹'): string {
  const v = money(amount);
  const trim = (d: Decimal) => d.toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toString();
  if (currency === 'INR') {
    if (v.greaterThanOrEqualTo(10_000_000)) return `${rupee}${trim(v.dividedBy(10_000_000))}Cr`;
    if (v.greaterThanOrEqualTo(100_000)) return `${rupee}${trim(v.dividedBy(100_000))}L`;
    if (v.greaterThanOrEqualTo(1_000)) return `${rupee}${trim(v.dividedBy(1_000))}K`;
    return `${rupee}${v.toDecimalPlaces(0).toString()}`;
  }
  if (v.greaterThanOrEqualTo(1_000_000)) return `${currency} ${trim(v.dividedBy(1_000_000))}M`;
  if (v.greaterThanOrEqualTo(1_000)) return `${currency} ${trim(v.dividedBy(1_000))}K`;
  return `${currency} ${v.toDecimalPlaces(0).toString()}`;
}

/** "Last 30 days · 17 Aug 2026 – 15 Sep 2026". */
export function periodLine(data: ExpenseReportData): string {
  return `${data.summary.period.label}   ·   ${data.summary.period.rangeLabel}`;
}

export function changeText(changePct: number | null): string {
  if (changePct === null) return 'No spend in the previous period';
  if (changePct === 0) return 'No change';
  return `${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%`;
}

/** pioassets-expenses-2026-08-17-2026-09-15.pdf */
export function exportFilename(fromDate: string, toDate: string, format: 'xlsx' | 'pdf'): string {
  return `pioassets-expenses-${fromDate}-${toDate}.${format}`;
}

/** The query fields that define a report, in a stable shape for claims and audit rows. */
export function canonicalQuery(query: ExpenseQuery): ExpenseQuery {
  return {
    preset: query.preset,
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    ...(query.officeId ? { officeId: query.officeId } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
  };
}
