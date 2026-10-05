/**
 * Whether a fleet-growth line can be drawn honestly (v3.1).
 *
 * The dashboard drew one from whatever assets happened to carry a purchase
 * date. On a fleet of 171 with 3 dated, it showed a line rising to 2 under the
 * heading "Fleet growth" - a chart claiming the company owns two assets.
 *
 * A cumulative count understates the fleet by exactly the number of undated
 * assets, so unlike a noisy average it is not approximately right: the Y value
 * is simply wrong, and wrong by an amount the reader cannot see. "Zero dates"
 * was already handled; 3-of-171 was not, and that is the case that misleads,
 * because a drawn line looks like an answer.
 *
 * So the chart is drawn only when most of the fleet can be placed on it, and
 * otherwise the space says what is missing and how much. A refusal that names
 * the gap is more useful than a line that hides it - and the gap is
 * actionable: somebody can go and fill those dates in.
 */

export interface FleetGrowthReadiness {
  /** Whether a cumulative line would be close enough to the truth to draw. */
  ok: boolean;
  dated: number;
  total: number;
  /** Assets with no purchase date - the ones missing from the line. */
  undated: number;
  /** 0-100, rounded. */
  coveragePercent: number;
}

/**
 * @param minCoverage the share of the fleet that must carry a date. 0.8 by
 *   default: at that point the line is within a fifth of the truth, which is a
 *   trend worth reading. It is a judgement, not a law, so it is a parameter.
 */
export function fleetGrowthReadiness(
  dated: number,
  total: number,
  minCoverage = 0.8,
): FleetGrowthReadiness {
  const safeTotal = Math.max(0, total);
  const safeDated = Math.min(Math.max(0, dated), safeTotal);
  const coverage = safeTotal === 0 ? 0 : safeDated / safeTotal;

  return {
    // An empty fleet has nothing to chart, and dividing by it would read as
    // full coverage.
    ok: safeTotal > 0 && coverage >= minCoverage,
    dated: safeDated,
    total: safeTotal,
    undated: safeTotal - safeDated,
    coveragePercent: Math.round(coverage * 100),
  };
}

/** What to put in the space when the line cannot be drawn. */
export function fleetGrowthShortfall(r: FleetGrowthReadiness): {
  title: string;
  description: string;
} {
  if (r.total === 0) {
    return { title: 'No assets yet', description: 'Growth appears once you add some.' };
  }
  if (r.dated === 0) {
    return {
      title: 'No purchase dates',
      description: `None of your ${r.total.toLocaleString()} assets has a purchase date, so there is nothing to plot.`,
    };
  }
  return {
    title: 'Not enough purchase dates',
    description:
      `Only ${r.dated.toLocaleString()} of ${r.total.toLocaleString()} assets have one ` +
      `(${r.coveragePercent}%), so a growth line would show far fewer assets than you own. ` +
      `Add dates to the other ${r.undated.toLocaleString()} to see this.`,
  };
}
