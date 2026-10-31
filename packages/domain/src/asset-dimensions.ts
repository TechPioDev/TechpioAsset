/**
 * v2.1 Workstream A — Asset status as four orthogonal dimensions.
 *
 * The single 18-value `AssetStatus` enum (see ./asset-status.ts) conflates five
 * independent facts. The v2 blueprint splits them into four dimensions so a query
 * like "leased laptops, deployed, poor condition, in Warehouse-BLR" is answerable:
 *
 *   - Lifecycle    — where the asset is cradle-to-grave
 *   - Availability — can it be handed out right now
 *   - Condition    — physical/functional health (reuses the existing AssetCondition + END_OF_LIFE)
 *   - Ownership    — financial/legal ownership
 *
 * This module is PURE and NON-BREAKING: it adds new types + a total mapper from
 * the legacy enum + legal-combination guards. Nothing here is wired into the API,
 * schema, or UI yet — that lands behind the `STATUS_MODEL_V2` flag in later PRs
 * (see docs/IMPLEMENTATION-PLAN-v2.1.md §4.2 and issue #9).
 */

import type { AssetStatus } from './asset-status';
import type { StateMachine } from './state-machine';

// --------------------------------------------------------------------------
// Dimension value sets
// --------------------------------------------------------------------------

export const LIFECYCLE_STATES = [
  'PLANNED',
  'IN_PROCUREMENT',
  'IN_STOCK',
  'DEPLOYED',
  'IN_MAINTENANCE',
  'RETIRED',
  'DISPOSED',
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const AVAILABILITY_STATES = [
  'AVAILABLE',
  'RESERVED',
  'ASSIGNED',
  'IN_TRANSIT',
  'IN_REPAIR',
  'LOST',
] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

/**
 * Reuses the existing `AssetCondition` enum values (NEW/GOOD/FAIR/POOR/DAMAGED/UNUSABLE)
 * and adds END_OF_LIFE. UNUSABLE is retained for back-compat; END_OF_LIFE is the
 * blueprint's retire signal. Backfill treats UNUSABLE as an alias for END_OF_LIFE.
 */
export const CONDITION_GRADES = [
  'NEW',
  'GOOD',
  'FAIR',
  'POOR',
  'DAMAGED',
  'UNUSABLE',
  'END_OF_LIFE',
] as const;
export type ConditionGrade = (typeof CONDITION_GRADES)[number];

export const OWNERSHIP_TYPES = ['OWNED', 'LEASED', 'RENTED', 'BYOD', 'LOANER'] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

/** The full status of an asset, expressed as an independent tuple. */
export interface AssetDimensions {
  readonly lifecycle: LifecycleState;
  /**
   * Null for an asset that has left service - retired, disposed or donated.
   *
   * Until v3.13 those three mapped to AVAILABLE, so every scrapped laptop was
   * stored as available to hand out, and the asset list printed "Disposed"
   * and "Available" side by side on the same row. Nothing gave one out - the
   * assignment rules block a retired lifecycle - but the label was a false
   * statement, and any filter on availability would have counted the scrap
   * heap as stock. Availability is a question about equipment in circulation;
   * for equipment out of it, the honest answer is that there is none.
   */
  readonly availability: AvailabilityState | null;
  readonly condition: ConditionGrade;
  readonly ownership: OwnershipType;
}

// --------------------------------------------------------------------------
// State machines (Lifecycle + Availability are ordered; Condition/Ownership are
// classifications that change freely and are not modelled as machines).
// --------------------------------------------------------------------------

export const lifecycleStateMachine: StateMachine<LifecycleState> = {
  name: 'LifecycleState',
  initial: 'PLANNED',
  terminal: ['DISPOSED'],
  transitions: {
    PLANNED: ['IN_PROCUREMENT', 'IN_STOCK', 'RETIRED'],
    IN_PROCUREMENT: ['IN_STOCK', 'RETIRED'],
    IN_STOCK: ['DEPLOYED', 'IN_MAINTENANCE', 'RETIRED'],
    DEPLOYED: ['IN_STOCK', 'IN_MAINTENANCE', 'RETIRED'],
    IN_MAINTENANCE: ['IN_STOCK', 'DEPLOYED', 'RETIRED'],
    RETIRED: ['DISPOSED'],
    DISPOSED: [],
  },
};

export const availabilityStateMachine: StateMachine<AvailabilityState> = {
  name: 'AvailabilityState',
  initial: 'AVAILABLE',
  terminal: [],
  transitions: {
    AVAILABLE: ['RESERVED', 'ASSIGNED', 'IN_TRANSIT', 'IN_REPAIR', 'LOST'],
    RESERVED: ['AVAILABLE', 'ASSIGNED', 'IN_TRANSIT'],
    ASSIGNED: ['AVAILABLE', 'IN_TRANSIT', 'IN_REPAIR', 'LOST'],
    IN_TRANSIT: ['AVAILABLE', 'ASSIGNED', 'RESERVED', 'LOST'],
    IN_REPAIR: ['AVAILABLE', 'ASSIGNED', 'LOST'],
    LOST: ['AVAILABLE'], // recovered; the loss history rows are never rewritten
  },
};

// --------------------------------------------------------------------------
// Legacy → dimensions mapper (TOTAL: keyed by AssetStatus so TS enforces every
// one of the 18 values is handled). Blueprint Part 3 §1.5, adapted to the actual
// v1 enum values. Condition/ownership here are DEFAULTS; the real backfill passes
// the asset's existing AssetCondition / ownership to preserve them (see overrides).
// --------------------------------------------------------------------------

type BaseDims = Omit<AssetDimensions, never>;

const LEGACY_MAP: Readonly<Record<AssetStatus, BaseDims>> = {
  DRAFT: { lifecycle: 'PLANNED', availability: 'AVAILABLE', condition: 'NEW', ownership: 'OWNED' },
  REQUESTED: {
    lifecycle: 'IN_PROCUREMENT',
    availability: 'RESERVED',
    condition: 'NEW',
    ownership: 'OWNED',
  },
  ORDERED: {
    lifecycle: 'IN_PROCUREMENT',
    availability: 'RESERVED',
    condition: 'NEW',
    ownership: 'OWNED',
  },
  RECEIVED: {
    lifecycle: 'IN_STOCK',
    availability: 'AVAILABLE',
    condition: 'NEW',
    ownership: 'OWNED',
  },
  AVAILABLE: {
    lifecycle: 'IN_STOCK',
    availability: 'AVAILABLE',
    condition: 'GOOD',
    ownership: 'OWNED',
  },
  RESERVED: {
    lifecycle: 'IN_STOCK',
    availability: 'RESERVED',
    condition: 'GOOD',
    ownership: 'OWNED',
  },
  ASSIGNED: {
    lifecycle: 'DEPLOYED',
    availability: 'ASSIGNED',
    condition: 'GOOD',
    ownership: 'OWNED',
  },
  IN_USE: {
    lifecycle: 'DEPLOYED',
    availability: 'ASSIGNED',
    condition: 'GOOD',
    ownership: 'OWNED',
  },
  IN_STORAGE: {
    lifecycle: 'IN_STOCK',
    availability: 'AVAILABLE',
    condition: 'GOOD',
    ownership: 'OWNED',
  },
  IN_TRANSIT: {
    lifecycle: 'DEPLOYED',
    availability: 'IN_TRANSIT',
    condition: 'GOOD',
    ownership: 'OWNED',
  },
  UNDER_REPAIR: {
    lifecycle: 'IN_MAINTENANCE',
    availability: 'IN_REPAIR',
    condition: 'POOR',
    ownership: 'OWNED',
  },
  DAMAGED: {
    lifecycle: 'IN_MAINTENANCE',
    availability: 'IN_REPAIR',
    condition: 'DAMAGED',
    ownership: 'OWNED',
  },
  LOST: { lifecycle: 'DEPLOYED', availability: 'LOST', condition: 'GOOD', ownership: 'OWNED' },
  STOLEN: { lifecycle: 'DEPLOYED', availability: 'LOST', condition: 'GOOD', ownership: 'OWNED' },
  RETURNED: {
    lifecycle: 'IN_STOCK',
    availability: 'AVAILABLE',
    condition: 'GOOD',
    ownership: 'OWNED',
  },
  RETIRED: {
    lifecycle: 'RETIRED',
    availability: null,
    condition: 'END_OF_LIFE',
    ownership: 'OWNED',
  },
  DISPOSED: {
    lifecycle: 'DISPOSED',
    availability: null,
    condition: 'END_OF_LIFE',
    ownership: 'OWNED',
  },
  DONATED: {
    lifecycle: 'DISPOSED',
    availability: null,
    condition: 'END_OF_LIFE',
    ownership: 'OWNED',
  },
};

export interface DeriveOverrides {
  /** Preserve the asset's already-tracked condition (maps UNUSABLE → END_OF_LIFE). */
  readonly existingCondition?: ConditionGrade;
  /** Preserve the asset's already-tracked ownership if known. */
  readonly existingOwnership?: OwnershipType;
}

/**
 * Derive the four dimensions from a legacy `AssetStatus`. Total over all 18 values.
 * When the asset already tracks a real condition/ownership, pass it via `overrides`
 * so the backfill preserves it instead of using the per-status default.
 */
export function deriveDimensionsFromLegacy(
  status: AssetStatus,
  overrides: DeriveOverrides = {},
): AssetDimensions {
  const base = LEGACY_MAP[status];
  const condition =
    overrides.existingCondition === 'UNUSABLE'
      ? 'END_OF_LIFE'
      : (overrides.existingCondition ?? base.condition);
  return {
    lifecycle: base.lifecycle,
    availability: base.availability,
    condition,
    ownership: overrides.existingOwnership ?? base.ownership,
  };
}

// --------------------------------------------------------------------------
// Legal-combination guards (blueprint §1.4). These are advisory helpers the
// service layer composes; they do not mutate anything.
// --------------------------------------------------------------------------

/** Lifecycle states from which a new assignment must be blocked. */
export const LIFECYCLE_BLOCKS_ASSIGNMENT: readonly LifecycleState[] = ['RETIRED', 'DISPOSED'];

/** Availability that asserts the asset is currently in someone's custody. */
export function availabilityRequiresActiveAssignment(av: AvailabilityState): boolean {
  return av === 'ASSIGNED';
}

/** True when the lifecycle forbids handing the asset to a new holder. */
export function blocksNewAssignment(lifecycle: LifecycleState): boolean {
  return LIFECYCLE_BLOCKS_ASSIGNMENT.includes(lifecycle);
}

export interface DimensionViolation {
  readonly rule: string;
  readonly detail: string;
}

/**
 * Check the legal-combination invariants for a dimension tuple in context.
 * Returns an empty array when consistent. `hasActiveAssignment` and the current
 * placement come from the caller (service/repository layer).
 */
export function checkDimensionInvariants(
  dims: AssetDimensions,
  ctx: {
    readonly hasActiveAssignment?: boolean;
    readonly currentLocationId?: string | null;
    readonly assignedToUserId?: string | null;
  } = {},
): DimensionViolation[] {
  const v: DimensionViolation[] = [];

  if (dims.availability === 'ASSIGNED' && ctx.hasActiveAssignment === false) {
    v.push({
      rule: 'ASSIGNED_REQUIRES_ASSIGNMENT',
      detail: 'availability=ASSIGNED requires an active assignment',
    });
  }

  if (blocksNewAssignment(dims.lifecycle) && dims.availability === 'ASSIGNED') {
    v.push({
      rule: 'RETIRED_OR_DISPOSED_NOT_ASSIGNED',
      detail: `lifecycle=${dims.lifecycle} cannot be availability=ASSIGNED`,
    });
  }

  // Location XOR with-user for current placement.
  if (
    ctx.currentLocationId != null &&
    ctx.currentLocationId !== '' &&
    ctx.assignedToUserId != null &&
    ctx.assignedToUserId !== ''
  ) {
    v.push({
      rule: 'PLACEMENT_XOR',
      detail: 'an asset is either at a location or with a user, never both',
    });
  }

  return v;
}
