import type { StateMachine } from './state-machine';

/** Spec section 7 - all 18 asset statuses, in lifecycle order. */
export const ASSET_STATUSES = [
  'DRAFT',
  'REQUESTED',
  'ORDERED',
  'RECEIVED',
  'AVAILABLE',
  'RESERVED',
  'ASSIGNED',
  'IN_USE',
  'IN_STORAGE',
  'IN_TRANSIT',
  'UNDER_REPAIR',
  'DAMAGED',
  'LOST',
  'STOLEN',
  'RETURNED',
  'RETIRED',
  'DISPOSED',
  'DONATED',
] as const;

export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const assetStatusMachine: StateMachine<AssetStatus> = {
  name: 'AssetStatus',
  initial: 'DRAFT',
  terminal: ['DISPOSED', 'DONATED'],
  transitions: {
    DRAFT: ['REQUESTED', 'ORDERED', 'RECEIVED', 'AVAILABLE', 'RETIRED'],
    REQUESTED: ['ORDERED', 'RECEIVED', 'AVAILABLE', 'RETIRED'],
    ORDERED: ['RECEIVED', 'RETIRED'],
    RECEIVED: ['AVAILABLE', 'IN_STORAGE', 'UNDER_REPAIR', 'DAMAGED', 'RETIRED'],
    AVAILABLE: [
      'RESERVED',
      'ASSIGNED',
      'IN_STORAGE',
      'IN_TRANSIT',
      'UNDER_REPAIR',
      'DAMAGED',
      'LOST',
      'STOLEN',
      'RETIRED',
      'DISPOSED',
      'DONATED',
    ],
    RESERVED: ['ASSIGNED', 'AVAILABLE', 'IN_TRANSIT'],
    ASSIGNED: ['IN_USE', 'RETURNED', 'IN_TRANSIT', 'UNDER_REPAIR', 'DAMAGED', 'LOST', 'STOLEN'],
    IN_USE: ['RETURNED', 'IN_TRANSIT', 'UNDER_REPAIR', 'DAMAGED', 'LOST', 'STOLEN'],
    IN_STORAGE: [
      'AVAILABLE',
      'RESERVED',
      'ASSIGNED',
      'IN_TRANSIT',
      'UNDER_REPAIR',
      'RETIRED',
      'DISPOSED',
      'DONATED',
    ],
    IN_TRANSIT: ['RECEIVED', 'AVAILABLE', 'ASSIGNED', 'IN_STORAGE', 'LOST'],
    UNDER_REPAIR: ['AVAILABLE', 'IN_STORAGE', 'ASSIGNED', 'DAMAGED', 'RETIRED', 'DISPOSED'],
    DAMAGED: ['UNDER_REPAIR', 'AVAILABLE', 'IN_STORAGE', 'RETIRED', 'DISPOSED', 'DONATED'],
    // Recoverable: a found or recovered asset returns to circulation, but the
    // history rows recording the loss are never rewritten (spec section 12).
    LOST: ['AVAILABLE', 'IN_STORAGE', 'RETIRED', 'DISPOSED'],
    STOLEN: ['AVAILABLE', 'IN_STORAGE', 'RETIRED', 'DISPOSED'],
    RETURNED: ['AVAILABLE', 'IN_STORAGE', 'UNDER_REPAIR', 'DAMAGED', 'RETIRED', 'DISPOSED'],
    RETIRED: ['DISPOSED', 'DONATED'],
    DISPOSED: [],
    DONATED: [],
  },
};

/** Statuses that mean the asset is physically held by an employee. */
export const ASSET_STATUSES_IN_EMPLOYEE_CUSTODY: readonly AssetStatus[] = ['ASSIGNED', 'IN_USE'];

/**
 * Statuses that say nobody holds the asset (v2.75): it is in stock, on its
 * way in, or gone. A record in one of these must not name a holder - the
 * owner found a mouse shown as Available and Assigned to Banti Kumar in the
 * same row, and asked that an assigned asset never show as available. The
 * API refuses a status change that would do it, and the database refuses
 * the row (assets_holder_matches_status). Held assets can still be under
 * repair, damaged, in transit, lost or stolen: those are things that happen
 * to a unit somebody has.
 */
export const ASSET_STATUSES_WITHOUT_HOLDER: readonly AssetStatus[] = [
  'DRAFT',
  'REQUESTED',
  'ORDERED',
  'RECEIVED',
  'AVAILABLE',
  'RESERVED',
  'IN_STORAGE',
  'RETURNED',
  'RETIRED',
  'DISPOSED',
  'DONATED',
];

