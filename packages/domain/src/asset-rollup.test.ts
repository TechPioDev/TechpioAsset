import { describe, expect, it } from 'vitest';
import { ASSET_STATUSES } from './asset-status';
import {
  ASSET_ROLLUP_BUCKETS,
  ASSET_ROLLUP_LABELS,
  assetRollup,
  emptyAssetRollup,
} from './asset-rollup';

describe('what became of the units bought from a listing', () => {
  it('puts every asset status in exactly one bucket', () => {
    // A status added later must not silently vanish from every rollup in the
    // product. Each one is counted once and the total agrees.
    const counts = ASSET_STATUSES.map((status) => ({ status, count: 1 }));
    const rolled = assetRollup(counts);
    expect(rolled.total).toBe(ASSET_STATUSES.length);

    const inBuckets = ASSET_ROLLUP_BUCKETS.reduce((sum, b) => sum + rolled[b], 0);
    expect(inBuckets).toBe(ASSET_STATUSES.length);
  });

  it('reads a real fleet the way a buyer would', () => {
    const rolled = assetRollup([
      { status: 'IN_USE', count: 8 },
      { status: 'ASSIGNED', count: 2 },
      { status: 'AVAILABLE', count: 3 },
      { status: 'DAMAGED', count: 1 },
      { status: 'UNDER_REPAIR', count: 1 },
      { status: 'RETIRED', count: 4 },
      { status: 'ORDERED', count: 5 },
    ]);
    expect(rolled).toEqual({
      onTheWay: 5,
      available: 3,
      inService: 10,
      needsAttention: 2,
      gone: 4,
      total: 24,
    });
  });

  it('counts a lost unit as needing attention, not as gone', () => {
    // Retired is a decision; lost is a problem, and burying it among the
    // disposals is how it stops being one.
    expect(assetRollup([{ status: 'LOST', count: 1 }]).needsAttention).toBe(1);
    expect(assetRollup([{ status: 'LOST', count: 1 }]).gone).toBe(0);
  });

  it('has a shape even with nothing in it', () => {
    expect(assetRollup([])).toEqual(emptyAssetRollup());
    expect(emptyAssetRollup().total).toBe(0);
  });

  it('names every bucket it offers', () => {
    for (const bucket of ASSET_ROLLUP_BUCKETS) {
      expect(ASSET_ROLLUP_LABELS[bucket], bucket).toBeTruthy();
    }
  });
});
