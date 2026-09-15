import Decimal from 'decimal.js';
import { money, type MoneyInput } from './money';

/**
 * Expense reporting (v2.59) - the pure half.
 *
 * WHAT COUNTS AS AN EXPENSE (owner decision, 15 Sep 2026)
 *
 *   1. An asset's purchase price, dated by its purchase date.
 *   2. A repair / maintenance job's service cost, dated when the job was
 *      closed (approved; completion date for jobs closed before sign-off).
 *   3. A software licence's cost, dated by its purchase date, plus the cost of
 *      each recorded renewal, dated by the renewal.
 *
 * Invoices are deliberately NOT counted: an invoice is the bill for the same
 * purchase, so adding it would count the laptop twice.
 *
 * Everything here is calendar arithmetic and exact decimal arithmetic. No
 * floats touch a total, and nothing is estimated - "do not use AI for exact
 * pricing calculations" is the owner's rule and this module has no inputs a
 * model could supply.
 *
 * TIME ZONES
 *
 * A period is a run of whole calendar days in the COMPANY's time zone. "Today"
 * for an Indian company begins at 00:00 IST, which is 18:30 UTC the day before;
 * reading it in the server's zone (UTC in the container) would put a purchase
 * made at 01:00 IST on the wrong day. Each period resolves to a half-open UTC
 * interval [from, to) that the database filters on directly.
 */

export const EXPENSE_SOURCES = ['ASSET', 'MAINTENANCE', 'LICENCE'] as const;
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number];

export const EXPENSE_SOURCE_LABELS: Record<ExpenseSource, string> = {
  ASSET: 'Asset purchases',
  MAINTENANCE: 'Repairs & maintenance',
  LICENCE: 'Software licences',
};

export const EXPENSE_PERIOD_PRESETS = [
  'TODAY',
  'LAST_10_DAYS',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
  'LAST_6_MONTHS',
  'LAST_12_MONTHS',
  'THIS_YEAR',
  'CUSTOM',
] as const;
export type ExpensePeriodPreset = (typeof EXPENSE_PERIOD_PRESETS)[number];

export const EXPENSE_PRESET_LABELS: Record<ExpensePeriodPreset, string> = {
  TODAY: 'Today',
  LAST_10_DAYS: 'Last 10 days',
  LAST_30_DAYS: 'Last 1 month (30 days)',
  LAST_90_DAYS: 'Last 3 months (90 days)',
  LAST_6_MONTHS: 'Last 6 months',
  LAST_12_MONTHS: 'Last 12 months',
  THIS_YEAR: 'This year',
  CUSTOM: 'Custom range',
};

/** A custom range longer than this is refused; five years is 61 monthly bars. */
export const MAX_EXPENSE_PERIOD_DAYS = 1827;

/** Up to this many days the series is daily; beyond it, monthly. */
export const DAILY_BUCKET_MAX_DAYS = 31;

export class ExpensePeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpensePeriodError';
  }
}

