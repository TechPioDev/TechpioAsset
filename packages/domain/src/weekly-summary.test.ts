import { describe, expect, it } from 'vitest';
import {
  localWeekStart,
  safeTimeZone,
  weeklySummaryDue,
  weeklySummaryText,
} from './weekly-summary';

const IST = 'Asia/Kolkata';

describe('when the Monday summary is due', () => {
  it('is due from 09:00 on Monday in the company time zone, not UTC', () => {
    // Mon 28 Sep 2026 03:30 UTC = 09:00 IST
    expect(weeklySummaryDue(new Date('2026-09-28T03:30:00Z'), IST)).toBe(true);
    // 08:59 IST
    expect(weeklySummaryDue(new Date('2026-09-28T03:29:00Z'), IST)).toBe(false);
    // Mon 09:00 UTC is Mon 14:30 IST - still Monday
    expect(weeklySummaryDue(new Date('2026-09-28T09:00:00Z'), IST)).toBe(true);
    // Mon 20:00 UTC is Tue 01:30 IST - no longer Monday there
    expect(weeklySummaryDue(new Date('2026-09-28T20:00:00Z'), IST)).toBe(false);
    // Sunday 23:00 UTC is Monday 04:30 IST - Monday, but too early
    expect(weeklySummaryDue(new Date('2026-09-27T23:00:00Z'), IST)).toBe(false);
  });

  it('finds the start of the local week, half-hour offset included', () => {
    // Wed 30 Sep 2026 10:00 IST -> Mon 28 Sep 00:00 IST = Sun 27 Sep 18:30 UTC
    expect(localWeekStart(new Date('2026-09-30T04:30:00Z'), IST).toISOString()).toBe(
      '2026-09-27T18:30:00.000Z',
    );
    // On Monday itself, the same Monday
    expect(localWeekStart(new Date('2026-09-28T03:30:00Z'), IST).toISOString()).toBe(
      '2026-09-27T18:30:00.000Z',
    );
    // Sunday belongs to the week that began six days earlier
    expect(localWeekStart(new Date('2026-09-27T06:00:00Z'), 'UTC').toISOString()).toBe(
      '2026-09-21T00:00:00.000Z',
    );
  });

  it('reads an unknown zone as UTC instead of failing', () => {
    expect(safeTimeZone('Mars/Olympus')).toBe('UTC');
    expect(safeTimeZone(null)).toBe('UTC');
    expect(weeklySummaryDue(new Date('2026-09-28T09:00:00Z'), 'Mars/Olympus')).toBe(true);
  });
});

describe('what the Monday summary says', () => {
  const zero = {
    approvalsWaiting: 0,
    receiptsUnconfirmed: 0,
    returnsOverdue: 0,
    lowStock: 0,
    warrantiesExpiring: 0,
    laptopsWithoutAgent: 0,
    requestsRaised: 4,
    assetsHandedOut: 2,
  };

  it('puts only what needs doing on the phone, three at most', () => {
    const { pushBody } = weeklySummaryText({
      ...zero,
      approvalsWaiting: 1,
      receiptsUnconfirmed: 5,
      lowStock: 2,
      laptopsWithoutAgent: 13,
    });
    expect(pushBody).toBe(
      '1 approval waiting · 5 receipts unconfirmed · 2 items low on stock · +1 more',
    );
  });

  it('says so when nothing is waiting', () => {
    expect(weeklySummaryText(zero).pushBody).toBe('Nothing is waiting on anyone this week.');
  });

  it('keeps every figure in the email', () => {
    const { rows } = weeklySummaryText(zero);
    expect(rows).toHaveLength(8);
    expect(rows).toContainEqual(['Requests raised last week', '4']);
  });
});
