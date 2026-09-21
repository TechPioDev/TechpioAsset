import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, READ_ONLY_ROLES } from './permissions';
import {
  canVerifyAssets,
  lastVerifiedLabel,
  verificationPeriodLabel,
  verificationPeriodStart,
  verificationProgress,
} from './asset-verification';

describe('who may record that an asset was seen', () => {
  it('lets the people who handle equipment attest', () => {
    expect(canVerifyAssets(ROLE_PERMISSIONS.IT_ADMIN)).toBe(true);
    expect(canVerifyAssets(ROLE_PERMISSIONS.IT_TECHNICIAN)).toBe(true);
    expect(canVerifyAssets(ROLE_PERMISSIONS.SUPER_ADMIN)).toBe(true);
  });

  it('never lets a read-only role, an employee or a supplier', () => {
    for (const role of READ_ONLY_ROLES) expect(canVerifyAssets(ROLE_PERMISSIONS[role]), role).toBe(false);
    expect(canVerifyAssets(ROLE_PERMISSIONS.EMPLOYEE)).toBe(false);
    expect(canVerifyAssets(ROLE_PERMISSIONS.VENDOR)).toBe(false);
  });
});

describe('the verification round', () => {
  it('runs by calendar quarter', () => {
    expect(verificationPeriodStart(new Date('2026-09-21T10:00:00Z')).toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(verificationPeriodStart(new Date('2026-01-01T00:00:00Z')).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(verificationPeriodLabel(new Date('2026-09-21T10:00:00Z'))).toBe('Q3 2026');
  });

  it('counts, and only says 100% when nothing is left', () => {
    expect(verificationProgress(168, 142)).toMatchObject({ pending: 26, percent: 84, label: '142 of 168 verified' });
    expect(verificationProgress(168, 167).percent).toBe(99);
    expect(verificationProgress(168, 168).percent).toBe(100);
    expect(verificationProgress(0, 0)).toMatchObject({ percent: 0, label: 'Nothing to verify' });
    // More confirmations than assets (one deleted since) never reads as 101%.
    expect(verificationProgress(10, 12)).toMatchObject({ verified: 10, pending: 0, percent: 100 });
  });

  it('says when a unit was last seen, and by whom', () => {
    const now = new Date('2026-09-21T10:00:00Z');
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    expect(lastVerifiedLabel(null, now, fmt)).toBe('Never verified');
    expect(lastVerifiedLabel({ verifiedAt: '2026-09-21T03:00:00Z', by: 'Marcus Bell' }, now, fmt)).toBe(
      'Seen today by Marcus Bell',
    );
    expect(lastVerifiedLabel({ verifiedAt: '2026-08-02T03:00:00Z' }, now, fmt)).toBe('Seen 2026-08-02');
  });
});
