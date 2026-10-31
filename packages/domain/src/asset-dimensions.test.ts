import { describe, it, expect } from 'vitest';
import { ASSET_STATUSES, type AssetStatus } from './asset-status';
import { canTransition, isTerminal } from './state-machine';
import {
  LIFECYCLE_STATES,
  AVAILABILITY_STATES,
  CONDITION_GRADES,
  OWNERSHIP_TYPES,
  lifecycleStateMachine,
  availabilityStateMachine,
  deriveDimensionsFromLegacy,
  checkDimensionInvariants,
  blocksNewAssignment,
  availabilityRequiresActiveAssignment,
} from './asset-dimensions';

describe('asset dimension value sets', () => {
  it('declares the four dimensions (blueprint §1.2)', () => {
    expect(LIFECYCLE_STATES).toHaveLength(7);
    expect(AVAILABILITY_STATES).toHaveLength(6);
    expect(CONDITION_GRADES).toHaveLength(7); // 6 legacy AssetCondition + END_OF_LIFE
    expect(OWNERSHIP_TYPES).toHaveLength(5);
  });
});

describe('lifecycle state machine', () => {
  it('walks the cradle-to-grave happy path', () => {
    expect(canTransition(lifecycleStateMachine, 'PLANNED', 'IN_PROCUREMENT')).toBe(true);
    expect(canTransition(lifecycleStateMachine, 'IN_PROCUREMENT', 'IN_STOCK')).toBe(true);
    expect(canTransition(lifecycleStateMachine, 'IN_STOCK', 'DEPLOYED')).toBe(true);
    expect(canTransition(lifecycleStateMachine, 'DEPLOYED', 'IN_MAINTENANCE')).toBe(true);
    expect(canTransition(lifecycleStateMachine, 'IN_MAINTENANCE', 'DEPLOYED')).toBe(true);
    expect(canTransition(lifecycleStateMachine, 'RETIRED', 'DISPOSED')).toBe(true);
  });

  it('cannot resurrect a disposed asset', () => {
    for (const s of LIFECYCLE_STATES) {
      expect(canTransition(lifecycleStateMachine, 'DISPOSED', s)).toBe(s === 'DISPOSED');
    }
    expect(isTerminal(lifecycleStateMachine, 'DISPOSED')).toBe(true);
  });

  it('cannot jump straight from procurement to deployed', () => {
    expect(canTransition(lifecycleStateMachine, 'IN_PROCUREMENT', 'DEPLOYED')).toBe(false);
  });
});

describe('availability state machine', () => {
  it('supports reserve → assign → return', () => {
    expect(canTransition(availabilityStateMachine, 'AVAILABLE', 'RESERVED')).toBe(true);
    expect(canTransition(availabilityStateMachine, 'RESERVED', 'ASSIGNED')).toBe(true);
    expect(canTransition(availabilityStateMachine, 'ASSIGNED', 'AVAILABLE')).toBe(true);
  });

  it('a recovered lost asset returns to available', () => {
    expect(canTransition(availabilityStateMachine, 'LOST', 'AVAILABLE')).toBe(true);
  });
});

