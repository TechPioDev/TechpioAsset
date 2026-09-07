import { describe, expect, it } from 'vitest';
import { DISPOSITION_STATUS, qualityCheckProblem, qualityOutcome } from './quality-check';
import { assetStatusMachine } from './asset-status';

describe('quality check arithmetic', () => {
  it('accepts a clean pass', () => {
    expect(qualityCheckProblem({ received: 10, accepted: 10, rejected: 0 })).toBeNull();
  });

  it('refuses numbers that do not add up to what arrived', () => {
    // Two units unaccounted for is stock that quietly vanishes.
    const problem = qualityCheckProblem({ received: 10, accepted: 6, rejected: 2 });
    expect(problem).toContain('add up');
  });

  it('handles fractional receipt quantities without float noise', () => {
    // 0.1 + 0.2 is famously not 0.3 in binary floating point.
    expect(
      qualityCheckProblem({
        received: 0.3,
        accepted: 0.1,
        rejected: 0.2,
        reason: 'Two of the reels were damp',
        disposition: 'RETURN_TO_VENDOR',
      }),
    ).toBeNull();
  });

  it('refuses negative quantities', () => {
    expect(qualityCheckProblem({ received: 5, accepted: 6, rejected: -1 })).toContain('negative');
  });

  it('says plainly when more was rejected than arrived', () => {
    // The inspector needs to know what to do, not that a derived number went
    // below zero.
    expect(qualityCheckProblem({ received: 3, accepted: -2, rejected: 5 })).toBe(
      'Cannot reject 5 when only 3 arrived',
    );
  });

  it('refuses an empty line', () => {
    expect(qualityCheckProblem({ received: 0, accepted: 0, rejected: 0 })).toContain('nothing');
  });

  it('requires a reason for a rejection', () => {
    const problem = qualityCheckProblem({ received: 5, accepted: 3, rejected: 2, disposition: 'HOLD_DAMAGED' });
    expect(problem).toContain('why');
  });

  it('does not accept blank space as a reason', () => {
    const problem = qualityCheckProblem({
      received: 5,
      accepted: 3,
      rejected: 2,
      reason: '   ',
      disposition: 'HOLD_DAMAGED',
    });
    expect(problem).toContain('why');
  });

  it('requires somewhere for the rejected units to go', () => {
    const problem = qualityCheckProblem({ received: 5, accepted: 3, rejected: 2, reason: 'Screen cracked' });
    expect(problem).toContain('what happens');
  });

  it('asks for neither when nothing was rejected', () => {
    expect(qualityCheckProblem({ received: 5, accepted: 5, rejected: 0 })).toBeNull();
  });
});

describe('naming the units that failed', () => {
  it('accepts a count that agrees with the list', () => {
    expect(
      qualityCheckProblem({
        received: 3,
        accepted: 2,
        rejected: 1,
        reason: 'Cracked',
        disposition: 'HOLD_DAMAGED',
        namedUnits: 1,
      }),
    ).toBeNull();
  });

  it('refuses a count that disagrees with the list', () => {
    // Condemning a different laptop from the cracked one.
    expect(
      qualityCheckProblem({
        received: 3,
        accepted: 1,
        rejected: 2,
        reason: 'Cracked',
        disposition: 'HOLD_DAMAGED',
        namedUnits: 1,
      }),
    ).toBe('2 rejected but 1 unit(s) named');
  });

  it('does not apply to a line with no units to name', () => {
    expect(
      qualityCheckProblem({ received: 3, accepted: 2, rejected: 1, reason: 'Damp', disposition: 'RETURN_TO_VENDOR' }),
    ).toBeNull();
  });
});

describe('outcome', () => {
  it('is derived from the counts', () => {
    expect(qualityOutcome(10, 0)).toBe('PASSED');
    expect(qualityOutcome(0, 10)).toBe('FAILED');
    expect(qualityOutcome(7, 3)).toBe('PARTIAL');
  });
});

describe('disposition', () => {
  it('only ever lands on a status the asset machine allows out of RECEIVED', () => {
    // The reason no new status was invented for rejected goods: the machine
    // already had somewhere for them to go.
    const allowed = assetStatusMachine.transitions.RECEIVED;
    for (const status of Object.values(DISPOSITION_STATUS)) {
      expect(allowed).toContain(status);
    }
    expect(allowed).toContain('AVAILABLE');
  });
});
