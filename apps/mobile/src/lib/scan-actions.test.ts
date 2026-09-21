import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '@techpioasset/domain';
import {
  assetScreenAction,
  matchTypedCode,
  scanActionHref,
  scanActions,
  stopsOnSheet,
} from './scan-actions';

const held = { status: 'ASSIGNED' as const, assignedUser: { id: 'u-holder' } };
const free = { status: 'AVAILABLE' as const, assignedUser: null };
const keys = (a: ReturnType<typeof scanActions>) => a.map((x) => x.key);

describe('what a scan offers', () => {
  it('keeps the flow that existed for somebody with nothing to do but look', () => {
    // An employee scanning their own laptop, and an auditor scanning anything:
    // no sheet, straight to the asset page, as before.
    const employee = scanActions({ asset: held, permissions: ROLE_PERMISSIONS.EMPLOYEE, userId: 'u-holder' });
    expect(stopsOnSheet(employee)).toBe(false);
    expect(keys(employee)).toEqual(['open', 'damage']);

    const auditor = scanActions({ asset: held, permissions: ROLE_PERMISSIONS.AUDITOR, userId: 'u-audit' });
    expect(stopsOnSheet(auditor)).toBe(false);
    expect(keys(auditor)).toEqual(['open']);
  });

  it('always puts "Open asset" first, so the old path is one tap', () => {
    for (const role of ['IT_ADMIN', 'IT_TECHNICIAN', 'SUPER_ADMIN', 'OFFICE_ADMIN'] as const) {
      expect(keys(scanActions({ asset: held, permissions: ROLE_PERMISSIONS[role], userId: 'x' }))[0]).toBe('open');
    }
  });

  it('offers a technician the custody acts that fit the unit in hand', () => {
    const onHeld = scanActions({ asset: held, permissions: ROLE_PERMISSIONS.IT_ADMIN, userId: 'u-it' });
    expect(stopsOnSheet(onHeld)).toBe(true);
    expect(keys(onHeld)).toEqual(['open', 'seen', 'reassign', 'return', 'damage']);

    const onFree = scanActions({ asset: free, permissions: ROLE_PERMISSIONS.IT_ADMIN, userId: 'u-it' });
    expect(keys(onFree)).toEqual(['open', 'seen', 'assign', 'damage']);
  });

  it('does not offer to mark a disposed unit seen, or to report damage twice', () => {
    const disposed = scanActions({
      asset: { status: 'DISPOSED', assignedUser: null },
      permissions: ROLE_PERMISSIONS.IT_ADMIN,
      userId: 'u-it',
    });
    expect(keys(disposed)).not.toContain('seen');
    const damaged = scanActions({
      asset: { status: 'DAMAGED', assignedUser: null },
      permissions: ROLE_PERMISSIONS.IT_ADMIN,
      userId: 'u-it',
    });
    expect(keys(damaged)).not.toContain('damage');
  });

  it('never offers a supplier anything', () => {
    const vendor = scanActions({ asset: free, permissions: ROLE_PERMISSIONS.VENDOR, userId: 'v' });
    expect(keys(vendor)).toEqual(['open']);
  });

  it('sends each act to the flow the asset screen already has', () => {
    expect(scanActionHref('a1', 'open')).toBe('/asset/a1');
    expect(scanActionHref('a1', 'reassign')).toBe('/asset/a1?action=reassign');
    expect(assetScreenAction('return')).toBe('return');
    expect(assetScreenAction(['damage'])).toBe('damage');
    expect(assetScreenAction('delete-everything')).toBeNull();
    expect(assetScreenAction(undefined)).toBeNull();
  });
});

describe('typing the tag when the label will not scan', () => {
  const found = [
    { id: '1', assetTag: 'LAP-0003', serialNumber: 'DL7450X003' },
    { id: '2', assetTag: 'LAP-0030', serialNumber: null },
  ];

  it('opens only an exact tag or serial, whatever the case', () => {
    expect(matchTypedCode(' lap-0003 ', found).match?.id).toBe('1');
    expect(matchTypedCode('dl7450x003', found).match?.id).toBe('1');
  });

  it('will not guess from a partial match', () => {
    const result = matchTypedCode('LAP-00', found);
    expect(result.match).toBeNull();
    expect(result.reason).toContain('LAP-00');
  });

  it('says so when nothing was typed, or two assets share the code', () => {
    expect(matchTypedCode('  ', found).reason).toMatch(/Type the asset tag/);
    const twins = [...found, { id: '3', assetTag: 'lap-0003', serialNumber: null }];
    expect(matchTypedCode('LAP-0003', twins).reason).toMatch(/More than one/);
  });
});
