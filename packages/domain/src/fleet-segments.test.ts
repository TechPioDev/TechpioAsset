import { describe, expect, it } from 'vitest';
import { fleetBreakdown } from './fleet-breakdown';
import { fleetSegments, fleetSegmentsTotal, FLEET_SEGMENT_ORDER } from './fleet-segments';
import { ASSET_STATUSES } from './asset-status';

/**
 * The guard against the bug in fleet-segments.ts: five cards shown under a
 * total that counted eight groups.
 */

const breakdownOf = (counts: Record<string, number>) =>
  fleetBreakdown(
    counts,
    Object.values(counts).reduce((a, b) => a + b, 0),
  );

describe('which groups the dashboard shows', () => {
  it('shows every group that has anything in it', () => {
    const b = breakdownOf({
      ASSIGNED: 1_242,
      AVAILABLE: 2_924,
      IN_STORAGE: 137,
      ORDERED: 2,
      UNDER_REPAIR: 195,
      LOST: 40,
      RETIRED: 2_288,
    });
    expect(fleetSegments(b).map((s) => s.key)).toEqual([
      'assigned',
      'available',
      'inStock',
      'onOrder',
      'underRepair',
      'critical',
      'retired',
    ]);
  });

  it('the cards always add up to the headline', () => {
    // The exact shape that shipped broken: the first five groups are the big
    // ones, so a truncating renderer looks right until something is retired.
    const b = breakdownOf({
      ASSIGNED: 1_242,
      AVAILABLE: 2_924,
      IN_STORAGE: 137,
      ORDERED: 2,
      UNDER_REPAIR: 195,
      LOST: 40,
      RETIRED: 2_288,
    });
    expect(b.total).toBe(6_828);
    expect(fleetSegmentsTotal(fleetSegments(b))).toBe(b.total);

    // And the truncation this replaced would NOT have. If this ever passes,
    // the rule has quietly gone back to showing a fixed number of cards.
    expect(fleetSegmentsTotal(fleetSegments(b).slice(0, 5))).not.toBe(b.total);
  });

  it('adds up for every single status on its own', () => {
    // Walks the real status list rather than a sample: a status added later
    // that no group claims would leave a card missing under a total that
    // counted it.
    for (const status of ASSET_STATUSES) {
      const b = breakdownOf({ [status]: 7 });
      expect(fleetSegmentsTotal(fleetSegments(b)), `${status} is not on any card`).toBe(7);
    }
  });

  it('drops empty groups, which cannot hide anything', () => {
    const b = breakdownOf({ ASSIGNED: 5 });
    expect(fleetSegments(b)).toEqual([{ key: 'assigned', count: 5 }]);
    expect(fleetSegmentsTotal(fleetSegments(b))).toBe(b.total);
  });

  it('an empty fleet shows no cards and still adds up', () => {
    const b = breakdownOf({});
    expect(fleetSegments(b)).toEqual([]);
    expect(fleetSegmentsTotal(fleetSegments(b))).toBe(0);
  });

  it('covers every group the breakdown defines', () => {
    // If a group is added to fleetBreakdown and not to the order, it would
    // never be rendered - silently, and only on fleets that have one.
    const b = breakdownOf({ ASSIGNED: 1 });
    const groupKeys = Object.keys(b).filter((k) => k !== 'total');
    expect([...FLEET_SEGMENT_ORDER].sort()).toEqual(groupKeys.sort());
  });
});
