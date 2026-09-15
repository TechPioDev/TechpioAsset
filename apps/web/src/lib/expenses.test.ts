import { describe, expect, it } from 'vitest';
import { EXPENSE_PERIOD_PRESETS } from '@techpioasset/domain';
import {
  EXPENSE_SEGMENTS,
  customRangeReady,
  describeChange,
  expenseLevelFill,
  expenseLineHref,
  expenseQueryString,
  filenameFromDisposition,
  formatMoneyShort,
  topWithOther,
} from './expenses';

describe('expense page helpers', () => {
  it('offers a segment for every preset the API accepts, in order', () => {
    expect(EXPENSE_SEGMENTS.map((s) => s.preset)).toEqual([...EXPENSE_PERIOD_PRESETS]);
  });

  it('builds the query, with dates only for a custom range', () => {
    expect(expenseQueryString({ preset: 'LAST_90_DAYS', from: '2026-01-01' })).toBe(
      'preset=LAST_90_DAYS',
    );
    expect(
      expenseQueryString(
        { preset: 'CUSTOM', from: '2026-01-01', to: '2026-03-31', officeId: 'o1', categoryId: 'c1' },
        'pdf',
      ),
    ).toBe('format=pdf&preset=CUSTOM&from=2026-01-01&to=2026-03-31&officeId=o1&categoryId=c1');
  });

  it('waits for a complete, ordered custom range', () => {
    expect(customRangeReady('', '2026-01-01')).toBe(false);
    expect(customRangeReady('2026-02-01', '2026-01-01')).toBe(false);
    expect(customRangeReady('2026-01-01', '2026-01-01')).toBe(true);
  });

  it('abbreviates axis money the Indian way for rupees', () => {
    expect(formatMoneyShort('0.00', 'INR')).toBe('₹0');
    expect(formatMoneyShort('12500', 'INR')).toBe('₹12.5K');
    expect(formatMoneyShort('1470000.00', 'INR')).toBe('₹14.7L');
    expect(formatMoneyShort('99999', 'INR')).toBe('₹99.9K');
    expect(formatMoneyShort(12000000, 'INR')).toBe('₹1.2Cr');
    expect(formatMoneyShort('1250000', 'USD')).toBe('USD 1.2M');
  });

  it('words change as more / less', () => {
    expect(describeChange(12.5)).toEqual({ text: '12.5% more than the previous period', direction: 'up' });
    expect(describeChange(-3)).toEqual({ text: '3% less than the previous period', direction: 'down' });
    expect(describeChange(null).direction).toBe('none');
  });

  it('draws levels in status tones and draws nothing for no spend', () => {
    expect(expenseLevelFill('HIGH')).toBe('var(--tone-critical-solid)');
    expect(expenseLevelFill('NORMAL')).toBe('var(--tone-info-solid)');
    expect(expenseLevelFill('LOW')).toBe('var(--tone-neutral-solid)');
    expect(expenseLevelFill('NONE')).toBe('transparent');
  });

  it('links lines to their record, except a licence renewal', () => {
    const base = { id: 'x1', assetId: null, title: 'Thing' };
    expect(expenseLineHref({ ...base, source: 'ASSET', assetId: 'a1' })).toBe('/assets/a1');
    expect(expenseLineHref({ ...base, source: 'MAINTENANCE', assetId: 'a1' })).toBe('/maintenance/x1');
    expect(expenseLineHref({ ...base, source: 'LICENCE' })).toBe('/licenses/x1');
    expect(expenseLineHref({ ...base, source: 'LICENCE', title: 'Adobe (renewal)' })).toBeNull();
  });

  it('folds the tail into one Other row', () => {
    const rows = [
      { name: 'A', total: '300.00', count: 3, sharePct: 50 },
      { name: 'B', total: '200.00', count: 2, sharePct: 33.3 },
      { name: 'C', total: '60.00', count: 1, sharePct: 10 },
      { name: 'D', total: '40.00', count: 1, sharePct: 6.7 },
    ];
    expect(topWithOther(rows, 2)).toEqual([
      { name: 'A', value: 300, total: '300.00', count: 3, sharePct: 50 },
      { name: 'B', value: 200, total: '200.00', count: 2, sharePct: 33.3 },
      { name: 'Other (2)', value: 100, total: null, count: 2, sharePct: 16.7 },
    ]);
    expect(topWithOther(rows.slice(0, 1), 10)).toHaveLength(1);
  });

  it('reads the server filename', () => {
    expect(filenameFromDisposition('attachment; filename="expenses-2026-09-15.pdf"')).toBe(
      'expenses-2026-09-15.pdf',
    );
    expect(filenameFromDisposition(null)).toBeNull();
  });
});
