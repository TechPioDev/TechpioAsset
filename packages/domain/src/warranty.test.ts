import { describe, it, expect } from 'vitest';
import {
  warrantyBucket,
  warrantyBreakdown,
  isWarrantyAlertable,
  warrantyDaysRemaining,
  repairRecommendation,
  isRepeatFailure,
} from './warranty';

const asOf = new Date('2026-07-01T00:00:00Z');
const inDays = (n: number) => new Date(asOf.getTime() + n * 86_400_000);

describe('warrantyBucket (spec section 14: 30/60/90 windows)', () => {
  it('classifies each window', () => {
    expect(warrantyBucket(inDays(-1), asOf)).toBe('EXPIRED');
    expect(warrantyBucket(inDays(20), asOf)).toBe('WITHIN_30');
    expect(warrantyBucket(inDays(45), asOf)).toBe('WITHIN_60');
    expect(warrantyBucket(inDays(80), asOf)).toBe('WITHIN_90');
    expect(warrantyBucket(inDays(200), asOf)).toBe('BEYOND_90');
    expect(warrantyBucket(null, asOf)).toBe('NONE');
  });

  it('puts the boundary days in the inclusive bucket', () => {
    expect(warrantyBucket(inDays(30), asOf)).toBe('WITHIN_30');
    expect(warrantyBucket(inDays(60), asOf)).toBe('WITHIN_60');
    expect(warrantyBucket(inDays(90), asOf)).toBe('WITHIN_90');
  });

  it('marks only the 30/60/90 buckets alertable', () => {
    expect(isWarrantyAlertable('WITHIN_30')).toBe(true);
    expect(isWarrantyAlertable('WITHIN_90')).toBe(true);
    expect(isWarrantyAlertable('EXPIRED')).toBe(false);
    expect(isWarrantyAlertable('BEYOND_90')).toBe(false);
    expect(isWarrantyAlertable('NONE')).toBe(false);
  });
});

describe('warrantyDaysRemaining', () => {
  it('is positive before, negative after, null when none', () => {
    expect(warrantyDaysRemaining(inDays(10), asOf)).toBe(10);
    expect(warrantyDaysRemaining(inDays(-5), asOf)).toBe(-5);
    expect(warrantyDaysRemaining(null, asOf)).toBeNull();
  });
});

describe('repairRecommendation (spec section 14)', () => {
  it('advises replacing when repair is well above the threshold', () => {
    const r = repairRecommendation({ repairCost: '800', replacementCost: '1000' });
    expect(r.recommendation).toBe('REPLACE');
    expect(r.ratio).toBe('0.8');
  });

  it('advises repairing when repair is well below the threshold', () => {
    const r = repairRecommendation({ repairCost: '200', replacementCost: '1000' });
    expect(r.recommendation).toBe('REPAIR');
  });

  it('is marginal in the band around the threshold', () => {
    const r = repairRecommendation({ repairCost: '500', replacementCost: '1000' });
    expect(r.recommendation).toBe('MARGINAL');
  });

  it('honours a custom threshold', () => {
    const r = repairRecommendation({ repairCost: '400', replacementCost: '1000', threshold: 0.3 });
    expect(r.recommendation).toBe('REPLACE');
  });

  it('defaults to repair when replacement cost is unknown', () => {
    expect(repairRecommendation({ repairCost: '500', replacementCost: '0' }).recommendation).toBe(
      'REPAIR',
    );
  });
});

describe('isRepeatFailure (spec section 14)', () => {
  it('flags two or more completed repairs by default', () => {
    expect(isRepeatFailure({ completedRepairCount: 2 })).toBe(true);
    expect(isRepeatFailure({ completedRepairCount: 1 })).toBe(false);
  });

  it('honours a custom threshold', () => {
    expect(isRepeatFailure({ completedRepairCount: 3, threshold: 4 })).toBe(false);
  });
});

describe('warrantyBreakdown accounts for every asset (v3.2)', () => {
  const NOW = new Date('2026-10-05T12:00:00Z');
  const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

  it('counts an expired warranty instead of dropping it', () => {
    // The dashboard did `if (days < 0) continue`, so a lapsed warranty was
    // counted nowhere - the one state the timeline could not show.
    const b = warrantyBreakdown([inDays(-5)], 1, NOW);
    expect(b.EXPIRED).toBe(1);
  });

  it('sums to the fleet when most assets have no warranty', () => {
    // 171 assets, 4 dated. The 167 without must still be somewhere.
    const b = warrantyBreakdown([inDays(-5), inDays(10), inDays(45), inDays(200)], 171, NOW);
    const summed = b.EXPIRED + b.WITHIN_30 + b.WITHIN_60 + b.WITHIN_90 + b.BEYOND_90 + b.NONE;
    expect(summed).toBe(171);
    expect(b.NONE).toBe(167);
    expect(b.BEYOND_90).toBe(1);
  });

  it('sums to the fleet when every asset has one', () => {
    const b = warrantyBreakdown([inDays(-1), inDays(5), inDays(70)], 3, NOW);
    expect(b.EXPIRED + b.WITHIN_30 + b.WITHIN_60 + b.WITHIN_90 + b.BEYOND_90 + b.NONE).toBe(3);
  });

  it('puts a whole fleet with no warranties in NONE', () => {
    expect(warrantyBreakdown([], 171, NOW).NONE).toBe(171);
  });

  it('is empty for an empty fleet', () => {
    const b = warrantyBreakdown([], 0, NOW);
    expect(b.total).toBe(0);
    expect(b.NONE).toBe(0);
  });

  it('does not lose assets to a stale total', () => {
    const b = warrantyBreakdown([inDays(1), inDays(2), inDays(3)], 1, NOW);
    expect(b.EXPIRED + b.WITHIN_30 + b.WITHIN_60 + b.WITHIN_90 + b.BEYOND_90 + b.NONE).toBe(b.total);
    expect(b.total).toBe(3);
  });
});
