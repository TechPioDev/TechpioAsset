import {
  EXPENSE_PERIOD_PRESETS,
  isCalendarDate,
  type ExpenseLevel,
  type ExpensePeriodPreset,
} from '@techpioasset/domain';

/**
 * The pure half of the phone's Expenses screen (v2.59, Super Admin only).
 *
 * Kept out of the screen so the rules that decide what a number LOOKS like -
 * the short "₹14.7L" bar label, how tall a bar is, what the change line says -
 * are tested without a device. Totals themselves are never computed here: the
 * API sends exact decimal strings and the screen shows them with
 * `formatMoneyText`. Only the abbreviated chart label goes through a number,
 * and it is labelled as an abbreviation by its "K / L / Cr" suffix.
 */

/** The chip under each preset. Shorter than EXPENSE_PRESET_LABELS so eight fit a swipe. */
export const EXPENSE_CHIP_LABELS: Record<ExpensePeriodPreset, string> = {
  TODAY: 'Today',
  LAST_10_DAYS: '10 days',
  LAST_30_DAYS: '1 month',
  LAST_90_DAYS: '3 months',
  LAST_6_MONTHS: '6 months',
  LAST_12_MONTHS: '12 months',
  THIS_YEAR: 'This year',
  CUSTOM: 'Custom',
};

export const EXPENSE_CHIPS = EXPENSE_PERIOD_PRESETS.map((preset) => ({
  preset,
  label: EXPENSE_CHIP_LABELS[preset],
}));

function trimZero(text: string): string {
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

/**
 * An abbreviated amount for a bar label or a tight tile.
 *
 *   INR   ₹950   ₹12.5K   ₹14.7L   ₹1.2Cr   (thousand, lakh, crore)
 *   other USD 950   USD 12.5K   USD 1.3M   USD 2B
 *
 * One decimal, trailing ".0" dropped. Never used for a total a reader acts on -
 * those use the exact formatter.
 */
export function formatMoneyShort(amount: string | number, currency: string): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value)) return '—';
  const negative = value < 0;
  const abs = Math.abs(value);
  const code = currency.toUpperCase();
  const steps =
    code === 'INR'
      ? [
          { at: 1e7, suffix: 'Cr' },
          { at: 1e5, suffix: 'L' },
          { at: 1e3, suffix: 'K' },
        ]
      : [
          { at: 1e9, suffix: 'B' },
          { at: 1e6, suffix: 'M' },
          { at: 1e3, suffix: 'K' },
        ];
  let body = String(Math.round(abs));
  for (const step of steps) {
    if (abs >= step.at) {
      // Rounded down to one decimal so 99,999 reads "99.9K", never "100K" next to "₹1L".
      body = `${trimZero((Math.floor((abs / step.at) * 10) / 10).toFixed(1))}${step.suffix}`;
      break;
    }
  }
  const prefix = code === 'INR' ? '₹' : `${code} `;
  return `${negative ? '-' : ''}${prefix}${body}`;
}

/**
 * Bar heights in pixels for a set of totals.
 *
 * The tallest bar fills `maxPx`; every other bar is to scale. A bucket with no
 * spend is 0 (nothing drawn). A non-zero bucket is at least `minPx` tall, so a
 * ₹500 repair beside a ₹12L server purchase is still visibly "something".
 */
export function scaleBars(totals: readonly (string | number)[], maxPx: number, minPx = 3): number[] {
  const values = totals.map((t) => {
    const n = typeof t === 'number' ? t : Number(t);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const max = Math.max(0, ...values);
  if (max === 0) return values.map(() => 0);
  return values.map((v) => (v === 0 ? 0 : Math.max(minPx, Math.round((v / max) * maxPx))));
}

/** Width of a share bar, 0-100, for a sharePct from the API. */
export function shareWidth(sharePct: number): number {
  if (!Number.isFinite(sharePct) || sharePct <= 0) return 0;
  return Math.min(100, Math.max(2, sharePct));
}

/**
 * The comparison line under the total.
 *
 * Worded as "more" and "less", never "up/good" or "down/bad": spending more is
 * not automatically worse, and the screen does not colour it as though it were.
 */
export function describeChange(changePct: number | null, previousTotalIsZero: boolean): {
  text: string;
  direction: 'up' | 'down' | 'flat' | 'none';
} {
  if (changePct === null) {
    return {
      text: previousTotalIsZero ? 'Nothing recorded in the previous period' : 'No comparison',
      direction: 'none',
    };
  }
  if (changePct === 0) return { text: 'Same as the previous period', direction: 'flat' };
  const abs = Math.abs(changePct);
  return changePct > 0
    ? { text: `${abs}% more than the previous period`, direction: 'up' }
    : { text: `${abs}% less than the previous period`, direction: 'down' };
}

export const EXPENSE_LEVEL_LABELS: Record<ExpenseLevel, string> = {
  HIGH: 'High',
  NORMAL: 'Normal',
  LOW: 'Low',
  NONE: 'No spend',
};

/** The shared tone each level is drawn in. NONE draws nothing. */
export const EXPENSE_LEVEL_TONES: Record<Exclude<ExpenseLevel, 'NONE'>, 'critical' | 'info' | 'neutral'> = {
  HIGH: 'critical',
  NORMAL: 'info',
  LOW: 'neutral',
};

export interface ExpenseQueryInput {
  preset: ExpensePeriodPreset;
  from?: string;
  to?: string;
  officeId?: string | null;
  categoryId?: string | null;
}

/** A message for a custom range that cannot be sent yet, or null when it is fine. */
export function customRangeError(from: string, to: string): string | null {
  const f = from.trim();
  const t = to.trim();
  if (!f || !t) return 'Enter both dates as YYYY-MM-DD.';
  if (!isCalendarDate(f)) return 'The start date must be a real date (YYYY-MM-DD).';
  if (!isCalendarDate(t)) return 'The end date must be a real date (YYYY-MM-DD).';
  if (f > t) return 'The end date must be on or after the start date.';
  return null;
}

/** The query string for /expenses/summary (no leading "?"). */
export function expenseQueryString(input: ExpenseQueryInput): string {
  const params: string[] = [`preset=${input.preset}`];
  if (input.preset === 'CUSTOM') {
    if (input.from) params.push(`from=${encodeURIComponent(input.from.trim())}`);
    if (input.to) params.push(`to=${encodeURIComponent(input.to.trim())}`);
  }
  if (input.officeId) params.push(`officeId=${encodeURIComponent(input.officeId)}`);
  if (input.categoryId) params.push(`categoryId=${encodeURIComponent(input.categoryId)}`);
  return params.join('&');
}

/** The body for POST /expenses/export-link. */
export function exportLinkBody(format: 'pdf' | 'xlsx', input: ExpenseQueryInput) {
  return {
    format,
    preset: input.preset,
    ...(input.preset === 'CUSTOM' ? { from: input.from?.trim(), to: input.to?.trim() } : {}),
    ...(input.officeId ? { officeId: input.officeId } : {}),
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
  };
}

/** Where a top-expense line opens in the app, or null when there is no screen for it. */
export function expenseLineRoute(line: {
  source: 'ASSET' | 'MAINTENANCE' | 'LICENCE';
  id: string;
  assetId: string | null;
  title: string;
}): string | null {
  if (line.source === 'ASSET') return `/asset/${line.assetId ?? line.id}`;
  if (line.source === 'MAINTENANCE') return `/work-order/${line.id}`;
  // A renewal line carries the renewal's id, not the licence's, so it has no
  // screen of its own. The API marks renewals in the title.
  if (line.title.endsWith('(renewal)')) return null;
  return `/license/${line.id}`;
}
