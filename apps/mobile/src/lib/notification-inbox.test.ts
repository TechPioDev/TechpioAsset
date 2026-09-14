import { describe, expect, it } from 'vitest';
import {
  badgeLabel,
  groupByDay,
  markAllReadLocally,
  markReadLocally,
  unreadCount,
  UNREAD_POLL_MS,
  type NotificationRow,
} from './notification-inbox';

const row = (id: string, createdAt: string, readAt: string | null = null): NotificationRow => ({
  id,
  type: 'REQUEST_APPROVED',
  title: `Title ${id}`,
  body: 'Body',
  linkPath: null,
  readAt,
  simulated: false,
  createdAt,
});

describe('notification badge', () => {
  it('shows nothing for zero, the number up to nine, then 9+ like the web bell', () => {
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(-1)).toBeNull();
    expect(badgeLabel(Number.NaN)).toBeNull();
    expect(badgeLabel(1)).toBe('1');
    expect(badgeLabel(9)).toBe('9');
    expect(badgeLabel(10)).toBe('9+');
  });

  it('never polls faster than the web (60s)', () => {
    expect(UNREAD_POLL_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe('marking read locally', () => {
  const rows = [row('a', '2026-09-14T10:00:00'), row('b', '2026-09-14T09:00:00', '2026-09-14T09:30:00')];

  it('marks only the tapped unread row and keeps an earlier read time', () => {
    const next = markReadLocally(rows, 'a', 'NOW');
    expect(next[0]!.readAt).toBe('NOW');
    expect(markReadLocally(rows, 'b', 'NOW')[1]!.readAt).toBe('2026-09-14T09:30:00');
    expect(rows[0]!.readAt).toBeNull(); // input untouched
    expect(unreadCount(next)).toBe(0);
  });

  it('mark all read clears the unread count', () => {
    expect(unreadCount(rows)).toBe(1);
    expect(unreadCount(markAllReadLocally(rows, 'NOW'))).toBe(0);
  });
});

describe('grouping by day', () => {
  const now = new Date(2026, 8, 14, 12, 0, 0); // 14 Sep 2026, local time
  const iso = (d: Date) => d.toISOString();

  it('labels today, yesterday and older dates, keeping newest-first order', () => {
    const sections = groupByDay(
      [
        row('t1', iso(new Date(2026, 8, 14, 11, 0))),
        row('t2', iso(new Date(2026, 8, 14, 0, 5))),
        row('y1', iso(new Date(2026, 8, 13, 23, 59))),
        row('o1', iso(new Date(2026, 8, 1, 8, 0))),
      ],
      now,
      () => 'OLD',
    );
    expect(sections.map((s) => s.title)).toEqual(['Today', 'Yesterday', 'OLD']);
    expect(sections[0]!.data.map((r) => r.id)).toEqual(['t1', 't2']);
  });

  it('handles yesterday across a month boundary', () => {
    const first = new Date(2026, 9, 1, 9, 0);
    const sections = groupByDay([row('y', iso(new Date(2026, 8, 30, 22, 0)))], first, () => 'OLD');
    expect(sections[0]!.title).toBe('Yesterday');
  });

  it('keeps a row with a broken date instead of dropping it', () => {
    const sections = groupByDay([row('x', 'not a date')], now);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.title).toBe('Earlier');
  });

  it('returns no sections for an empty inbox', () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});
