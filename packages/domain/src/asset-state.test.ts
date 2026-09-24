import { describe, expect, it } from 'vitest';
import { ASSET_STATUSES } from './asset-status';
import { assetStateToShow, statusSituation } from './asset-state';

/**
 * v2.89 — one state, said once.
 */

describe('the case that started it', () => {
  it('says "Damaged" once instead of three times in three vocabularies', () => {
    // The real asset: Damaged / In maintenance / In repair, all at once.
    const shown = assetStateToShow({
      status: 'DAMAGED',
      lifecycleState: 'IN_MAINTENANCE',
      availabilityState: 'IN_REPAIR',
    });
    expect(shown.status).toBe('DAMAGED');
    expect(shown.lifecycleState).toBeNull();
    expect(shown.availabilityState).toBeNull();
    expect(shown.collapsed).toBe(true);
  });

  it('collapses the assigned trio the same way', () => {
    const shown = assetStateToShow({
      status: 'ASSIGNED',
      lifecycleState: 'DEPLOYED',
      availabilityState: 'ASSIGNED',
    });
    expect(shown.lifecycleState).toBeNull();
    expect(shown.availabilityState).toBeNull();
  });
});

describe('a dimension that genuinely adds something', () => {
  it('keeps a lifecycle state that disagrees with the status', () => {
    // Assigned to someone, but the lifecycle says it is being retired: that
    // is worth knowing, and the status alone does not say it.
    const shown = assetStateToShow({ status: 'ASSIGNED', lifecycleState: 'RETIRED' });
    expect(shown.lifecycleState).toBe('RETIRED');
    expect(shown.collapsed).toBe(false);
  });

  it('keeps an availability state that disagrees with the status', () => {
    const shown = assetStateToShow({ status: 'AVAILABLE', availabilityState: 'RESERVED' });
    // Both mean "spare", so this one IS the same situation and collapses.
    expect(shown.availabilityState).toBeNull();

    const other = assetStateToShow({ status: 'AVAILABLE', availabilityState: 'IN_REPAIR' });
    expect(other.availabilityState).toBe('IN_REPAIR');
  });

  it('is not confused by only one of the two being set', () => {
    expect(assetStateToShow({ status: 'IN_USE' }).collapsed).toBe(false);
    expect(assetStateToShow({ status: 'IN_USE', lifecycleState: 'DEPLOYED' }).collapsed).toBe(true);
  });
});

describe('the grouping itself', () => {
  it('places every status somewhere', () => {
    for (const status of ASSET_STATUSES) {
      expect(statusSituation(status), status).not.toBe('unknown');
    }
  });

  it('groups the ones people treat alike', () => {
    expect(statusSituation('DAMAGED')).toBe(statusSituation('UNDER_REPAIR'));
    expect(statusSituation('ASSIGNED')).toBe(statusSituation('IN_USE'));
    expect(statusSituation('AVAILABLE')).toBe(statusSituation('IN_STORAGE'));
    expect(statusSituation('LOST')).toBe(statusSituation('STOLEN'));
  });

  it('keeps apart the ones that mean different things', () => {
    // Out of service is recoverable; gone is not. Never the same badge.
    expect(statusSituation('DAMAGED')).not.toBe(statusSituation('LOST'));
    expect(statusSituation('AVAILABLE')).not.toBe(statusSituation('ASSIGNED'));
    expect(statusSituation('RETIRED')).not.toBe(statusSituation('AVAILABLE'));
  });

  it('never drops the status itself', () => {
    for (const status of ASSET_STATUSES) {
      const shown = assetStateToShow({
        status,
        lifecycleState: 'IN_MAINTENANCE',
        availabilityState: 'IN_REPAIR',
      });
      expect(shown.status, status).toBe(status);
    }
  });
});
