import { describe, expect, it } from 'vitest';
import { ASSET_STATUSES, type AssetStatus } from './asset-status';
import { ASSET_STATUS_GROUPS, assetStatusGroups, fleetBreakdown } from './fleet-breakdown';

describe('the groups cover the whole enum', () => {
  it('puts every status in exactly one group', () => {
    // The regression guard. A nineteenth status added later fails HERE, rather
    // than quietly disappearing from a dashboard nobody re-checks.
    const grouped = assetStatusGroups();
    const missing = ASSET_STATUSES.filter((s) => !grouped.has(s));
    expect(missing, `statuses in no group: ${missing.join(', ')}`).toEqual([]);
  });

  it('does not put a status in two groups', () => {
    const seen = new Set<string>();
    const twice: string[] = [];
    for (const statuses of Object.values(ASSET_STATUS_GROUPS))
      for (const s of statuses) {
        if (seen.has(s)) twice.push(s);
        seen.add(s);
      }
    expect(twice, `statuses in more than one group: ${twice.join(', ')}`).toEqual([]);
  });
});

describe('the parts add up to the whole', () => {
  it('reproduces the fault that was reported', () => {
    // 169 assets; the old dashboard counted a 100-row page and showed
    // 6 + 92 + 1 + 1 beside a total of 169.
    const b = fleetBreakdown(
      { AVAILABLE: 6, ASSIGNED: 92, UNDER_REPAIR: 1, DAMAGED: 1, IN_STORAGE: 69 },
      169,
    );
    expect(b.total).toBe(169);
    const parts =
      b.assigned + b.available + b.inStock + b.onOrder + b.underRepair + b.critical + b.retired + b.other;
    expect(parts).toBe(169);
  });

  it('adds up for every possible single-status fleet', () => {
    for (const s of ASSET_STATUSES) {
      const b = fleetBreakdown({ [s]: 7 }, 7);
      const parts =
        b.assigned + b.available + b.inStock + b.onOrder + b.underRepair + b.critical + b.retired + b.other;
      expect(parts, s).toBe(7);
      expect(b.other, `${s} should be in a named group`).toBe(0);
    }
  });

  it('puts an unknown status in "other" rather than losing it', () => {
    // What a newer server sending a status this build has never seen looks like.
    const b = fleetBreakdown({ ASSIGNED: 3, ON_LOAN_TO_MARS: 4 } as Record<string, number>, 7);
    expect(b.assigned).toBe(3);
    expect(b.other).toBe(4);
    expect(b.assigned + b.other).toBe(b.total);
  });

  it('shows a server total larger than the counts as "other", not as nothing', () => {
    const b = fleetBreakdown({ ASSIGNED: 92 }, 169);
    expect(b.other).toBe(77);
  });

  it('is all zeros for an empty fleet', () => {
    const b = fleetBreakdown({}, 0);
    expect(b.total).toBe(0);
    expect(b.other).toBe(0);
  });

  it('totals the counts when no total is given', () => {
    expect(fleetBreakdown({ ASSIGNED: 2, AVAILABLE: 3 }).total).toBe(5);
  });
});

describe('the groups mean what they say', () => {
  it('counts IN_USE as assigned', () => {
    expect(fleetBreakdown({ ASSIGNED: 2, IN_USE: 3 }).assigned).toBe(5);
  });

  it('counts damaged, lost and stolen together', () => {
    const b = fleetBreakdown({ DAMAGED: 1, LOST: 2, STOLEN: 3 } as Record<AssetStatus, number>);
    expect(b.critical).toBe(6);
  });

  it('does not count retired kit as available', () => {
    const b = fleetBreakdown({ RETIRED: 4, DISPOSED: 1, DONATED: 1 });
    expect(b.available).toBe(0);
    expect(b.retired).toBe(6);
  });
});

