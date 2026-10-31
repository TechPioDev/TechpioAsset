import { describe, expect, it } from 'vitest';
import {
  ASSET_STATUSES,
  ASSET_STATUSES_IN_EMPLOYEE_CUSTODY,
  assetStatusMachine,
  describeAssetStatusRefusal,
  manualStatusOptions,
} from './asset-status';
import { deriveDimensionsFromLegacy } from './asset-dimensions';
import { assetStateToShow } from './asset-state';

describe('the statuses offered by hand', () => {
  it('offers only moves the rules allow, current status first', () => {
    for (const current of ASSET_STATUSES) {
      const [first, ...rest] = manualStatusOptions(current);
      expect(first).toBe(current);
      for (const s of rest) {
        expect(assetStatusMachine.transitions[current], `${current} -> ${s}`).toContain(s);
      }
    }
  });

  it('never offers the statuses that need a person behind them, or Returned', () => {
    for (const current of ASSET_STATUSES) {
      const rest = manualStatusOptions(current).slice(1);
      for (const s of ASSET_STATUSES_IN_EMPLOYEE_CUSTODY) expect(rest).not.toContain(s);
      expect(rest).not.toContain('RETURNED');
    }
  });

  it('offers a laptop somebody holds no way to become Available', () => {
    // The owner's report: picking Available on an In use laptop "did nothing".
    // It was refused; now it is simply not offered.
    expect(manualStatusOptions('IN_USE')).not.toContain('AVAILABLE');
    expect(manualStatusOptions('ASSIGNED')).not.toContain('AVAILABLE');
  });

  it('offers a disposed asset nothing but itself', () => {
    expect(manualStatusOptions('DISPOSED')).toEqual(['DISPOSED']);
    expect(manualStatusOptions('DONATED')).toEqual(['DONATED']);
  });
});

describe('saying why a change was refused', () => {
  it('sends a held laptop to Return, not to a rule name', () => {
    const why = describeAssetStatusRefusal('IN_USE', 'AVAILABLE');
    expect(why).toMatch(/with a person/);
    expect(why).toMatch(/Use Return/);
    expect(why).not.toMatch(/Illegal|transition|->/);
  });

  it('says plainly that disposed is final', () => {
    expect(describeAssetStatusRefusal('DISPOSED', 'AVAILABLE')).toMatch(/final/);
  });

  it('sends the custody statuses to Assign', () => {
    expect(describeAssetStatusRefusal('AVAILABLE', 'IN_USE')).toMatch(/Use Assign/);
  });

  it('lists where an asset CAN go when the move is simply not one of them', () => {
    const why = describeAssetStatusRefusal('ORDERED', 'DAMAGED');
    expect(why).toMatch(/Received/);
    expect(why).not.toMatch(/->/);
  });
});

describe('an asset that has left service', () => {
  it('has no availability, so it can never read as available', () => {
    for (const s of ['RETIRED', 'DISPOSED', 'DONATED'] as const) {
      expect(deriveDimensionsFromLegacy(s).availability, s).toBeNull();
    }
  });

  it('shows one badge, not "Disposed" beside "Available"', () => {
    // The row the owner sent: Lenovo ThinkPad L490, Disposed + Available.
    const dims = deriveDimensionsFromLegacy('DISPOSED');
    const shown = assetStateToShow({
      status: 'DISPOSED',
      lifecycleState: dims.lifecycle,
      availabilityState: dims.availability,
    });
    expect(shown.availabilityState).toBeNull();
  });

  it('still has an availability for everything in circulation', () => {
    const leftService = ['RETIRED', 'DISPOSED', 'DONATED'];
    for (const s of ASSET_STATUSES.filter((x) => !leftService.includes(x))) {
      expect(deriveDimensionsFromLegacy(s).availability, s).not.toBeNull();
    }
  });
});
