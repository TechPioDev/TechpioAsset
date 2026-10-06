import Decimal from 'decimal.js';
import { money } from './money';

/**
 * Warranty windows and repair-versus-replace guidance (spec section 14).
 *
 * Pure classification and comparison. The spec asks the dashboard to show
 * "warranties expiring in 30, 60, and 90 days" and "repair cost compared with
 * replacement cost"; both are decided here so the rules are testable and shared
 * between the API's alert sweep and the web dashboard.
 */

export const WARRANTY_BUCKETS = [
  'EXPIRED',
  'WITHIN_30',
  'WITHIN_60',
  'WITHIN_90',
  'BEYOND_90',
  'NONE',
] as const;
export type WarrantyBucket = (typeof WARRANTY_BUCKETS)[number];

const DAY = 86_400_000;

/** Buckets a warranty end date relative to `asOf`. */
export function warrantyBucket(
  warrantyEndDate: Date | null | undefined,
  asOf: Date,
): WarrantyBucket {
  if (!warrantyEndDate) return 'NONE';
  const remainingDays = Math.ceil((warrantyEndDate.getTime() - asOf.getTime()) / DAY);
  if (remainingDays < 0) return 'EXPIRED';
  if (remainingDays <= 30) return 'WITHIN_30';
  if (remainingDays <= 60) return 'WITHIN_60';
  if (remainingDays <= 90) return 'WITHIN_90';
  return 'BEYOND_90';
}

/** True when a warranty falls in one of the alertable windows (30/60/90). */
export function isWarrantyAlertable(bucket: WarrantyBucket): boolean {
  return bucket === 'WITHIN_30' || bucket === 'WITHIN_60' || bucket === 'WITHIN_90';
}

/** Days until a warranty ends; negative once expired, null when none. */
export function warrantyDaysRemaining(
  warrantyEndDate: Date | null | undefined,
  asOf: Date,
): number | null {
  if (!warrantyEndDate) return null;
  return Math.ceil((warrantyEndDate.getTime() - asOf.getTime()) / DAY);
}

export type RepairRecommendation = 'REPAIR' | 'REPLACE' | 'MARGINAL';

/**
 * Recommends repair vs replacement from cost.
 *
 * The classic rule: if a repair costs more than a threshold fraction of what a
 * replacement costs (or of the asset's current value), replacing is the better
 * spend. A band around the threshold is MARGINAL so the recommendation does not
 * flip on a rounding cent, and a human still decides — this is guidance, not an
 * automated write-off.
 */
export function repairRecommendation(input: {
  repairCost: string | number;
  replacementCost: string | number;
  /** Fraction of replacement cost above which replacing is advised. Default 0.5. */
  threshold?: number;
}): { recommendation: RepairRecommendation; ratio: string } {
  const repair = money(input.repairCost);
  const replacement = money(input.replacementCost);
  const threshold = new Decimal(input.threshold ?? 0.5);

  if (replacement.lessThanOrEqualTo(0)) {
    // Unknown replacement cost: cannot advise replacing, so default to repair.
    return { recommendation: 'REPAIR', ratio: '0' };
  }

  const ratio = repair.dividedBy(replacement);
  // A 10% band around the threshold is marginal.
  const band = threshold.times(0.1);

  let recommendation: RepairRecommendation;
  if (ratio.greaterThanOrEqualTo(threshold.plus(band))) recommendation = 'REPLACE';
  else if (ratio.lessThanOrEqualTo(threshold.minus(band))) recommendation = 'REPAIR';
  else recommendation = 'MARGINAL';

  return { recommendation, ratio: ratio.toDecimalPlaces(3).toString() };
}

/**
 * Flags an asset as a repeat-failure risk (spec section 14: "Repeat failures").
 * Two or more completed repairs inside a rolling window is the usual signal.
 */
export function isRepeatFailure(input: {
  completedRepairCount: number;
  windowMonths?: number;
  threshold?: number;
}): boolean {
  return input.completedRepairCount >= (input.threshold ?? 2);
}

/**
 * How many assets sit in each warranty bucket (v3.2).
 *
 * The dashboard counted these itself, over the fetched PAGE, and threw away
 * anything already expired - `days < 0` hit `continue`, so a warranty that
 * lapsed last month was counted nowhere. The four numbers under "Warranty
 * expiry timeline" therefore did not add up to the fleet, and the assets
 * missing from them were the ones most worth seeing.
 *
 * Counting here instead means the API and both apps share one definition of
 * where a boundary falls, and the total is guaranteed: every asset lands in
 * exactly one bucket, including the ones with no warranty recorded.
 *
 * @param ends warranty end dates for the assets that HAVE one.
 * @param total every asset in scope. The difference is assets with no warranty
 *   date, which is why the caller need not send a null for each of them.
 */
export function warrantyBreakdown(
  ends: readonly (Date | null | undefined)[],
  total: number,
  asOf: Date = new Date(),
): Record<WarrantyBucket, number> & { total: number } {
  const counts = {
    EXPIRED: 0,
    WITHIN_30: 0,
    WITHIN_60: 0,
    WITHIN_90: 0,
    BEYOND_90: 0,
    NONE: 0,
  } as Record<WarrantyBucket, number>;

  for (const end of ends) counts[warrantyBucket(end, asOf)] += 1;

  // Assets with no date never appear in `ends`; they are the remainder. Taking
  // it as a remainder rather than trusting the caller is what keeps the
  // buckets summing to the fleet instead of to however many dates arrived.
  const dated = Object.values(counts).reduce((n, c) => n + c, 0);
  counts.NONE += Math.max(0, total - dated);

  return { ...counts, total: Math.max(total, dated) };
}
