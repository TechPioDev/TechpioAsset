/**
 * Comparing today's fleet with an earlier snapshot (v3.6).
 *
 * The dashboard mock put "+12% vs last month" on every card. Nothing recorded
 * history, so that figure could only have been decoration — and a decoration
 * shaped like a fact is the thing this dashboard has spent a fortnight
 * shedding. Phase B records the counts nightly; this decides what may honestly
 * be said about them.
 *
 * Three rules, and each exists because the obvious implementation gets it
 * wrong:
 *
 *   NO BASELINE, NO TREND. Returning 0% when there is nothing to compare
 *   against states that the fleet did not change, which is a claim, not an
 *   absence. `null` is the honest answer and the caller renders nothing.
 *
 *   GROWTH FROM ZERO HAS NO PERCENTAGE. 0 → 5 is not "+500%" or "+∞"; it is
 *   five assets where there were none. The change in units is always reported;
 *   the percentage is omitted when its denominator is zero.
 *
 *   A STALE BASELINE IS NOT LAST MONTH. If the only snapshot is four days old,
 *   "vs last month" is false. The caller says how old a baseline may be and the
 *   comparison is refused outside it, rather than quietly comparing against
 *   whatever happened to be nearest.
 */

export interface FleetTrend {
  /** Today minus baseline, in assets. Negative when the fleet shrank. */
  change: number;
  /** Rounded percentage, or null when the baseline was zero. */
  changePercent: number | null;
  /** The day the baseline describes. */
  since: Date;
  /**
   * How long ago that was, in whole days.
   *
   * The caller's window is a RANGE - a baseline may be 20 days old or 45 - so
   * "vs last month" would be a rounding of up to a fortnight. Reporting the
   * real gap costs three words and stops the dashboard asserting a period it
   * did not measure.
   */
  ageDays: number;
  direction: 'up' | 'down' | 'flat';
}

export interface FleetTrendBaseline {
  takenOn: Date;
  total: number;
}

const DAY = 86_400_000;

/**
 * @param minAgeDays a baseline younger than this is refused: comparing today
 *   with yesterday and calling it a month is worse than saying nothing.
 * @param maxAgeDays and older than this is also refused, because "vs last
 *   month" against a snapshot from March is a different sentence.
 */
export function fleetTrend(
  currentTotal: number,
  baseline: FleetTrendBaseline | null | undefined,
  asOf: Date = new Date(),
  { minAgeDays = 20, maxAgeDays = 45 }: { minAgeDays?: number; maxAgeDays?: number } = {},
): FleetTrend | null {
  if (!baseline) return null;

  const ageDays = Math.floor((asOf.getTime() - baseline.takenOn.getTime()) / DAY);
  if (ageDays < minAgeDays || ageDays > maxAgeDays) return null;

  const change = currentTotal - baseline.total;

  return {
    change,
    // A percentage of nothing is not a large percentage, it is not a
    // percentage.
    changePercent: baseline.total === 0 ? null : Math.round((change / baseline.total) * 100),
    since: baseline.takenOn,
    ageDays,
    direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
  };
}
