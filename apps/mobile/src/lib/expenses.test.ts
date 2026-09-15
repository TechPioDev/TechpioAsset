import { describe, expect, it } from 'vitest';
import { EXPENSE_PERIOD_PRESETS } from '@techpioasset/domain';
import {
  EXPENSE_CHIPS,
  customRangeError,
  describeChange,
  expenseLineRoute,
  expenseQueryString,
  exportLinkBody,
  formatMoneyShort,
  scaleBars,
  shareWidth,
} from './expenses';

describe('formatMoneyShort', () => {
  it('abbreviates rupees in thousands, lakhs and crores', () => {
    expect(formatMoneyShort('0.00', 'INR')).toBe('₹0');
    expect(formatMoneyShort('950.40', 'INR')).toBe('₹950');
    expect(formatMoneyShort('12500.00', 'INR')).toBe('₹12.5K');
    expect(formatMoneyShort('1470000.00', 'INR')).toBe('₹14.7L');
    expect(formatMoneyShort('100000', 'INR')).toBe('₹1L');
    expect(formatMoneyShort('12000000', 'INR')).toBe('₹1.2Cr');
    expect(formatMoneyShort('-250000', 'inr')).toBe('-₹2.5L');
  });

  it('rounds down so a figure never reads as the next unit', () => {
    expect(formatMoneyShort('99999', 'INR')).toBe('₹99.9K');
    expect(formatMoneyShort('9999999', 'INR')).toBe('₹99.9L');
  });

  it('uses western units and the ISO code for other currencies', () => {
    expect(formatMoneyShort('1250000', 'USD')).toBe('USD 1.2M');
    expect(formatMoneyShort('2000000000', 'usd')).toBe('USD 2B');
    expect(formatMoneyShort('999', 'EUR')).toBe('EUR 999');
  });

  it('says so rather than printing NaN', () => {
    expect(formatMoneyShort('not money', 'INR')).toBe('—');
  });
});

describe('scaleBars', () => {
  it('fills the tallest bar and scales the rest', () => {
    expect(scaleBars(['100.00', '50.00', '25.00'], 120)).toEqual([120, 60, 30]);
  });

  it('draws nothing for an empty bucket and at least minPx for a tiny one', () => {
    expect(scaleBars(['1200000.00', '0.00', '500.00'], 100, 4)).toEqual([100, 0, 4]);
  });

  it('is all zero when nothing was spent', () => {
    expect(scaleBars(['0.00', '0.00'], 100)).toEqual([0, 0]);
    expect(scaleBars([], 100)).toEqual([]);
  });
});

describe('shareWidth', () => {
  it('clamps to a visible, bounded width', () => {
    expect(shareWidth(0)).toBe(0);
    expect(shareWidth(0.4)).toBe(2);
    expect(shareWidth(42.5)).toBe(42.5);
    expect(shareWidth(140)).toBe(100);
  });
});

describe('describeChange', () => {
  it('says more / less, never better / worse', () => {
    expect(describeChange(12.5, false)).toEqual({
      text: '12.5% more than the previous period',
      direction: 'up',
    });
    expect(describeChange(-8, false)).toEqual({
      text: '8% less than the previous period',
      direction: 'down',
    });
    expect(describeChange(0, false).direction).toBe('flat');
  });

  it('explains a missing comparison', () => {
    expect(describeChange(null, true).text).toBe('Nothing recorded in the previous period');
    expect(describeChange(null, true).direction).toBe('none');
  });
});

describe('queries', () => {
  it('offers a chip for every preset the API accepts', () => {
    expect(EXPENSE_CHIPS.map((c) => c.preset)).toEqual([...EXPENSE_PERIOD_PRESETS]);
  });

  it('sends dates only for a custom range, and filters only when chosen', () => {
    expect(expenseQueryString({ preset: 'LAST_30_DAYS', from: '2026-01-01', to: '2026-02-01' })).toBe(
      'preset=LAST_30_DAYS',
    );
    expect(
      expenseQueryString({
        preset: 'CUSTOM',
        from: ' 2026-01-01 ',
        to: '2026-03-31',
        officeId: 'off 1',
        categoryId: null,
      }),
    ).toBe('preset=CUSTOM&from=2026-01-01&to=2026-03-31&officeId=off%201');
    expect(exportLinkBody('pdf', { preset: 'THIS_YEAR', categoryId: 'cat1' })).toEqual({
      format: 'pdf',
      preset: 'THIS_YEAR',
      categoryId: 'cat1',
    });
    expect(exportLinkBody('xlsx', { preset: 'CUSTOM', from: '2026-01-01', to: '2026-01-31' })).toEqual({
      format: 'xlsx',
      preset: 'CUSTOM',
      from: '2026-01-01',
      to: '2026-01-31',
    });
  });

  it('checks a custom range before it is sent', () => {
    expect(customRangeError('', '2026-01-01')).toMatch(/both dates/);
    expect(customRangeError('2026-02-30', '2026-03-01')).toMatch(/start date/);
    expect(customRangeError('2026-03-01', '2026-13-01')).toMatch(/end date/);
    expect(customRangeError('2026-03-02', '2026-03-01')).toMatch(/on or after/);
    expect(customRangeError('2026-03-01', '2026-03-01')).toBeNull();
  });
});

describe('expenseLineRoute', () => {
  const base = { id: 'x1', assetId: null, title: 'Thing' };
  it('opens the asset, work order or licence', () => {
    expect(expenseLineRoute({ ...base, source: 'ASSET', assetId: 'a1' })).toBe('/asset/a1');
    expect(expenseLineRoute({ ...base, source: 'MAINTENANCE', assetId: 'a1' })).toBe('/work-order/x1');
    expect(expenseLineRoute({ ...base, source: 'LICENCE' })).toBe('/license/x1');
  });

  it('has nowhere to go for a licence renewal, whose id is not a licence', () => {
    expect(expenseLineRoute({ ...base, source: 'LICENCE', title: 'Office 365 (renewal)' })).toBeNull();
  });
});
