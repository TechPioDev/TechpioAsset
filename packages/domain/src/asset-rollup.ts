import type { AssetStatus } from './asset-status.js';

/**
 * What became of the units bought from a listing (v2.53).
 *
 * Eighteen asset statuses is the right amount of detail on an asset and far too
 * much on a supplier's product page, where the question is only "how many did
 * we buy, and how are they doing". So they collapse into five buckets a buyer
 * can read at a glance.
 *
 * WHO SEES THIS. Internal staff only. A supplier already sees how many units it
 * supplied, which is its own sales history and its own to know; how many of
 * them are broken, idle or retired is the buying company's operational
 * position, and it is not the supplier's business how well its customer looks
 * after things.
 */

export const ASSET_ROLLUP_BUCKETS = [
  'onTheWay',
  'available',
  'inService',
  'needsAttention',
  'gone',
] as const;

export type AssetRollupBucket = (typeof ASSET_ROLLUP_BUCKETS)[number];

export const ASSET_ROLLUP_LABELS: Readonly<Record<AssetRollupBucket, string>> = {
  onTheWay: 'On the way',
  available: 'Ready to issue',
  inService: 'In service',
  needsAttention: 'Needs attention',
  gone: 'Retired or gone',
};

/**
 * Which bucket a status falls in.
 *
 * Exhaustive by construction: the map covers every AssetStatus, so a status
 * added later fails the type check here rather than silently vanishing from
 * every rollup in the product.
 */
const BUCKET_OF: Readonly<Record<AssetStatus, AssetRollupBucket>> = {
  // Bought, not yet in the building.
  DRAFT: 'onTheWay',
  REQUESTED: 'onTheWay',
  ORDERED: 'onTheWay',
  IN_TRANSIT: 'onTheWay',

  // Here and spare.
  RECEIVED: 'available',
  AVAILABLE: 'available',
  RESERVED: 'available',
  IN_STORAGE: 'available',

  // Here and doing its job.
  ASSIGNED: 'inService',
  IN_USE: 'inService',

  // Here and not working, or not here and should be.
  UNDER_REPAIR: 'needsAttention',
  DAMAGED: 'needsAttention',
  LOST: 'needsAttention',
  STOLEN: 'needsAttention',

  // Off the books.
  RETURNED: 'gone',
  RETIRED: 'gone',
  DISPOSED: 'gone',
  DONATED: 'gone',
};

export type AssetRollup = Record<AssetRollupBucket, number> & { total: number };

/** An empty rollup, so a listing with no units still has a shape to render. */
export function emptyAssetRollup(): AssetRollup {
  return { onTheWay: 0, available: 0, inService: 0, needsAttention: 0, gone: 0, total: 0 };
}

/**
 * Fold per-status counts into the five buckets.
 *
 * Takes counts rather than assets: the caller has already grouped in the
 * database, which is where counting belongs, and this stays a pure function
 * that can be tested without one.
 */
export function assetRollup(counts: readonly { status: AssetStatus; count: number }[]): AssetRollup {
  const rollup = emptyAssetRollup();
  for (const { status, count } of counts) {
    const bucket = BUCKET_OF[status];
    // A status with no bucket cannot happen while the map is exhaustive, but a
    // row read from a database that is ahead of this code can still arrive.
    if (!bucket) continue;
    rollup[bucket] += count;
    rollup.total += count;
  }
  return rollup;
}
