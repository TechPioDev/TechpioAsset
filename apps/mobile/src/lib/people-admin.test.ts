import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@techpioasset/domain';
import {
  canSubmitInvite,
  fetchAllColleagues,
  fromOverride,
  initialDetails,
  inviteAllMessage,
  inviteBody,
  peopleGates,
  personName,
  profileBody,
  roleLabel,
  saveBlocked,
  sameRoles,
  sodConflictsFor,
  toOverride,
  type UserRow,
  peopleAudience,
  peopleRowAffiliation,
  peopleScreenCopy,
} from './people-admin';

const row: UserRow = {
  id: 'u1',
  email: 'ravi@example.com',
  status: 'ACTIVE',
  profile: {
    firstName: 'Ravi',
    lastName: 'Menon',
    jobTitle: null,
    employeeNumber: 'EMP-8',
    canRaiseRequests: false,
    department: { id: 'd1', name: 'Engineering' },
    office: null,
    manager: { id: 'm1', email: 'boss@example.com', profile: null },
  },
  roles: [{ role: { key: 'EMPLOYEE', name: 'Registered Employee' } }],
};

describe('names and labels', () => {
  it('prefers the profile name and falls back to the email', () => {
    expect(personName(row)).toBe('Ravi Menon');
    expect(personName({ email: 'x@y.z', profile: null })).toBe('x@y.z');
  });

  it('turns a role key into words', () => {
    expect(roleLabel('IT_ADMIN')).toBe('It Admin');
  });
});

describe('request override', () => {
  it('round-trips null, true and false', () => {
    for (const v of [null, true, false]) expect(fromOverride(toOverride(v))).toBe(v);
    expect(toOverride(undefined)).toBe('');
  });
});

describe('profile body', () => {
  it('sends what the web sends, including a cleared manager', () => {
    const d = { ...initialDetails(row), managerId: '', jobTitle: '  ', requests: '' as const };
    expect(profileBody(d)).toEqual({
      firstName: 'Ravi',
      lastName: 'Menon',
      jobTitle: null,
      employeeNumber: 'EMP-8',
      departmentId: 'd1',
      managerId: null,
      canRaiseRequests: null,
    });
  });
});

describe('save gate', () => {
  const details = initialDetails(row);
  it('blocks an unacknowledged conflict only when roles are being saved', () => {
    const base = { details, detailsDirty: false, roleKeys: ['A'], conflicts: 1, acknowledged: false };
    expect(saveBlocked({ ...base, rolesDirty: true })).toBe(true);
    expect(saveBlocked({ ...base, rolesDirty: false })).toBe(false);
    expect(saveBlocked({ ...base, rolesDirty: true, acknowledged: true })).toBe(false);
  });

  it('refuses empty roles and missing names', () => {
    const base = { details, detailsDirty: false, conflicts: 0, acknowledged: false };
    expect(saveBlocked({ ...base, roleKeys: [], rolesDirty: true })).toBe(true);
    expect(
      saveBlocked({ ...base, details: { ...details, lastName: ' ' }, detailsDirty: true, roleKeys: ['A'], rolesDirty: false }),
    ).toBe(true);
  });

  it('compares roles regardless of order', () => {
    expect(sameRoles(['B', 'A'], ['A', 'B'])).toBe(true);
  });
});

describe('segregation of duties', () => {
  it('finds a conflict across two individually clean roles', () => {
    const options = [
      { key: 'R1', name: 'R1', isSystem: false, permissions: [PERMISSIONS.REQUESTS_CREATE] },
      { key: 'R2', name: 'R2', isSystem: false, permissions: [PERMISSIONS.REQUESTS_APPROVE] },
    ];
    expect(sodConflictsFor(options, ['R1'])).toHaveLength(0);
    expect(sodConflictsFor(options, ['R1', 'R2']).map((c) => c.id)).toContain('request-and-approve');
  });
});

describe('invite', () => {
  const form = { firstName: 'A', lastName: 'B', email: 'a@b.co', jobTitle: '', departmentId: '', officeId: 'o1' };
  it('needs names, an email and a role', () => {
    expect(canSubmitInvite(form, ['EMPLOYEE'])).toBe(true);
    expect(canSubmitInvite({ ...form, email: 'nope' }, ['EMPLOYEE'])).toBe(false);
    expect(canSubmitInvite(form, [])).toBe(false);
  });

  it('omits an empty department and nulls an empty job title', () => {
    expect(inviteBody(form, ['EMPLOYEE'])).toEqual({
      email: 'a@b.co',
      firstName: 'A',
      lastName: 'B',
      jobTitle: null,
      officeId: 'o1',
      roleKeys: ['EMPLOYEE'],
    });
  });

  it('words the invite-all result like the web', () => {
    expect(inviteAllMessage({ pending: 0, sent: 0, failed: [] }).ok).toBe(true);
    expect(inviteAllMessage({ pending: 3, sent: 3, failed: [] }).message).toBe('Invitations sent to 3 people.');
    expect(inviteAllMessage({ pending: 2, sent: 1, failed: ['x@y.z'] })).toEqual({
      ok: false,
      message: 'Sent 1, failed for: x@y.z',
    });
  });
});

describe('gates', () => {
  it('gives HR invite and resend but not status or roles', () => {
    const g = peopleGates({ permissions: [PERMISSIONS.EMPLOYEES_CREATE], roles: ['HR'] });
    expect(g).toMatchObject({ canManage: true, canInvite: true, canStatus: false, canRoles: false, fullManager: false });
    expect(g.canSeeInvitations).toBe(false);
  });

  it('keeps the sign-in email to the Super Admin role, not users:manage', () => {
    const admin = peopleGates({ permissions: [PERMISSIONS.USERS_MANAGE], roles: ['COMPANY_ADMIN'] });
    expect(admin.canChangeEmail).toBe(false);
    expect(peopleGates({ permissions: [], roles: ['SUPER_ADMIN'] }).canChangeEmail).toBe(true);
    expect(peopleGates(null).canManage).toBe(false);
  });
});

describe('colleague paging', () => {
  it('stops at the first short page', async () => {
    const calls: number[] = [];
    const all = await fetchAllColleagues(async (page, size) => {
      calls.push(page);
      return Array.from({ length: page === 1 ? size : 1 }, (_, i) => ({ id: `${page}-${i}`, email: 'e', profile: null }));
    }, 2);
    expect(calls).toEqual([1, 2]);
    expect(all).toHaveLength(3);
  });
});

describe('vendor sign-ins have a list of their own (v2.68)', () => {
  it('reads the audience from the route, and nothing else as vendors', () => {
    expect(peopleAudience('vendors')).toBe('vendors');
    expect(peopleAudience(['vendors'])).toBe('vendors');
    expect(peopleAudience(undefined)).toBe('staff');
    expect(peopleAudience('everyone')).toBe('staff');
  });

  it('names the screen for what it lists', () => {
    expect(peopleScreenCopy('vendors').title).toBe('Vendor accounts');
    expect(peopleScreenCopy('staff').title).toBe('People');
    expect(peopleScreenCopy('staff').intro).toBeNull();
  });

  it('shows the vendor company on the vendor list, and says when there is none', () => {
    const row = { profile: null, vendorAccount: { id: 'v1', name: 'Acme Supplies' } };
    expect(peopleRowAffiliation(row, 'vendors')).toBe('Acme Supplies');
    expect(peopleRowAffiliation({ profile: null, vendorAccount: null }, 'vendors')).toBe('Not linked to a vendor');
    expect(peopleRowAffiliation(row, 'staff')).toBeNull();
  });
});
