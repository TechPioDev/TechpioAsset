/**
 * The Monday summary for admins (Phase 2, v2.78).
 *
 * Sent once a week, Monday from 09:00 in the company's own time zone - the
 * owner's week starts in Mohali, not in UTC, where 09:00 would be 14:30.
 * Everything here is pure so the timing rules are tested without a clock.
 */

export const WEEKLY_SUMMARY_HOUR = 9;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A zone Intl refuses (a typo in the company settings) reads as UTC rather than throwing. */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function localParts(now: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    weekday: WEEKDAYS.indexOf(get('weekday')),
  };
}

/** The instant the company's current week began: Monday 00:00, local time. */
export function localWeekStart(now: Date, timeZone: string): Date {
  const zone = safeTimeZone(timeZone);
  const p = localParts(now, zone);
  // The zone's offset right now, from the wall clock it shows. Whole minutes:
  // India is +05:30, so hours alone would be half an hour out.
  const minute = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, minute: 'numeric' }).format(now),
  );
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, minute);
  const offsetMs = Math.round((wall - now.getTime()) / 60_000) * 60_000;
  const daysSinceMonday = (p.weekday + 6) % 7;
  return new Date(Date.UTC(p.year, p.month - 1, p.day - daysSinceMonday) - offsetMs);
}

/** Monday, 09:00 or later, local time. The caller makes it once a week. */
export function weeklySummaryDue(now: Date, timeZone: string): boolean {
  const p = localParts(now, safeTimeZone(timeZone));
  return p.weekday === 1 && p.hour >= WEEKLY_SUMMARY_HOUR;
}

export interface WeeklySummaryCounts {
  approvalsWaiting: number;
  receiptsUnconfirmed: number;
  returnsOverdue: number;
  lowStock: number;
  warrantiesExpiring: number;
  laptopsWithoutAgent: number;
  requestsRaised: number;
  assetsHandedOut: number;
}

const ATTENTION: readonly [keyof WeeklySummaryCounts, string, string][] = [
  ['approvalsWaiting', 'approval waiting', 'approvals waiting'],
  ['receiptsUnconfirmed', 'receipt unconfirmed', 'receipts unconfirmed'],
  ['returnsOverdue', 'return overdue', 'returns overdue'],
  ['lowStock', 'item low on stock', 'items low on stock'],
  ['warrantiesExpiring', 'warranty ending in 30 days', 'warranties ending in 30 days'],
  ['laptopsWithoutAgent', 'laptop without the agent', 'laptops without the agent'],
];

/**
 * The phone line and the email rows. The push says only what needs doing -
 * a lock-screen line has room for three things, so the first three non-zero
 * ones, in the order they block people.
 */
export function weeklySummaryText(counts: WeeklySummaryCounts): {
  pushBody: string;
  rows: [string, string][];
} {
  const needing = ATTENTION.filter(([key]) => counts[key] > 0).map(
    ([key, one, many]) => `${counts[key]} ${counts[key] === 1 ? one : many}`,
  );
  const pushBody =
    needing.length === 0
      ? 'Nothing is waiting on anyone this week.'
      : needing.slice(0, 3).join(' · ') +
        (needing.length > 3 ? ` · +${needing.length - 3} more` : '');
  const rows: [string, string][] = [
    ['Approvals waiting', String(counts.approvalsWaiting)],
    ['Receipts not confirmed', String(counts.receiptsUnconfirmed)],
    ['Returns overdue', String(counts.returnsOverdue)],
    ['Items low on stock', String(counts.lowStock)],
    ['Warranties ending in 30 days', String(counts.warrantiesExpiring)],
    ['Laptops without the agent', String(counts.laptopsWithoutAgent)],
    ['Requests raised last week', String(counts.requestsRaised)],
    ['Assets handed out last week', String(counts.assetsHandedOut)],
  ];
  return { pushBody, rows };
}
