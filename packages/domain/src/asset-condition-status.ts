import type { AssetStatus } from './asset-status';
import type { AssetCondition } from './tracking';

/**
 * Keeping the grade and the status from contradicting each other (v2.90).
 *
 * An asset carries a graded condition ("Good") and a status ("Damaged"), set
 * at different moments by different people, and nothing stopped them from
 * disagreeing. The edit form has both as plain dropdowns, so it was possible
 * to save "Damaged / Good" in one action and then wonder which one to believe.
 *
 * The two are not symmetrical, and that asymmetry is the whole rule:
 *
 *   "Damaged" CONSTRAINS. A damaged thing cannot be in service, so grading
 *   one damaged settles its status, and reporting one damaged settles its
 *   grade. Both directions are safe to do automatically.
 *
 *   "Good" PERMITS but does not DETERMINE. A machine in good condition might
 *   be available, assigned, in storage, retired or lost - the grade does not
 *   say which. So grading a damaged asset Good cannot silently choose a status
 *   for it, and it must not: quietly moving a reported-broken laptop back into
 *   the available pool because somebody corrected a dropdown is how a fault
 *   disappears without being fixed.
 *
 * So one direction resolves itself and the other is refused with an
 * explanation, rather than guessed at.
 */

/** Grades that say the thing does not work. */
const BROKEN_GRADES: readonly AssetCondition[] = ['DAMAGED', 'UNUSABLE'];

/** Grades that claim it is serviceable. */
const HEALTHY_GRADES: readonly AssetCondition[] = ['NEW', 'GOOD', 'FAIR'];

/**
 * Statuses that claim the asset is fine and in circulation. Only these are
 * overridden by a broken grade - an asset already retired, lost or in the
 * repair shop keeps the status it has, because those say something a grade
 * does not.
 */
const IN_CIRCULATION: readonly AssetStatus[] = [
  'AVAILABLE',
  'RESERVED',
  'ASSIGNED',
  'IN_USE',
  'IN_STORAGE',
  'RECEIVED',
  'RETURNED',
];

export interface ConditionStatusChange {
  /** What the record holds now. */
  status: AssetStatus;
  condition: AssetCondition;
  /** What this edit is asking for; leave undefined for "unchanged". */
  nextStatus?: AssetStatus | null;
  nextCondition?: AssetCondition | null;
}

export type ConditionStatusOutcome =
  | {
      ok: true;
      /** Applied on top of the edit; undefined where nothing extra is needed. */
      status?: AssetStatus;
      condition?: AssetCondition;
      /** Plain words for the audit record and for telling the person. */
      note?: string;
    }
  | { ok: false; reason: string };

export function reconcileConditionAndStatus(
  change: ConditionStatusChange,
): ConditionStatusOutcome {
  const status = change.nextStatus ?? change.status;
  const condition = change.nextCondition ?? change.condition;

  const statusChanged = change.nextStatus != null && change.nextStatus !== change.status;
  const conditionChanged = change.nextCondition != null && change.nextCondition !== change.condition;

  /**
   * The refusal comes FIRST, and the order matters.
   *
   * Someone is grading a damaged asset as serviceable again without saying
   * where it should go. "Good" does not name a status, and picking one here
   * would put a machine somebody reported broken back into the pool as a side
   * effect of a dropdown. Checked before the rules below because otherwise
   * the first of them quietly writes the grade straight back to Damaged -
   * the edit would appear to save and change nothing, which is worse than
   * either answer.
   */
  if (
    conditionChanged &&
    !statusChanged &&
    HEALTHY_GRADES.includes(condition) &&
    status === 'DAMAGED'
  ) {
    return {
      ok: false,
      reason:
        'This asset is marked Damaged. Change the status as well - use Record return, or set the status to Under repair or Available - so the condition and the status agree.',
    };
  }

  // Reporting it damaged grades it damaged. Only from a grade that is now
  // obviously wrong: an asset already graded Unusable is not talked UP.
  if (statusChanged && status === 'DAMAGED' && HEALTHY_GRADES.includes(condition)) {
    return {
      ok: true,
      condition: 'DAMAGED',
      note: `Condition set to Damaged to match the status (was ${condition}).`,
    };
  }

  // Grading it broken takes it out of service - but only if it was claiming
  // to be in service. Something already retired or lost stays as it is.
  if (conditionChanged && BROKEN_GRADES.includes(condition) && IN_CIRCULATION.includes(status)) {
    return {
      ok: true,
      status: 'DAMAGED',
      note: `Status set to Damaged to match the condition (was ${status}).`,
    };
  }

  /**
   * An edit that touches neither, on a record that already contradicts itself
   * - a row written before this rule existed. Healed rather than refused: the
   * person is renaming the thing, and refusing an unrelated edit because of
   * old data they did not create would be punishing them for it.
   */
  if (!statusChanged && !conditionChanged && conditionContradictsStatus({ status, condition })) {
    return status === 'DAMAGED'
      ? { ok: true, condition: 'DAMAGED', note: 'Condition brought into line with the status.' }
      : { ok: true, status: 'DAMAGED', note: 'Status brought into line with the condition.' };
  }

  return { ok: true };
}

/** Whether a stored pair contradicts itself; used by the one-off repair. */
export function conditionContradictsStatus(a: {
  status: AssetStatus;
  condition: AssetCondition;
}): boolean {
  if (a.status === 'DAMAGED' && HEALTHY_GRADES.includes(a.condition)) return true;
  return BROKEN_GRADES.includes(a.condition) && IN_CIRCULATION.includes(a.status);
}
