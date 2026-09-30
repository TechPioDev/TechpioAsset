import { ASSET_STATUSES, type AssetStatus } from './asset-status';

/**
 * Splitting a fleet into the handful of groups a dashboard can show (v2.92).
 *
 * The dashboard reported 169 assets and a breakdown adding up to 100. Two
 * separate faults produced that, and both are the same mistake wearing
 * different clothes - a number derived from a subset, presented as a number
 * about the whole:
 *
 *   1. The counts were computed by filtering the page of rows already fetched.
 *      With pageSize=100 the breakdown counted the page, not the fleet, while
 *      the headline total came from the server. 6 + 92 + 1 + 1 = 100 exactly.
 *
 *   2. The groups covered nine of the eighteen statuses. Even counted
 *      correctly, an asset that is IN_STORAGE or ON ORDER belonged to no group
 *      and simply did not appear.
 *
 * So the groups here are a PARTITION: every status belongs to exactly one, and
 * `assetStatusGroups` is tested to prove it. Anything left over - a status
 * added later, or a value the server sends that this build has never heard of
 * - lands in `other`, which is counted as the remainder rather than summed.
 * The bar can then be wrong about which group an asset is in, but it can never
 * be wrong about how many there are.
 */

export const ASSET_STATUS_GROUPS = {
  /** With a person. */
  assigned: ['ASSIGNED', 'IN_USE'],
  /** Ready to give out. */
  available: ['AVAILABLE'],
  /** Held by the company, not with anybody - in transit included, because
   *  "where is it" has the same answer for everyone who asks. */
  inStock: ['IN_STORAGE', 'RESERVED', 'RECEIVED', 'RETURNED', 'IN_TRANSIT'],
  /** Not here yet. */
  onOrder: ['DRAFT', 'REQUESTED', 'ORDERED'],
  /** Being fixed. */
  underRepair: ['UNDER_REPAIR'],
  /** Gone or broken - the set worth chasing. */
  critical: ['DAMAGED', 'LOST', 'STOLEN'],
  /** End of life. */
  retired: ['RETIRED', 'DISPOSED', 'DONATED'],
} as const satisfies Record<string, readonly AssetStatus[]>;

export type AssetStatusGroup = keyof typeof ASSET_STATUS_GROUPS;

export interface FleetBreakdown extends Record<AssetStatusGroup, number> {
  /** Everything the groups above did not claim. Should be 0. */
  other: number;
  /** What the server says the fleet is. Every group is a part of THIS. */
  total: number;
}

/**
 * @param byStatus counts per status, from the server - not from a page of rows.
 * @param total    the server's own total. Defaults to the sum of `byStatus`,
 *                 but pass it when you have it: if the two ever disagree, the
 *                 difference shows up in `other` instead of being hidden.
 */
export function fleetBreakdown(
  byStatus: Readonly<Record<string, number>>,
  total?: number,
): FleetBreakdown {
  const sumOf = (statuses: readonly AssetStatus[]) =>
    statuses.reduce((n, s) => n + (byStatus[s] ?? 0), 0);

  const groups = Object.fromEntries(
    Object.entries(ASSET_STATUS_GROUPS).map(([key, statuses]) => [key, sumOf(statuses)]),
  ) as Record<AssetStatusGroup, number>;

  const fleetTotal = total ?? Object.values(byStatus).reduce((n, c) => n + c, 0);
  const claimed = Object.values(groups).reduce((n, c) => n + c, 0);

  // The remainder, never a sum of its own: that is what makes the parts add up
  // to the whole no matter what arrives.
  return { ...groups, other: Math.max(0, fleetTotal - claimed), total: fleetTotal };
}

/** Every status this build knows, and which group it is in. */
export function assetStatusGroups(): Map<AssetStatus, AssetStatusGroup> {
  const m = new Map<AssetStatus, AssetStatusGroup>();
  for (const [key, statuses] of Object.entries(ASSET_STATUS_GROUPS))
    for (const s of statuses) m.set(s, key as AssetStatusGroup);
  return m;
}
