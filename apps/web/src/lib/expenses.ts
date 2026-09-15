import type { ExpenseLevel, ExpensePeriodPreset } from '@techpioasset/domain';

/**
 * The pure half of the web Expenses page (v2.59, Super Admin only).
 *
 * Totals are never computed here - the API sends exact decimal strings and the
 * page shows them with `formatMoneyText`. What lives here is how a figure is
 * abbreviated on a chart axis, how the comparison is worded, which colour a
 * level is drawn in, and where a line links to: small rules, tested once.
 */

export const EXPENSE_SEGMENTS: { preset: ExpensePeriodPreset; label: string }[] = [
  { preset: 'TODAY', label: 'Today' },
  { preset: 'LAST_10_DAYS', label: '10 days' },
  { preset: 'LAST_30_DAYS', label: '1 month' },
  { preset: 'LAST_90_DAYS', label: '3 months' },
  { preset: 'LAST_6_MONTHS', label: '6 months' },
  { preset: 'LAST_12_MONTHS', label: '12 months' },
  { preset: 'THIS_YEAR', label: 'This year' },
  { preset: 'CUSTOM', label: 'Custom' },
];

export interface ExpenseFilters {
  preset: ExpensePeriodPreset;
  from?: string;
  to?: string;
  officeId?: string;
  categoryId?: string;
}

/** Query string for /expenses/summary and /expenses/export (no leading "?"). */
export function expenseQueryString(filters: ExpenseFilters, format?: 'pdf' | 'xlsx'): string {
  const params = new URLSearchParams();
  if (format) params.set('format', format);
  params.set('preset', filters.preset);
  if (filters.preset === 'CUSTOM') {
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
  }
  if (filters.officeId) params.set('officeId', filters.officeId);
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  return params.toString();
}

/** True when a custom range is complete and in order, so it is worth asking for. */
export function customRangeReady(from: string, to: string): boolean {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  return date.test(from) && date.test(to) && from <= to;
}

function trimZero(text: string): string {
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

/**
 * Abbreviated money for an axis tick: ₹950, ₹12.5K, ₹14.7L, ₹1.2Cr for rupees;
 * USD 1.2M style otherwise. Rounded down to one decimal so a value never reads
 * as the next unit. Never used for a figure a reader acts on.
 */
export function formatMoneyShort(amount: string | number, currency: string): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const code = currency.toUpperCase();
  const steps =
    code === 'INR'
      ? ([
          [1e7, 'Cr'],
          [1e5, 'L'],
          [1e3, 'K'],
        ] as const)
      : ([
          [1e9, 'B'],
          [1e6, 'M'],
          [1e3, 'K'],
        ] as const);
  let body = String(Math.round(abs));
  for (const [at, suffix] of steps) {
    if (abs >= at) {
      body = `${trimZero((Math.floor((abs / at) * 10) / 10).toFixed(1))}${suffix}`;
      break;
    }
  }
  return `${value < 0 ? '-' : ''}${code === 'INR' ? '₹' : `${code} `}${body}`;
}

/** "12.5% more" / "8% less" - never good/bad, and never coloured as though it were. */
export function describeChange(changePct: number | null): {
  text: string;
  direction: 'up' | 'down' | 'flat' | 'none';
} {
  if (changePct === null) return { text: 'Nothing recorded in the previous period', direction: 'none' };
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

/** The status-tone colour a level is drawn in; the same tones the phone uses. */
export function expenseLevelFill(level: ExpenseLevel): string {
  switch (level) {
    case 'HIGH':
      return 'var(--tone-critical-solid)';
    case 'NORMAL':
      return 'var(--tone-info-solid)';
    case 'LOW':
      return 'var(--tone-neutral-solid)';
    default:
      return 'transparent';
  }
}

/** Where a top-expense line links, or null when it has no page of its own. */
export function expenseLineHref(line: {
  source: 'ASSET' | 'MAINTENANCE' | 'LICENCE';
  id: string;
  assetId: string | null;
  title: string;
}): string | null {
  if (line.source === 'ASSET') return `/assets/${line.assetId ?? line.id}`;
  if (line.source === 'MAINTENANCE') return `/maintenance/${line.id}`;
  // A renewal's id is the renewal's, not the licence's; the API marks renewals in the title.
  if (line.title.endsWith('(renewal)')) return null;
  return `/licenses/${line.id}`;
}

/**
 * The top `limit` groups, with the remainder folded into one "Other" row so a
 * long tail does not become a wall of thin bars. Totals are summed as numbers
 * for DRAWING only; the tooltip and table show the API's exact strings.
 */
export function topWithOther<T extends { name: string; total: string; count: number; sharePct: number }>(
  rows: readonly T[],
  limit: number,
): { name: string; value: number; total: string | null; count: number; sharePct: number }[] {
  const head = rows.slice(0, limit).map((r) => ({
    name: r.name,
    value: Number(r.total),
    total: r.total as string | null,
    count: r.count,
    sharePct: r.sharePct,
  }));
  const tail = rows.slice(limit);
  if (tail.length === 0) return head;
  return [
    ...head,
    {
      name: `Other (${tail.length})`,
      value: tail.reduce((sum, r) => sum + Number(r.total), 0),
      total: null,
      count: tail.reduce((sum, r) => sum + r.count, 0),
      sharePct: Math.round(tail.reduce((sum, r) => sum + r.sharePct, 0) * 10) / 10,
    },
  ];
}

/** The filename from a Content-Disposition header, or null. */
export function filenameFromDisposition(header: string | null): string | null {
  const match = header ? /filename="?([^";]+)"?/i.exec(header) : null;
  return match?.[1] ?? null;
}
