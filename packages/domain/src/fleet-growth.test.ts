import { describe, expect, it } from 'vitest';
import { fleetGrowthReadiness, fleetGrowthShortfall } from './fleet-growth';

describe('refusing to draw a line that would mislead', () => {
  it('refuses the case that was reported', () => {
    // 3 of 171 dated. The old chart drew a line rising to 2 under the heading
    // "Fleet growth", on a fleet of 171.
    const r = fleetGrowthReadiness(3, 171);
    expect(r.ok).toBe(false);
    expect(r.coveragePercent).toBe(2);
    expect(r.undated).toBe(168);
  });

  it('says how many are missing, and how many there are', () => {
    const m = fleetGrowthShortfall(fleetGrowthReadiness(3, 171));
    expect(m.description).toContain('3');
    expect(m.description).toContain('171');
    expect(m.description).toContain('168');
  });

  it('draws once most of the fleet can be placed on it', () => {
    expect(fleetGrowthReadiness(160, 171).ok).toBe(true);
    expect(fleetGrowthReadiness(171, 171).ok).toBe(true);
  });

  it('sits exactly on the boundary rather than near it', () => {
    expect(fleetGrowthReadiness(80, 100).ok).toBe(true);
    expect(fleetGrowthReadiness(79, 100).ok).toBe(false);
  });

  it('honours a caller that wants a different bar', () => {
    expect(fleetGrowthReadiness(50, 100, 0.5).ok).toBe(true);
    expect(fleetGrowthReadiness(50, 100, 0.9).ok).toBe(false);
  });
});

describe('degenerate inputs do not produce a confident answer', () => {
  it('an empty fleet is not full coverage', () => {
    // 0/0 is 100% by arithmetic and nonsense by meaning.
    const r = fleetGrowthReadiness(0, 0);
    expect(r.ok).toBe(false);
    expect(fleetGrowthShortfall(r).title).toBe('No assets yet');
  });

  it('distinguishes "none dated" from "too few dated"', () => {
    expect(fleetGrowthShortfall(fleetGrowthReadiness(0, 171)).title).toBe('No purchase dates');
    expect(fleetGrowthShortfall(fleetGrowthReadiness(3, 171)).title).toBe(
      'Not enough purchase dates',
    );
  });

  it('cannot report more dated than exist', () => {
    const r = fleetGrowthReadiness(500, 171);
    expect(r.dated).toBe(171);
    expect(r.undated).toBe(0);
    expect(r.coveragePercent).toBe(100);
  });

  it('ignores negative nonsense', () => {
    expect(fleetGrowthReadiness(-5, 171).dated).toBe(0);
    expect(fleetGrowthReadiness(5, -171).total).toBe(0);
  });
});
