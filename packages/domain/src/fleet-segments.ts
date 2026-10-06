import { type FleetBreakdown } from './fleet-breakdown';

/**
 * Which fleet groups the dashboard shows (v3.8).
 *
 * This exists because of a bug that is worth describing exactly, since it is
 * the same bug this dashboard keeps growing back.
 *
 * The owner's mock drew five cards in a row, so the page rendered
 * `segments.slice(0, 5)`. The groups are an exhaustive partition of every
 * status, and they were ORDERED by how interesting they are - assigned,
 * available, in stock, on order, under repair, then critical, retired, other.
 * Taking the first five therefore dropped the last three. On a fleet of 169
 * that was invisible, because almost nothing was retired. On 6,828 it read:
 *
 *     6,828 assets                     <- the headline
 *     1,242 + 2,924 + 137 + 2 + 195    <- the cards, summing to 4,500
 *
 * 2,328 assets simply not on screen, under a number that counted them. That
 * is the defect the whole dashboard rewrite started from - a breakdown summing
 * to the page size beside a total from the server - reintroduced by a layout
 * decision.
 *
 * So the rule is not "the first five". It is "every group that has anything in
 * it", which cannot truncate: because the groups partition the fleet, the
 * counts returned here always sum to the total. A group with nothing in it is
 * dropped as noise - an empty card says nothing and removing it cannot hide
 * anything, since zero is what it would have added.
 */

export type FleetSegmentKey =
  | 'assigned'
  | 'available'
  | 'inStock'
  | 'onOrder'
  | 'underRepair'
  | 'critical'
  | 'retired'
  | 'other';

/** Most actionable first; the tail is still shown, just last. */
export const FLEET_SEGMENT_ORDER: readonly FleetSegmentKey[] = [
  'assigned',
  'available',
  'inStock',
  'onOrder',
  'underRepair',
  'critical',
  'retired',
  'other',
] as const;

export interface FleetSegment {
  key: FleetSegmentKey;
  count: number;
}

export function fleetSegments(breakdown: FleetBreakdown): FleetSegment[] {
  return FLEET_SEGMENT_ORDER.map((key) => ({ key, count: breakdown[key] })).filter(
    (s) => s.count > 0,
  );
}

/**
 * What the cards add up to. The page has no business computing this itself:
 * the point of the helper is that this always equals `breakdown.total`, and a
 * caller that wants to check should be able to ask.
 */
export function fleetSegmentsTotal(segments: FleetSegment[]): number {
  return segments.reduce((sum, s) => sum + s.count, 0);
}
