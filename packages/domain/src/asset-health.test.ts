import { describe, expect, it } from 'vitest';
import { MAX_HEALTH, assetHealth, assetHealthSummary } from './asset-health';

/**
 * v2.89 — the health score.
 *
 * The rule that matters most: a damaged asset is zero. Everything else is
 * arithmetic, and all of it must stay inside 0..5 however the inputs pile up.
 */

describe('where the score starts', () => {
  it('follows the graded condition', () => {
    expect(assetHealth({ condition: 'NEW' }).stars).toBe(5);
    expect(assetHealth({ condition: 'GOOD' }).stars).toBe(4);
    expect(assetHealth({ condition: 'FAIR' }).stars).toBe(3);
    expect(assetHealth({ condition: 'POOR' }).stars).toBe(2);
    expect(assetHealth({ condition: 'UNUSABLE' }).stars).toBe(0);
  });

  it('sits in the middle when nobody has graded it, and says so', () => {
    const h = assetHealth({});
    expect(h.stars).toBe(3);
    expect(h.reasons.join(' ')).toContain('not graded');
  });
});

describe('a damaged asset', () => {
  it('is zero, whatever its last grade said', () => {
    // The case that started this: "Damaged" and "Condition: Good" side by side.
    const h = assetHealth({ condition: 'GOOD', status: 'DAMAGED' });
    expect(h.stars).toBe(0);
    expect(h.tone).toBe('danger');
    expect(h.reasons[0]).toContain('not usable');
  });

  it('treats lost, stolen and disposed the same way', () => {
    for (const status of ['LOST', 'STOLEN', 'DISPOSED'] as const) {
      expect(assetHealth({ condition: 'NEW', status }).stars, status).toBe(0);
    }
  });
});

describe('an asset in for repair', () => {
  it('is capped, because it may come back fine but is not fine now', () => {
    expect(assetHealth({ condition: 'NEW', status: 'UNDER_REPAIR' }).stars).toBe(2);
  });

  it('is not lifted by the cap when it is already worse', () => {
    expect(assetHealth({ condition: 'POOR', status: 'UNDER_REPAIR' }).stars).toBe(2);
    expect(assetHealth({ condition: 'DAMAGED', status: 'UNDER_REPAIR' }).stars).toBe(1);
  });

  it('says why either way', () => {
    expect(assetHealth({ condition: 'NEW', status: 'UNDER_REPAIR' }).reasons.join(' ')).toContain(
      'repair',
    );
    expect(assetHealth({ condition: 'POOR', status: 'UNDER_REPAIR' }).reasons.join(' ')).toContain(
      'repair',
    );
  });
});

describe('open complaints', () => {
  it('takes a star off for an upgrade request', () => {
    // "Someone says it is too slow" is worth less than "it is broken".
    const h = assetHealth({ condition: 'GOOD', openComplaints: { UPGRADE: 1 } });
    expect(h.stars).toBe(3);
    expect(h.reasons[0]).toContain('upgrade');
  });

  it('takes two off for a damage or repair report', () => {
    expect(assetHealth({ condition: 'GOOD', openComplaints: { DAMAGE: 1 } }).stars).toBe(2);
    expect(assetHealth({ condition: 'GOOD', openComplaints: { REPAIR: 1 } }).stars).toBe(2);
  });

  it('adds up, and never falls below zero', () => {
    const h = assetHealth({
      condition: 'GOOD',
      openComplaints: { DAMAGE: 2, REPAIR: 2, UPGRADE: 3 },
    });
    expect(h.stars).toBe(0);
  });

  it('ignores a complaint count of zero rather than mentioning it', () => {
    const h = assetHealth({ condition: 'GOOD', openComplaints: { UPGRADE: 0, DAMAGE: 0 } });
    expect(h.stars).toBe(4);
    expect(h.reasons).toHaveLength(1);
  });

  it('comes back up once the fault is closed', () => {
    // Nothing is stored, so closing the request restores the score by itself.
    const withFault = assetHealth({ condition: 'GOOD', openComplaints: { REPAIR: 1 } });
    const after = assetHealth({ condition: 'GOOD', openComplaints: { REPAIR: 0 } });
    expect(withFault.stars).toBe(2);
    expect(after.stars).toBe(4);
  });
});

describe('the number is always sane', () => {
  it('stays within range for every combination we can construct', () => {
    const conditions = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED', 'UNUSABLE', 'END_OF_LIFE'] as const;
    const statuses = ['AVAILABLE', 'ASSIGNED', 'IN_USE', 'UNDER_REPAIR', 'DAMAGED', 'RETIRED'] as const;
    for (const condition of conditions) {
      for (const status of statuses) {
        for (const n of [0, 1, 5]) {
          const h = assetHealth({ condition, status, openComplaints: { DAMAGE: n, UPGRADE: n } });
          expect(h.stars, `${condition}/${status}/${n}`).toBeGreaterThanOrEqual(0);
          expect(h.stars, `${condition}/${status}/${n}`).toBeLessThanOrEqual(MAX_HEALTH);
          expect(Number.isInteger(h.stars)).toBe(true);
          expect(h.reasons.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('colours itself by the score', () => {
    expect(assetHealth({ condition: 'NEW' }).tone).toBe('success');
    expect(assetHealth({ condition: 'GOOD' }).tone).toBe('success');
    expect(assetHealth({ condition: 'FAIR' }).tone).toBe('warning');
    expect(assetHealth({ condition: 'POOR' }).tone).toBe('warning');
    expect(assetHealth({ condition: 'DAMAGED' }).tone).toBe('danger');
  });
});

describe('the one-line summary', () => {
  it('leads with the number and then the reason that matters', () => {
    const h = assetHealth({ condition: 'GOOD', openComplaints: { UPGRADE: 1 } });
    expect(assetHealthSummary(h)).toBe('3 of 5 - someone has asked for an upgrade');
  });

  it('works for a damaged asset', () => {
    expect(assetHealthSummary(assetHealth({ status: 'DAMAGED' }))).toContain('0 of 5');
  });
});
