import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  calendarDateInZone,
  classifyExpenseBuckets,
  expenseBucketKey,
  expenseBuckets,
  expenseChangePct,
  expenseSharePct,
  ExpensePeriodError,
  formatMoneyText,
  groupDigitsIndian,
  previousExpensePeriod,
  resolveExpensePeriod,
  startOfCalendarDay,
} from './expenses.js';

const IST = 'Asia/Kolkata';

describe('calendar days in a zone', () => {
  it('starts an Indian day at 18:30 UTC the day before', () => {
    expect(startOfCalendarDay('2026-09-15', IST).toISOString()).toBe('2026-09-14T18:30:00.000Z');
    expect(startOfCalendarDay('2026-09-15', 'UTC').toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });

  it('reads 01:00 IST as that date even though it is still yesterday in UTC', () => {
    const instant = new Date('2026-09-14T19:30:00Z'); // 15 Sep 01:00 IST
    expect(calendarDateInZone(instant, IST)).toBe('2026-09-15');
    expect(calendarDateInZone(instant, 'UTC')).toBe('2026-09-14');
  });

  it('handles daylight saving: a New York day starts at 04:00 UTC in summer and 05:00 in winter', () => {
    expect(startOfCalendarDay('2026-07-01', 'America/New_York').toISOString()).toBe(
      '2026-07-01T04:00:00.000Z',
    );
    expect(startOfCalendarDay('2026-12-01', 'America/New_York').toISOString()).toBe(
      '2026-12-01T05:00:00.000Z',
    );
    // The spring-forward day itself (8 Mar 2026) still begins at local midnight.
    expect(startOfCalendarDay('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
  });

  it('adds days across month and leap-year boundaries', () => {
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addCalendarDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('resolving a period', () => {
  // 15 Sep 2026, 00:30 IST - still 14 Sep in UTC.
  const now = new Date('2026-09-14T19:00:00Z');

  it('TODAY is the company-zone date, not the server date', () => {
    const p = resolveExpensePeriod({ preset: 'TODAY' }, IST, now);
    expect(p.fromDate).toBe('2026-09-15');
    expect(p.toDate).toBe('2026-09-15');
    expect(p.from.toISOString()).toBe('2026-09-14T18:30:00.000Z');
    expect(p.to.toISOString()).toBe('2026-09-15T18:30:00.000Z');
    expect(p.days).toBe(1);
    expect(p.granularity).toBe('DAY');
    expect(p.rangeLabel).toBe('15 Sep 2026');

    const utc = resolveExpensePeriod({ preset: 'TODAY' }, 'UTC', now);
    expect(utc.fromDate).toBe('2026-09-14');
  });

  it('LAST_10_DAYS, LAST_30_DAYS and LAST_90_DAYS end today and include it', () => {
    const ten = resolveExpensePeriod({ preset: 'LAST_10_DAYS' }, IST, now);
    expect([ten.fromDate, ten.toDate, ten.days]).toEqual(['2026-09-06', '2026-09-15', 10]);

    const thirty = resolveExpensePeriod({ preset: 'LAST_30_DAYS' }, IST, now);
    expect([thirty.fromDate, thirty.days, thirty.granularity]).toEqual(['2026-08-17', 30, 'DAY']);
    expect(thirty.rangeLabel).toBe('17 Aug 2026 – 15 Sep 2026');

    const ninety = resolveExpensePeriod({ preset: 'LAST_90_DAYS' }, IST, now);
    expect([ninety.fromDate, ninety.days, ninety.granularity]).toEqual(['2026-06-18', 90, 'MONTH']);
  });

  it('month presets start on the 1st and cross the year boundary', () => {
    const six = resolveExpensePeriod({ preset: 'LAST_6_MONTHS' }, IST, now);
    expect([six.fromDate, six.toDate]).toEqual(['2026-04-01', '2026-09-15']);

    const twelve = resolveExpensePeriod({ preset: 'LAST_12_MONTHS' }, IST, now);
    expect(twelve.fromDate).toBe('2025-10-01');

    const feb = resolveExpensePeriod(
      { preset: 'LAST_6_MONTHS' },
      IST,
      new Date('2026-02-10T06:00:00Z'),
    );
    expect(feb.fromDate).toBe('2025-09-01');

    const year = resolveExpensePeriod({ preset: 'THIS_YEAR' }, IST, now);
    expect([year.fromDate, year.from.toISOString()]).toEqual([
      '2026-01-01',
      '2025-12-31T18:30:00.000Z',
    ]);
  });

  it('a 31-day custom range is daily and a 32-day one is monthly', () => {
    expect(
      resolveExpensePeriod({ preset: 'CUSTOM', from: '2026-01-01', to: '2026-01-31' }, IST, now)
        .granularity,
    ).toBe('DAY');
    expect(
      resolveExpensePeriod({ preset: 'CUSTOM', from: '2026-01-01', to: '2026-02-01' }, IST, now)
        .granularity,
    ).toBe('MONTH');
  });

  it('refuses a custom range that is missing, reversed, unreal or too long, and an unknown zone', () => {
    expect(() => resolveExpensePeriod({ preset: 'CUSTOM', from: '2026-01-01' }, IST, now)).toThrow(
      ExpensePeriodError,
    );
    expect(() =>
      resolveExpensePeriod({ preset: 'CUSTOM', from: '2026-02-01', to: '2026-01-01' }, IST, now),
    ).toThrow(/on or before/);
    expect(() =>
      resolveExpensePeriod({ preset: 'CUSTOM', from: '2026-02-30', to: '2026-03-01' }, IST, now),
    ).toThrow(/real calendar date/);
    expect(() =>
      resolveExpensePeriod({ preset: 'CUSTOM', from: '2020-01-01', to: '2026-01-01' }, IST, now),
    ).toThrow(/at most/);
    expect(() => resolveExpensePeriod({ preset: 'TODAY' }, 'Asia/Atlantis', now)).toThrow(
      /time zone/,
    );
  });
});

describe('the previous period', () => {
  const now = new Date('2026-09-15T06:00:00Z');

  it('is the same number of days ending the day before', () => {
    const p = resolveExpensePeriod({ preset: 'LAST_30_DAYS' }, IST, now);
    const prev = previousExpensePeriod(p);
    expect([prev.fromDate, prev.toDate, prev.days]).toEqual(['2026-07-18', '2026-08-16', 30]);
    expect(prev.to.getTime()).toBe(p.from.getTime());
  });

  it('for TODAY is yesterday, and for a month preset is equal in days', () => {
    const today = previousExpensePeriod(resolveExpensePeriod({ preset: 'TODAY' }, IST, now));
    expect([today.fromDate, today.toDate]).toEqual(['2026-09-14', '2026-09-14']);

    const year = resolveExpensePeriod({ preset: 'THIS_YEAR' }, IST, now);
    const prevYear = previousExpensePeriod(year);
    expect(prevYear.toDate).toBe('2025-12-31');
    expect(prevYear.days).toBe(year.days);
  });
});

describe('buckets', () => {
  it('daily buckets carry the date as key', () => {
    const p = resolveExpensePeriod(
      { preset: 'LAST_10_DAYS' },
      IST,
      new Date('2026-09-15T06:00:00Z'),
    );
    const b = expenseBuckets(p);
    expect(b).toHaveLength(10);
    expect(b[0]).toMatchObject({ key: '2026-09-06', label: '6 Sep', partial: false });
    expect(b[9]!.key).toBe('2026-09-15');
  });

  it('monthly buckets mark partial first and last months', () => {
    const p = resolveExpensePeriod(
      { preset: 'LAST_90_DAYS' },
      IST,
      new Date('2026-09-15T06:00:00Z'),
    );
    const b = expenseBuckets(p);
    expect(b.map((x) => x.key)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
    expect(b.map((x) => x.partial)).toEqual([true, false, false, true]);
    expect(b[0]).toMatchObject({ label: 'Jun 2026', fromDate: '2026-06-18', toDate: '2026-06-30' });
    expect(b[3]).toMatchObject({ fromDate: '2026-09-01', toDate: '2026-09-15' });
  });

  it('a December-to-February range walks the year boundary', () => {
    const p = resolveExpensePeriod(
      { preset: 'CUSTOM', from: '2025-12-01', to: '2026-02-28' },
      'UTC',
      new Date('2026-09-15T06:00:00Z'),
    );
    expect(expenseBuckets(p).map((x) => [x.key, x.partial])).toEqual([
      ['2025-12', false],
      ['2026-01', false],
      ['2026-02', false],
    ]);
  });

  it('an instant just after IST midnight on the 1st belongs to the new month', () => {
    const instant = new Date('2026-08-31T18:45:00Z'); // 1 Sep 00:15 IST
    expect(expenseBucketKey(instant, IST, 'MONTH')).toBe('2026-09');
    expect(expenseBucketKey(instant, 'UTC', 'MONTH')).toBe('2026-08');
  });
});

describe('high / normal / low', () => {
  it('compares each bucket with the median of the non-zero buckets', () => {
    // median of [100, 100, 125, 75, 200] is 100 → HIGH ≥ 125, LOW ≤ 75.
    expect(classifyExpenseBuckets(['100', '100', '125', '75', '200', '0'])).toEqual([
      'NORMAL',
      'NORMAL',
      'HIGH',
      'LOW',
      'HIGH',
      'NONE',
    ]);
  });

  it('puts values exactly on the thresholds on the documented side', () => {
    expect(classifyExpenseBuckets(['1000.00', '1250.00', '750.00'])).toEqual([
      'NORMAL',
      'HIGH',
      'LOW',
    ]);
    expect(classifyExpenseBuckets(['1000.00', '1249.99', '750.01'])).toEqual([
      'NORMAL',
      'NORMAL',
      'NORMAL',
    ]);
  });

  it('uses the mean of the middle two for an even count', () => {
    // non-zero sorted [10, 20, 30, 40] → median 25 → HIGH ≥ 31.25, LOW ≤ 18.75
    expect(classifyExpenseBuckets(['10', '20', '30', '40'])).toEqual([
      'LOW',
      'NORMAL',
      'NORMAL',
      'HIGH',
    ]);
  });

  it('does not let zero months drag the baseline down', () => {
    expect(classifyExpenseBuckets(['0', '0', '0', '100', '100', '100'])).toEqual([
      'NONE',
      'NONE',
      'NONE',
      'NORMAL',
      'NORMAL',
      'NORMAL',
    ]);
  });

  it('calls everything NORMAL with fewer than three spending buckets, and NONE with nothing', () => {
    expect(classifyExpenseBuckets(['0', '5000', '10'])).toEqual(['NONE', 'NORMAL', 'NORMAL']);
    expect(classifyExpenseBuckets(['0', '0'])).toEqual(['NONE', 'NONE']);
    expect(classifyExpenseBuckets([])).toEqual([]);
  });
});

describe('percentages', () => {
  it('change is exact to one decimal and null against nothing', () => {
    expect(expenseChangePct('150', '100')).toBe(50);
    expect(expenseChangePct('0', '100')).toBe(-100);
    expect(expenseChangePct('100', '300')).toBe(-66.7);
    expect(expenseChangePct('100', '0')).toBeNull();
  });

  it('share is 0 of a zero whole', () => {
    expect(expenseSharePct('1', '3')).toBe(33.3);
    expect(expenseSharePct('5', '0')).toBe(0);
  });
});

describe('money text', () => {
  it('groups rupees the Indian way', () => {
    expect(groupDigitsIndian('100000')).toBe('1,00,000');
    expect(formatMoneyText('100000', 'INR')).toBe('₹1,00,000.00');
    expect(formatMoneyText('1250000', 'INR')).toBe('₹12,50,000.00');
    expect(formatMoneyText('12500000.5', 'INR')).toBe('₹1,25,00,000.50');
    expect(formatMoneyText('999.999', 'INR')).toBe('₹1,000.00');
    expect(formatMoneyText('68000', 'inr')).toBe('₹68,000.00');
  });

  it('writes zero and negatives plainly', () => {
    expect(formatMoneyText('0', 'INR')).toBe('₹0.00');
    expect(formatMoneyText('-0.001', 'INR')).toBe('₹0.00');
    expect(formatMoneyText('-1000', 'INR')).toBe('-₹1,000.00');
  });

  it('keeps an exact decimal exact far beyond float precision', () => {
    expect(formatMoneyText('9999999999.99', 'INR')).toBe('₹9,99,99,99,999.99');
    expect(formatMoneyText('0.1', 'INR')).toBe('₹0.10');
  });

  it('other currencies keep their code and western grouping', () => {
    expect(formatMoneyText('1250000', 'USD')).toBe('USD 1,250,000.00');
    expect(formatMoneyText('-5.5', 'EUR')).toBe('-EUR 5.50');
  });

  it('lets a renderer without a ₹ glyph say INR instead', () => {
    expect(formatMoneyText('100000', 'INR', { rupee: 'INR ' })).toBe('INR 1,00,000.00');
  });
});
