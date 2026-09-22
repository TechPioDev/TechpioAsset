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