describe('deriveDimensionsFromLegacy — totality & correctness', () => {
  it('maps every one of the 18 legacy statuses to a valid tuple', () => {
    for (const status of ASSET_STATUSES) {
      const d = deriveDimensionsFromLegacy(status);
      expect(LIFECYCLE_STATES).toContain(d.lifecycle);
      // v3.13: an asset that has left service has no availability at all -
      // before, all three said AVAILABLE and a disposed laptop read as stock.
      if (['RETIRED', 'DISPOSED', 'DONATED'].includes(status)) {
        expect(d.availability, status).toBeNull();
      } else {
        expect(AVAILABILITY_STATES).toContain(d.availability);
      }
      expect(CONDITION_GRADES).toContain(d.condition);
      expect(OWNERSHIP_TYPES).toContain(d.ownership);
    }
  });

  it('every derived tuple satisfies the legal-combination invariants', () => {
    for (const status of ASSET_STATUSES) {
      const d = deriveDimensionsFromLegacy(status);
      // Supply an active assignment exactly when the tuple claims ASSIGNED,
      // so the mapper output is internally consistent by construction.
      const violations = checkDimensionInvariants(d, {
        hasActiveAssignment: d.availability === 'ASSIGNED',
      });
      expect(violations, `${status} → ${JSON.stringify(d)}`).toEqual([]);
    }
  });

  it('maps representative statuses per the blueprint table', () => {
    expect(deriveDimensionsFromLegacy('IN_USE')).toMatchObject({
      lifecycle: 'DEPLOYED',
      availability: 'ASSIGNED',
    });
    expect(deriveDimensionsFromLegacy('UNDER_REPAIR')).toMatchObject({
      lifecycle: 'IN_MAINTENANCE',
      availability: 'IN_REPAIR',
    });
    expect(deriveDimensionsFromLegacy('STOLEN')).toMatchObject({
      lifecycle: 'DEPLOYED',
      availability: 'LOST',
    });
    expect(deriveDimensionsFromLegacy('DISPOSED')).toMatchObject({
      lifecycle: 'DISPOSED',
      condition: 'END_OF_LIFE',
    });
  });

  it('preserves existing condition, mapping legacy UNUSABLE → END_OF_LIFE', () => {
    expect(deriveDimensionsFromLegacy('AVAILABLE', { existingCondition: 'FAIR' }).condition).toBe(
      'FAIR',
    );
    expect(
      deriveDimensionsFromLegacy('AVAILABLE', { existingCondition: 'UNUSABLE' }).condition,
    ).toBe('END_OF_LIFE');
  });

  it('preserves existing ownership when supplied', () => {
    expect(deriveDimensionsFromLegacy('ASSIGNED', { existingOwnership: 'LEASED' }).ownership).toBe(
      'LEASED',
    );
  });
});

describe('legal-combination guards', () => {
  it('flags ASSIGNED without an active assignment', () => {
    const v = checkDimensionInvariants(
      { lifecycle: 'DEPLOYED', availability: 'ASSIGNED', condition: 'GOOD', ownership: 'OWNED' },
      { hasActiveAssignment: false },
    );
    expect(v.map((x) => x.rule)).toContain('ASSIGNED_REQUIRES_ASSIGNMENT');
  });

  it('flags a RETIRED asset that is still ASSIGNED', () => {
    const v = checkDimensionInvariants({
      lifecycle: 'RETIRED',
      availability: 'ASSIGNED',
      condition: 'END_OF_LIFE',
      ownership: 'OWNED',
    });
    expect(v.map((x) => x.rule)).toContain('RETIRED_OR_DISPOSED_NOT_ASSIGNED');
  });

  it('flags an asset that is both at a location and with a user', () => {
    const v = checkDimensionInvariants(
      { lifecycle: 'DEPLOYED', availability: 'ASSIGNED', condition: 'GOOD', ownership: 'OWNED' },
      { hasActiveAssignment: true, currentLocationId: 'loc-1', assignedToUserId: 'user-1' },
    );
    expect(v.map((x) => x.rule)).toContain('PLACEMENT_XOR');
  });

  it('blocksNewAssignment / availabilityRequiresActiveAssignment predicates', () => {
    expect(blocksNewAssignment('RETIRED')).toBe(true);
    expect(blocksNewAssignment('IN_STOCK')).toBe(false);
    expect(availabilityRequiresActiveAssignment('ASSIGNED')).toBe(true);
    expect(availabilityRequiresActiveAssignment('AVAILABLE')).toBe(false);
  });
});

// Compile-time guard: keep the legacy list length pinned so a new legacy status
// forces an update to the (exhaustive) mapper.
describe('coverage guard', () => {
  it('legacy enum still has 18 values', () => {
    const all: readonly AssetStatus[] = ASSET_STATUSES;
    expect(all).toHaveLength(18);
  });
});
