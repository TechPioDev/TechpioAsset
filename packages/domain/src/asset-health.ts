import type { AssetStatus } from './asset-status';
import type { AssetCondition } from './tracking';

/**
 * How healthy a piece of equipment is, out of five (v2.89).
 *
 * The asset page showed four badges that could contradict each other -
 * "Damaged", "In maintenance", "In repair" and "Condition: Good" all at once -
 * because each is a different field maintained at a different moment. Nobody
 * should have to hold four vocabularies in their head to answer "is this
 * laptop any good?".
 *
 * Two rules keep this honest:
 *
 * 1. It is DERIVED, never stored. Every input is a fact already recorded -
 *    the graded condition, the status, the requests raised against it. Close
 *    the fault and the score comes back up by itself; nobody maintains it.
 * 2. It always says WHY. A number on its own is a judgement nobody can argue
 *    with, which is the wrong thing to give someone deciding whether to hand
 *    a machine to a new starter. The reasons are the point; the stars are the
 *    summary.
 */

export const MAX_HEALTH = 5;

/** Request kinds that are a complaint about a specific asset. */
export type HealthComplaint = 'DAMAGE' | 'REPAIR' | 'UPGRADE' | 'REPLACEMENT';

export interface AssetHealthInput {
  /** The graded physical condition, as recorded at the last handover. */
  condition?: AssetCondition | null;
  status?: AssetStatus | null;
  /**
   * Open requests raised against this asset, by kind. Only open ones: a fault
   * that was fixed is history, and history must not hold the score down.
   */
  openComplaints?: Partial<Record<HealthComplaint, number>> | null;
}

export interface AssetHealth {
  /** 0 to 5. Whole stars: half a star implies a precision this does not have. */
  stars: number;
  /** What produced that number, worst first. Always at least one line. */
  reasons: string[];
  /** For the colour of the badge: green, amber or red. */
  tone: 'success' | 'warning' | 'danger';
}

/** The grade is where the score starts, before anything that has happened to it. */
const FROM_CONDITION: Record<AssetCondition, number> = {
  NEW: 5,
  GOOD: 4,
  FAIR: 3,
  POOR: 2,
  DAMAGED: 1,
  UNUSABLE: 0,
  END_OF_LIFE: 0,
};

/**
 * Statuses that end the question. A damaged or missing asset is not a
 * four-star machine with a note against it - it is not usable at all, which
 * is the whole reason anyone is looking at the score.
 */
const ZERO_STATUSES: Partial<Record<AssetStatus, string>> = {
  DAMAGED: 'Reported damaged',
  LOST: 'Reported lost',
  STOLEN: 'Reported stolen',
  DISPOSED: 'Disposed',
};

/** Being in the shop caps it: it may come back fine, but it is not fine now. */
const UNDER_REPAIR_CAP = 2;

/** What each kind of open complaint costs. */
const COMPLAINT_COST: Record<HealthComplaint, { cost: number; reason: (n: number) => string }> = {
  DAMAGE: { cost: 2, reason: (n) => (n === 1 ? 'An open damage report' : `${n} open damage reports`) },
  REPAIR: { cost: 2, reason: (n) => (n === 1 ? 'An open repair job' : `${n} open repair jobs`) },
  UPGRADE: {
    cost: 1,
    reason: (n) => (n === 1 ? 'Someone has asked for an upgrade' : `${n} open upgrade requests`),
  },
  REPLACEMENT: {
    cost: 1,
    reason: (n) =>
      n === 1 ? 'Someone has asked to replace it' : `${n} open replacement requests`,
  },
};

const ORDER: HealthComplaint[] = ['DAMAGE', 'REPAIR', 'REPLACEMENT', 'UPGRADE'];

export function assetHealth(input: AssetHealthInput): AssetHealth {
  const reasons: string[] = [];

  // A status that ends the question beats every grade. Someone has said this
  // machine is out of action, and that is more recent than any handover.
  const zeroed = input.status ? ZERO_STATUSES[input.status] : undefined;
  if (zeroed) {
    return { stars: 0, reasons: [`${zeroed} - not usable`], tone: 'danger' };
  }

  let stars = (input.condition ? FROM_CONDITION[input.condition] : 3) ?? 3;
  reasons.push(
    input.condition ? `Condition graded ${CONDITION_WORD[input.condition]}` : 'Condition not graded',
  );

  const counts = input.openComplaints ?? {};
  for (const kind of ORDER) {
    const n = counts[kind] ?? 0;
    if (n <= 0) continue;
    const rule = COMPLAINT_COST[kind];
    stars -= rule.cost * n;
    reasons.push(rule.reason(n));
  }

  if (input.status === 'UNDER_REPAIR' && stars > UNDER_REPAIR_CAP) {
    stars = UNDER_REPAIR_CAP;
    reasons.push('In for repair');
  } else if (input.status === 'UNDER_REPAIR') {
    reasons.push('In for repair');
  }

  stars = Math.max(0, Math.min(MAX_HEALTH, stars));

  // Worst first: the thing holding it down is what somebody needs to read.
  const ordered = reasons.length > 1 ? [...reasons.slice(1), reasons[0]!] : reasons;
  return { stars, reasons: ordered, tone: stars >= 4 ? 'success' : stars >= 2 ? 'warning' : 'danger' };
}

const CONDITION_WORD: Record<AssetCondition, string> = {
  NEW: 'New',
  GOOD: 'Good',
  FAIR: 'Fair',
  POOR: 'Poor',
  DAMAGED: 'Damaged',
  UNUSABLE: 'Unusable',
  END_OF_LIFE: 'End of life',
};

/**
 * One line a person can read instead of counting stars, for a list row or a
 * screen reader: "3 of 5 - an open upgrade request".
 */
export function assetHealthSummary(health: AssetHealth): string {
  return `${health.stars} of ${MAX_HEALTH} - ${health.reasons[0]?.toLowerCase() ?? 'no information'}`;
}