// ---------------------------------------------------------------------------
// calendar dates ("YYYY-MM-DD", no zone) and zone conversion
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDate(date: string): { y: number; m: number; d: number } {
  const match = DATE_RE.exec(date);
  if (!match) throw new ExpensePeriodError(`Not a calendar date (YYYY-MM-DD): ${date}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new ExpensePeriodError(`Not a real calendar date: ${date}`);
  }
  return { y, m, d };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function formatDate(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function isCalendarDate(value: string): boolean {
  try {
    parseDate(value);
    return true;
  } catch {
    return false;
  }
}

/** `date` moved by `days` calendar days. */
export function addCalendarDays(date: string, days: number): string {
  const { y, m, d } = parseDate(date);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return formatDate(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** Whole days from `a` to `b` (b - a). */
export function calendarDaysBetween(a: string, b: string): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function wallClockParts(instant: Date, timeZone: string) {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    zoneFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    y: get('year'),
    m: get('month'),
    d: get('day'),
    hh: get('hour'),
    mm: get('minute'),
    ss: get('second'),
  };
}

/** The calendar date an instant falls on, read on the wall clock in `timeZone`. */
export function calendarDateInZone(instant: Date, timeZone: string): string {
  const p = wallClockParts(instant, timeZone);
  return formatDate(p.y, p.m, p.d);
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (IST is +19,800,000). */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = wallClockParts(instant, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant at which `date` begins (00:00) in `timeZone`.
 *
 * Two passes: the offset is read once at a first guess and again at the
 * corrected instant, which settles every zone including those whose offset
 * changes that day. Where midnight itself does not exist (a zone that springs
 * forward at 00:00) the result is the first instant of the day that does.
 */
export function startOfCalendarDay(date: string, timeZone: string): Date {
  const { y, m, d } = parseDate(date);
  const naive = Date.UTC(y, m - 1, d);
  const firstOffset = zoneOffsetMs(new Date(naive), timeZone);
  let candidate = naive - firstOffset;
  const secondOffset = zoneOffsetMs(new Date(candidate), timeZone);
  if (secondOffset !== firstOffset) candidate = naive - secondOffset;
  // Midnight skipped by a spring-forward: the day starts at the first instant
  // that reads as this date.
  if (calendarDateInZone(new Date(candidate), timeZone) !== date) {
    candidate = naive - firstOffset;
  }
  return new Date(candidate);
}

/** "15 Sep 2026". */
export function formatCalendarDate(date: string): string {
  const { y, m, d } = parseDate(date);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// ---------------------------------------------------------------------------
// periods
// ---------------------------------------------------------------------------

export type ExpenseGranularity = 'DAY' | 'MONTH';

export interface ExpensePeriodInput {
  preset: ExpensePeriodPreset;
  /** CUSTOM only: first day, inclusive, in the company zone. */
  from?: string;
  /** CUSTOM only: last day, inclusive, in the company zone. */
  to?: string;
}

export interface ResolvedExpensePeriod {
  preset: ExpensePeriodPreset;
  /** First calendar day, inclusive. */
  fromDate: string;
  /** Last calendar day, inclusive. */
  toDate: string;
  /** Start of `fromDate` in the zone - inclusive bound for the database. */
  from: Date;
  /** Start of the day AFTER `toDate` in the zone - exclusive bound. */
  to: Date;
  days: number;
  granularity: ExpenseGranularity;
  /** "Last 1 month (30 days)". */
  label: string;
  /** "17 Aug 2026 – 15 Sep 2026", or one date for a single day. */
  rangeLabel: string;
  timeZone: string;
}

function build(
  preset: ExpensePeriodPreset,
  fromDate: string,
  toDate: string,
  timeZone: string,
  label: string,
): ResolvedExpensePeriod {
  const days = calendarDaysBetween(fromDate, toDate) + 1;
  return {
    preset,
    fromDate,
    toDate,
    from: startOfCalendarDay(fromDate, timeZone),
    to: startOfCalendarDay(addCalendarDays(toDate, 1), timeZone),
    days,
    granularity: days <= DAILY_BUCKET_MAX_DAYS ? 'DAY' : 'MONTH',
    label,
    rangeLabel:
      fromDate === toDate
        ? formatCalendarDate(fromDate)
        : `${formatCalendarDate(fromDate)} – ${formatCalendarDate(toDate)}`,
    timeZone,
  };
}

/** First day of the month `monthsBack` months before the month of `date`. */
function firstOfMonthBack(date: string, monthsBack: number): string {
  const { y, m } = parseDate(date);
  const first = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
  return formatDate(first.getUTCFullYear(), first.getUTCMonth() + 1, 1);
}

/**
 * Resolve a preset to whole calendar days in the company zone.
 *
 *   TODAY           today
 *   LAST_10_DAYS    the 10 days ending today (today included)
 *   LAST_30_DAYS    the 30 days ending today - "1 month"
 *   LAST_90_DAYS    the 90 days ending today - "3 months"
 *   LAST_6_MONTHS   the current month to date and the 5 whole months before it
 *   LAST_12_MONTHS  the current month to date and the 11 whole months before it
 *   THIS_YEAR       1 January to today
 *   CUSTOM          from..to inclusive, at most MAX_EXPENSE_PERIOD_DAYS
 *
 * The month presets start on the 1st so every monthly bar is a real calendar
 * month and "which months were high" compares like with like; only the current
 * month is partial, and the series marks it so.
 */
export function resolveExpensePeriod(
  input: ExpensePeriodInput,
  timeZone: string,
  now: Date = new Date(),
): ResolvedExpensePeriod {
  if (!isValidTimeZone(timeZone)) throw new ExpensePeriodError(`Unknown time zone: ${timeZone}`);
  const today = calendarDateInZone(now, timeZone);
  const label = EXPENSE_PRESET_LABELS[input.preset];

  switch (input.preset) {
    case 'TODAY':
      return build('TODAY', today, today, timeZone, label);
    case 'LAST_10_DAYS':
      return build('LAST_10_DAYS', addCalendarDays(today, -9), today, timeZone, label);
    case 'LAST_30_DAYS':
      return build('LAST_30_DAYS', addCalendarDays(today, -29), today, timeZone, label);
    case 'LAST_90_DAYS':
      return build('LAST_90_DAYS', addCalendarDays(today, -89), today, timeZone, label);
    case 'LAST_6_MONTHS':
      return build('LAST_6_MONTHS', firstOfMonthBack(today, 5), today, timeZone, label);
    case 'LAST_12_MONTHS':
      return build('LAST_12_MONTHS', firstOfMonthBack(today, 11), today, timeZone, label);
    case 'THIS_YEAR':
      return build('THIS_YEAR', `${today.slice(0, 4)}-01-01`, today, timeZone, label);
    case 'CUSTOM': {
      if (!input.from || !input.to) {
        throw new ExpensePeriodError('A custom range needs both a start and an end date');
      }
      parseDate(input.from);
      parseDate(input.to);
      const span = calendarDaysBetween(input.from, input.to) + 1;
      if (span < 1)
        throw new ExpensePeriodError('The start date must be on or before the end date');
      if (span > MAX_EXPENSE_PERIOD_DAYS) {
        throw new ExpensePeriodError(
          `A custom range can cover at most ${MAX_EXPENSE_PERIOD_DAYS} days (five years)`,
        );
      }
      return build('CUSTOM', input.from, input.to, timeZone, label);
    }
    default:
      throw new ExpensePeriodError(`Unknown period: ${String(input.preset)}`);
  }
}

/**
 * The comparison period: the same number of days, ending the day before this
 * one starts. "Last 30 days" compares with the 30 days before those; a
 * 258-day "this year" compares with the 258 days before 1 January. Equal
 * length is what makes the percentage change meaningful.
 */
export function previousExpensePeriod(period: ResolvedExpensePeriod): ResolvedExpensePeriod {
  const toDate = addCalendarDays(period.fromDate, -1);
  const fromDate = addCalendarDays(period.fromDate, -period.days);
  return build(period.preset, fromDate, toDate, period.timeZone, `Previous ${period.days} days`);
}

// ---------------------------------------------------------------------------
// buckets
// ---------------------------------------------------------------------------

export interface ExpenseBucket {
  /** "2026-09-15" (DAY) or "2026-09" (MONTH) - matches the database grouping key. */
  key: string;
  /** "15 Sep" (DAY) or "Sep 2026" (MONTH). */
  label: string;
  fromDate: string;
  toDate: string;
  /** The bucket's calendar day or month is only partly inside the period. */
  partial: boolean;
}

/** The bucket key an instant belongs to. The API's SQL produces the same text. */
export function expenseBucketKey(
  instant: Date,
  timeZone: string,
  granularity: ExpenseGranularity,
): string {
  const date = calendarDateInZone(instant, timeZone);
  return granularity === 'DAY' ? date : date.slice(0, 7);
}

/** Every bucket of the period in order, including the empty ones. */
export function expenseBuckets(period: ResolvedExpensePeriod): ExpenseBucket[] {
  const out: ExpenseBucket[] = [];
  if (period.granularity === 'DAY') {
    for (let i = 0; i < period.days; i += 1) {
      const date = addCalendarDays(period.fromDate, i);
      const { m, d } = parseDate(date);
      out.push({
        key: date,
        label: `${d} ${MONTHS[m - 1]}`,
        fromDate: date,
        toDate: date,
        partial: false,
      });
    }
    return out;
  }

  let cursor = `${period.fromDate.slice(0, 7)}-01`;
  while (cursor <= period.toDate) {
    const { y, m } = parseDate(cursor);
    const monthEnd = formatDate(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
    const fromDate = cursor < period.fromDate ? period.fromDate : cursor;
    const toDate = monthEnd > period.toDate ? period.toDate : monthEnd;
    out.push({
      key: cursor.slice(0, 7),
      label: `${MONTHS[m - 1]} ${y}`,
      fromDate,
      toDate,
      partial: fromDate !== cursor || toDate !== monthEnd,
    });
    cursor = addCalendarDays(monthEnd, 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// high / normal / low
// ---------------------------------------------------------------------------

export const EXPENSE_LEVELS = ['HIGH', 'NORMAL', 'LOW', 'NONE'] as const;
export type ExpenseLevel = (typeof EXPENSE_LEVELS)[number];

export const EXPENSE_HIGH_RATIO = '1.25';
export const EXPENSE_LOW_RATIO = '0.75';
export const EXPENSE_MIN_BUCKETS_TO_CLASSIFY = 3;

/**
 * Label each bucket HIGH, NORMAL, LOW or NONE.
 *
 * THE RULE
 *
 *   - A bucket with no spend is NONE. It is not "low": nothing happened.
 *   - The baseline is the MEDIAN of the non-zero buckets (the mean of the two
 *     middle values when there is an even number of them). The median, not the
 *     mean, so one ₹12,00,000 server purchase does not make every other month
 *     look low.
 *   - A non-zero bucket at or above 1.25 × the median is HIGH; at or below
 *     0.75 × the median is LOW; anything between is NORMAL.
 *   - With fewer than 3 non-zero buckets there is no meaningful "usual", so
 *     every non-zero bucket is NORMAL.
 *
 * Exact decimals throughout: 1.25 × median is compared as a Decimal, so a
 * bucket exactly on the line lands on the documented side every time.
 */
export function classifyExpenseBuckets(totals: readonly MoneyInput[]): ExpenseLevel[] {
  const values = totals.map((t) => money(t));
  const nonZero = values.filter((v) => !v.isZero()).sort((a, b) => a.comparedTo(b));
  if (nonZero.length < EXPENSE_MIN_BUCKETS_TO_CLASSIFY) {
    return values.map((v) => (v.isZero() ? 'NONE' : 'NORMAL'));
  }
  const median = expenseMedian(nonZero);
  const high = median.times(EXPENSE_HIGH_RATIO);
  const low = median.times(EXPENSE_LOW_RATIO);
  return values.map((v) => {
    if (v.isZero()) return 'NONE';
    if (v.greaterThanOrEqualTo(high)) return 'HIGH';
    if (v.lessThanOrEqualTo(low)) return 'LOW';
    return 'NORMAL';
  });
}

/** Median of already-sorted decimals. */
function expenseMedian(sorted: readonly Decimal[]): Decimal {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return sorted[mid - 1]!.plus(sorted[mid]!).dividedBy(2);
}

// ---------------------------------------------------------------------------
// percentages and money text
// ---------------------------------------------------------------------------

/**
 * Change from `previous` to `current` in percent, to one decimal place.
 * Null when there was nothing before - "+∞%" helps nobody.
 */
export function expenseChangePct(current: MoneyInput, previous: MoneyInput): number | null {
  const prev = money(previous);
  if (prev.isZero()) return null;
  return money(current)
    .minus(prev)
    .dividedBy(prev)
    .times(100)
    .toDecimalPlaces(1, Decimal.ROUND_HALF_UP)
    .toNumber();
}

/** `part` as a percentage of `whole`, to one decimal place; 0 when the whole is 0. */
export function expenseSharePct(part: MoneyInput, whole: MoneyInput): number {
  const w = money(whole);
  if (w.isZero()) return 0;
  return money(part).dividedBy(w).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber();
}

/** "12,50,000" - the last three digits, then pairs. */
export function groupDigitsIndian(whole: string): string {
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  return rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
}

function groupDigitsWestern(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export interface MoneyTextOptions {
  /**
   * What stands for the rupee. "₹" by default; a renderer whose font has no ₹
   * glyph passes "INR " rather than printing a blank box.
   */
  rupee?: string;
}

/**
 * Exact money text from a decimal string or Decimal - never a float.
 *
 *   INR  ₹12,50,000.00   (Indian grouping)   -₹1,000.00   ₹0.00
 *   USD  USD 1,250,000.00                     -USD 5.50
 *
 * Other currencies keep their ISO code and western grouping: a dollar figure
 * grouped in lakhs reads as a typo to anyone who deals in dollars.
 */
export function formatMoneyText(
  amount: MoneyInput,
  currency: string,
  options: MoneyTextOptions = {},
): string {
  const value = money(amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const negative = value.isNegative() && !value.isZero();
  const [whole, fraction] = value.abs().toFixed(2).split('.') as [string, string];
  const code = currency.toUpperCase();
  if (code === 'INR') {
    return `${negative ? '-' : ''}${options.rupee ?? '₹'}${groupDigitsIndian(whole)}.${fraction}`;
  }
  return `${negative ? '-' : ''}${code} ${groupDigitsWestern(whole)}.${fraction}`;
}
