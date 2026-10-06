import { describe, expect, it } from 'vitest';
import { fleetTrend } from './fleet-trend';

const NOW = new Date('2026-11-05T09:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('with nothing to compare against', () => {
  it('says nothing rather than zero', () => {
    // 0% is a claim that the fleet did not change. The absence of a baseline
    // is not that claim.
    expect(fleetTrend(172, null, NOW)).toBeNull();
    expect(fleetTrend(172, undefined, NOW)).toBeNull();
  });
});

describe('the baseline has to be the right age', () => {
  it('refuses one that is too recent to call "last month"', () => {
    expect(fleetTrend(172, { takenOn: daysAgo(4), total: 170 }, NOW)).toBeNull();
    expect(fleetTrend(172, { takenOn: daysAgo(19), total: 170 }, NOW)).toBeNull();
  });

  it('refuses one too old to be last month', () => {
    expect(fleetTrend(172, { takenOn: daysAgo(46), total: 170 }, NOW)).toBeNull();
    expect(fleetTrend(172, { takenOn: daysAgo(400), total: 10 }, NOW)).toBeNull();
  });

  it('accepts one inside the window', () => {
    expect(fleetTrend(172, { takenOn: daysAgo(20), total: 170 }, NOW)).not.toBeNull();
    expect(fleetTrend(172, { takenOn: daysAgo(30), total: 170 }, NOW)).not.toBeNull();
    expect(fleetTrend(172, { takenOn: daysAgo(45), total: 170 }, NOW)).not.toBeNull();
  });

  it('honours a caller that wants a different window', () => {
    const weekly = { minAgeDays: 6, maxAgeDays: 9 };
    expect(fleetTrend(172, { takenOn: daysAgo(7), total: 170 }, NOW, weekly)).not.toBeNull();
    expect(fleetTrend(172, { takenOn: daysAgo(30), total: 170 }, NOW, weekly)).toBeNull();
  });
});

describe('what it reports', () => {
  it('reports growth', () => {
    const t = fleetTrend(172, { takenOn: daysAgo(30), total: 160 }, NOW)!;
    expect(t.change).toBe(12);
    expect(t.changePercent).toBe(8);
    expect(t.direction).toBe('up');
  });

  it('reports a shrinking fleet', () => {
    const t = fleetTrend(150, { takenOn: daysAgo(30), total: 160 }, NOW)!;
    expect(t.change).toBe(-10);
    expect(t.changePercent).toBe(-6);
    expect(t.direction).toBe('down');
  });

  it('reports no change as flat, not as absent', () => {
    // Different from "no baseline": this one IS a measurement.
    const t = fleetTrend(160, { takenOn: daysAgo(30), total: 160 }, NOW)!;
    expect(t.change).toBe(0);
    expect(t.changePercent).toBe(0);
    expect(t.direction).toBe('flat');
  });

  it('gives the units but no percentage when the baseline was zero', () => {
    // 0 -> 5 is five assets, not "+500%" and not infinity.
    const t = fleetTrend(5, { takenOn: daysAgo(30), total: 0 }, NOW)!;
    expect(t.change).toBe(5);
    expect(t.changePercent).toBeNull();
    expect(t.direction).toBe('up');
  });

  it('carries the date it is comparing against', () => {
    const since = daysAgo(30);
    expect(fleetTrend(172, { takenOn: since, total: 160 }, NOW)!.since).toEqual(since);
  });

  it('reports how old the baseline really is, not the word "month"', () => {
    // The window spans 20 to 45 days, so "vs last month" could be off by a
    // fortnight. The caller renders this number instead of guessing.
    expect(fleetTrend(172, { takenOn: daysAgo(21), total: 160 }, NOW)!.ageDays).toBe(21);
    expect(fleetTrend(172, { takenOn: daysAgo(44), total: 160 }, NOW)!.ageDays).toBe(44);
  });
});
