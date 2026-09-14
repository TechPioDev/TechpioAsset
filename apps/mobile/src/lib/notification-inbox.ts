/**
 * Pure helpers for the in-app notification inbox (mobile).
 *
 * The phone had push only: a notification swiped away was gone. The inbox reads
 * the same list the web bell reads (`GET /notifications`), and the badge the
 * same count (`GET /notifications/unread-count`). Kept free of React Native so
 * the grouping and counting can be tested under vitest.
 */

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  linkPath: string | null;
  readAt: string | null;
  simulated: boolean;
  createdAt: string;
}

/** The web bell refetches the count every 60s; the phone never polls faster. */
export const UNREAD_POLL_MS = 60_000;

/** Same cap as the web bell: two digits do not fit on a 20px badge. */
export function badgeLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 9 ? '9+' : String(Math.floor(count));
}

export function unreadCount(rows: readonly NotificationRow[]): number {
  return rows.reduce((n, r) => (r.readAt ? n : n + 1), 0);
}

/**
 * Marks one row read in a local copy, so the tap shows immediately rather than
 * after the round trip. Rows already read keep their original time.
 */
export function markReadLocally(
  rows: readonly NotificationRow[],
  id: string,
  at: string,
): NotificationRow[] {
  return rows.map((r) => (r.id === id && !r.readAt ? { ...r, readAt: at } : r));
}

export function markAllReadLocally(rows: readonly NotificationRow[], at: string): NotificationRow[] {
  return rows.map((r) => (r.readAt ? r : { ...r, readAt: at }));
}

export interface DaySection {
  key: string;
  title: string;
  data: NotificationRow[];
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Groups rows (already newest first from the API) into local-calendar days:
 * "Today", "Yesterday", then the date. Order inside and between days is kept
 * as given. A row with an unreadable date lands in "Earlier" rather than
 * disappearing.
 */
export function groupByDay(
  rows: readonly NotificationRow[],
  now: Date = new Date(),
  formatDate: (d: Date) => string = (d) =>
    d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
): DaySection[] {
  const today = localDayKey(now);
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterday = localDayKey(y);

  const sections: DaySection[] = [];
  const byKey = new Map<string, DaySection>();
  for (const row of rows) {
    const d = new Date(row.createdAt);
    const valid = !Number.isNaN(d.getTime());
    const key = valid ? localDayKey(d) : 'earlier';
    let section = byKey.get(key);
    if (!section) {
      const title = !valid
        ? 'Earlier'
        : key === today
          ? 'Today'
          : key === yesterday
            ? 'Yesterday'
            : formatDate(d);
      section = { key, title, data: [] };
      byKey.set(key, section);
      sections.push(section);
    }
    section.data.push(row);
  }
  return sections;
}
