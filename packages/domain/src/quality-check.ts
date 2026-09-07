/**
 * Quality check on receiving (v2.42).
 *
 * Receiving records that a box arrived. This records whether what was in it is
 * fit to use - and it is the step that lets a received asset become available,
 * which until now nothing did automatically.
 *
 * Deliberately additive: an uninspected asset stays RECEIVED exactly as before,
 * so nothing already running changes behaviour because this shipped.
 */

export type QualityOutcome = 'PASSED' | 'PARTIAL' | 'FAILED';

/**
 * What happens to the units that were turned down.
 *
 * Both map onto transitions the asset state machine already allows out of
 * RECEIVED, so no new status was invented for this.
 */
export type RejectDisposition = 'RETURN_TO_VENDOR' | 'HOLD_DAMAGED';

/** The asset status a rejected unit ends up in. */
export const DISPOSITION_STATUS: Record<RejectDisposition, 'RETIRED' | 'DAMAGED'> = {
  // Going back to the supplier: it is not part of the estate.
  RETURN_TO_VENDOR: 'RETIRED',
  // Kept, but faulty. Someone has to decide what to do with it.
  HOLD_DAMAGED: 'DAMAGED',
};

export interface QualityCheckInput {
  received: number;
  accepted: number;
  rejected: number;
  reason?: string | null | undefined;
  disposition?: RejectDisposition | null | undefined;
  /**
   * How many individual units the inspector named as failing.
   *
   * Only meaningful on an asset line, where the units are things somebody is
   * holding. Pass it and the count has to agree, because a count that
   * disagrees with the list condemns a different laptop from the cracked one.
   * Left undefined for stock, which has no units to name.
   */
  namedUnits?: number | null | undefined;
}

/**
 * Why this inspection cannot be recorded, or null if it can.
 *
 * The arithmetic is the point. Numbers that do not add up to what arrived mean
 * some units are simply unaccounted for, and an inspection that loses track of
 * stock is worse than no inspection - it looks authoritative.
 */
export function qualityCheckProblem(input: QualityCheckInput): string | null {
  const { received, accepted, rejected } = input;

  for (const [label, value] of [
    ['Received', received],
    ['Accepted', accepted],
    ['Rejected', rejected],
  ] as const) {
    if (!Number.isFinite(value)) return `${label} quantity must be a number`;
  }
  if (received <= 0) return 'There is nothing on this line to inspect';

  // Named before the generic checks below, because this is the mistake people
  // actually make and "accepted cannot be negative" tells an inspector holding
  // a box nothing about what to do next.
  if (rejected > received) {
    return `Cannot reject ${rejected} when only ${received} arrived`;
  }
  for (const [label, value] of [
    ['Received', received],
    ['Accepted', accepted],
    ['Rejected', rejected],
  ] as const) {
    if (value < 0) return `${label} quantity cannot be negative`;
  }

  // Compared in thousandths: receipt quantities carry three decimal places, and
  // comparing floats exactly would reject a legitimate 0.1 + 0.2.
  const round = (n: number) => Math.round(n * 1000);
  if (round(accepted) + round(rejected) !== round(received)) {
    return `Accepted and rejected must add up to the ${received} received, not ${accepted + rejected}`;
  }

  if (rejected > 0) {
    // A rejection nobody explained is one the vendor cannot be held to and the
    // next person cannot act on.
    if (!input.reason || input.reason.trim() === '') {
      return 'Say why the goods were turned down';
    }
    if (!input.disposition) {
      return 'Say what happens to the rejected units: returned to the vendor, or held as damaged';
    }
  }

  if (input.namedUnits !== undefined && input.namedUnits !== null && input.namedUnits !== rejected) {
    return `${rejected} rejected but ${input.namedUnits} unit(s) named`;
  }

  return null;
}

/** Passed, partly passed, or failed - derived from the counts, never stated. */
export function qualityOutcome(accepted: number, rejected: number): QualityOutcome {
  if (rejected <= 0) return 'PASSED';
  if (accepted <= 0) return 'FAILED';
  return 'PARTIAL';
}
