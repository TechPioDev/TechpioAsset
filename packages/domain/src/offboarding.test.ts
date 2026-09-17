import { describe, expect, it } from 'vitest';
import {
  deactivateWithAssetsWarning,
  isBlockingOffboarding,
  offboardingExceptionProblem,
  offboardingFinishState,
  offboardingProgress,
  offboardingProgressLabel,
} from './offboarding';

const ref = (assetId: string, status = 'ASSIGNED') => ({
  assetId,
  assetTag: `TAG-${assetId}`,
  name: `Asset ${assetId}`,
  status,
});

describe('offboardingProgress', () => {
  it('marks snapshot assets returned once they leave the outstanding list', () => {
    const p = offboardingProgress([ref('a'), ref('b'), ref('c')], [ref('b')]);
    expect(p.total).toBe(3);
    expect(p.returned).toBe(2);
    expect(p.blocking).toBe(1);
    // Work left to do sorts first.
    expect(p.rows.map((r) => [r.assetId, r.returned])).toEqual([
      ['b', false],
      ['a', true],
      ['c', true],
    ]);
  });

  it('adds an asset issued after the start rather than ignoring it', () => {
    const p = offboardingProgress([ref('a')], [ref('a'), ref('late')]);
    expect(p.total).toBe(2);
    expect(p.blocking).toBe(2);
    expect(p.rows.some((r) => r.assetId === 'late' && !r.returned)).toBe(true);
  });

  it('uses the live status for an outstanding asset', () => {
    const p = offboardingProgress([ref('a', 'ASSIGNED')], [ref('a', 'IN_TRANSIT')]);
    expect(p.rows[0]?.status).toBe('IN_TRANSIT');
  });

  it('copes with a missing snapshot and duplicates', () => {
    const p = offboardingProgress(null, [ref('a'), ref('a')]);
    expect(p.total).toBe(1);
    expect(offboardingProgress(undefined, undefined).total).toBe(0);
  });
});

describe('finish state', () => {
  it('is blocked while anything is outstanding, ready when nothing is, completed once done', () => {
    expect(offboardingFinishState({ taskStatus: 'OPEN', blocking: 2 })).toBe('blocked');
    expect(offboardingFinishState({ taskStatus: 'OPEN', blocking: 0 })).toBe('ready');
    expect(offboardingFinishState({ taskStatus: 'COMPLETED', blocking: 0 })).toBe('completed');
    // A completed task never reopens on the screen, whatever the count says.
    expect(offboardingFinishState({ taskStatus: 'COMPLETED', blocking: 3 })).toBe('completed');
  });
});

describe('exception reason', () => {
  it('needs the same ten characters the server does', () => {
    expect(offboardingExceptionProblem('')).toMatch(/reason/i);
    expect(offboardingExceptionProblem('   n/a   ')).toMatch(/10 characters/);
    expect(offboardingExceptionProblem('Laptop stolen, police report filed')).toBeNull();
  });
});

describe('labels', () => {
  it('reads as N of M, or says there was nothing to return', () => {
    expect(offboardingProgressLabel({ total: 5, returned: 3 })).toBe('3 of 5 returned');
    expect(offboardingProgressLabel({ total: 0, returned: 0 })).toBe('Nothing to return');
  });

  it('only warns about deactivating when equipment is out', () => {
    expect(deactivateWithAssetsWarning(0)).toBeNull();
    expect(deactivateWithAssetsWarning(1)).toMatch(/^1 asset is still assigned/);
    expect(deactivateWithAssetsWarning(3)).toMatch(/^3 assets are still assigned/);
    expect(deactivateWithAssetsWarning(3)).toMatch(/Offboard instead/);
  });

  it('knows which statuses block', () => {
    expect(isBlockingOffboarding('ASSIGNED')).toBe(true);
    expect(isBlockingOffboarding('IN_TRANSIT')).toBe(true);
    expect(isBlockingOffboarding('AVAILABLE')).toBe(false);
  });
});