/** Statuses that make an asset eligible for a new assignment. */
export const ASSET_STATUSES_ASSIGNABLE: readonly AssetStatus[] = ['AVAILABLE', 'RESERVED'];

/** Statuses that must block offboarding completion until resolved (spec section 13). */
export const ASSET_STATUSES_BLOCKING_OFFBOARDING: readonly AssetStatus[] = [
  'ASSIGNED',
  'IN_USE',
  'IN_TRANSIT',
];

// ── changing a status by hand (v3.13) ────────────────────────────────────────

/** How a status reads in a sentence. Kept here so refusals need no UI package. */
const STATUS_WORDS: Record<AssetStatus, string> = {
  DRAFT: 'Draft',
  REQUESTED: 'Requested',
  ORDERED: 'Ordered',
  RECEIVED: 'Received',
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  ASSIGNED: 'Awaiting confirmation',
  IN_USE: 'In use',
  IN_STORAGE: 'In storage',
  IN_TRANSIT: 'In transit',
  UNDER_REPAIR: 'Under repair',
  DAMAGED: 'Damaged',
  LOST: 'Lost',
  STOLEN: 'Stolen',
  RETURNED: 'Returned',
  RETIRED: 'Retired',
  DISPOSED: 'Disposed',
  DONATED: 'Donated',
};

/**
 * The statuses a person may pick by hand for an asset in `current`.
 *
 * The edit form and the bulk menu used to list every status there is. Most of
 * them were moves the rules refuse - a laptop somebody holds cannot jump to
 * Available, a disposed one cannot change at all - so choosing one looked like
 * it did nothing, because the refusal came back as "Illegal AssetStatus
 * transition: IN_USE -> AVAILABLE" or not at all. Offering only what will work
 * is the fix; the plain-English refusal below is for what is left.
 *
 * Never offered here, whatever the rules allow:
 *   - "Awaiting confirmation" and "In use": earned through Assign and the
 *     employee's confirmation, which record WHO has it. Declared by hand they
 *     produce an asset with a status and no holder.
 *   - "Returned": the Return action, which also closes the employee's record.
 *
 * The current status is always first, so an untouched form saves unchanged.
 */
export function manualStatusOptions(current: AssetStatus): AssetStatus[] {
  const next = assetStatusMachine.transitions[current].filter(
    (s) => !ASSET_STATUSES_IN_EMPLOYEE_CUSTODY.includes(s) && s !== 'RETURNED',
  );
  return [current, ...next];
}

/** Statuses an asset in employee custody leaves only by being returned first. */
const NEEDS_RETURN_FIRST: readonly AssetStatus[] = [
  'AVAILABLE',
  'IN_STORAGE',
  'RESERVED',
  'RETIRED',
  'DISPOSED',
  'DONATED',
];

/**
 * Why `from` cannot become `to`, in a sentence a person can act on.
 *
 * Replaces "Illegal AssetStatus transition: IN_USE -> AVAILABLE" wherever a
 * status change is refused, so the reason is the next step, not the rule.
 */
export function describeAssetStatusRefusal(from: AssetStatus, to: AssetStatus): string {
  const fromWord = STATUS_WORDS[from];
  const toWord = STATUS_WORDS[to];
  if (from === 'DISPOSED' || from === 'DONATED') {
    return `This asset is ${fromWord.toLowerCase()}, which is final. Its record is kept for history and can no longer be changed.`;
  }
  if (ASSET_STATUSES_IN_EMPLOYEE_CUSTODY.includes(from) && NEEDS_RETURN_FIRST.includes(to)) {
    return `This asset is with a person. Use Return on the asset page first - it closes their record - then set it to ${toWord}.`;
  }
  if (ASSET_STATUSES_IN_EMPLOYEE_CUSTODY.includes(to)) {
    return `"${toWord}" cannot be set by hand. Use Assign on the asset page, so the record says who has it.`;
  }
  if (to === 'RETURNED') {
    return "Use Return on the asset page, so the employee's record is closed as well.";
  }
  const allowed = manualStatusOptions(from).slice(1);
  return allowed.length > 0
    ? `An asset that is ${fromWord} cannot change straight to ${toWord}. From ${fromWord} it can go to: ${allowed.map((s) => STATUS_WORDS[s]).join(', ')}.`
    : `An asset that is ${fromWord} cannot change straight to ${toWord}.`;
}
