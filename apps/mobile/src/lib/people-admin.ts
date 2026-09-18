import { PERMISSIONS, SYSTEM_ROLES, findSodConflicts, type SodConflict } from '@techpioasset/domain';

/**
 * The rules behind managing people on the phone - who may do what, what gets
 * sent, what counts as an unsaved change.
 *
 * Kept free of React Native so it can be tested, and kept in step with the web
 * People page (apps/web/src/app/(app)/people/page.tsx) line for line: the
 * server is the real gate, but a phone that offers a button the web hides is a
 * bug report waiting to happen.
 */

/** A row from GET /users - the list carries canRaiseRequests, the detail does not. */
export interface UserRow {
  id: string;
  email: string;
  status: string;
  profile: {
    firstName: string;
    lastName: string;
    displayName?: string | null;
    jobTitle: string | null;
    employeeNumber: string | null;
    canRaiseRequests?: boolean | null;
    department: { id: string; name: string } | null;
    office: { id: string; name: string } | null;
    manager: {
      id: string;
      email: string;
      profile: { firstName: string; lastName: string } | null;
    } | null;
  } | null;
  roles: { role: { key: string; name: string } }[];
  /** v2.68 - the vendor company a vendor sign-in acts for; null for staff. */
  vendorAccount?: { id: string; name: string } | null;
}

/**
 * Whose accounts the People screen lists (v2.68; web: DirectoryAudience). The
 * owner asked for vendor sign-ins out of People and under a menu of their own:
 * the server's default list already leaves out accounts whose only role is
 * Vendor, and `vendors` asks for exactly those.
 */
export type PeopleAudience = 'staff' | 'vendors';

/** The `audience` route param, as the menu sends it; anything else is staff. */
export function peopleAudience(param: string | string[] | undefined): PeopleAudience {
  return (Array.isArray(param) ? param[0] : param) === 'vendors' ? 'vendors' : 'staff';
}

/** The words that differ between the two lists. */
export function peopleScreenCopy(audience: PeopleAudience) {
  return audience === 'vendors'
    ? {
        title: 'Vendor accounts',
        intro:
          'Sign-ins that belong to your vendors. Each sees only its own products, quotes and orders. They are not listed under People.',
        emptyTitle: 'No vendor accounts',
        searchPlaceholder: 'Search vendor accounts',
      }
    : { title: 'People', intro: null, emptyTitle: 'No people found', searchPlaceholder: null };
}

/** The pill under a row: the vendor company on the vendor list, the department otherwise. */
export function peopleRowAffiliation(row: Pick<UserRow, 'profile' | 'vendorAccount'>, audience: PeopleAudience): string | null {
  if (audience === 'vendors') return row.vendorAccount?.name ?? 'Not linked to a vendor';
  return row.profile?.department?.name ?? null;
}

export interface RoleOption {
  key: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
}

export interface Colleague {
  id: string;
  email: string;
  profile: { firstName: string; lastName: string } | null;
}

/** '' follows the company setting; 'allow' and 'block' are the exceptions. */
export type RequestOverride = '' | 'allow' | 'block';

export interface ManageDetails {
  firstName: string;
  lastName: string;
  jobTitle: string;
  employeeNumber: string;
  departmentId: string;
  officeId: string;
  managerId: string;
  requests: RequestOverride;
}

export function personName(p: {
  email: string;
  profile: { firstName?: string | null; lastName?: string | null; displayName?: string | null } | null;
}): string {
  if (p.profile?.displayName) return p.profile.displayName;
  const joined = [p.profile?.firstName, p.profile?.lastName].filter(Boolean).join(' ').trim();
  return joined || p.email;
}

/** "Priya Sharma" where a profile exists, the email where it does not. */
export function colleagueName(c: Colleague): string {
  const name = c.profile ? `${c.profile.firstName} ${c.profile.lastName}`.trim() : '';
  return name || c.email;
}

export function statusLabel(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export function roleLabel(key: string): string {
  return key
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** What the pickers offer when /roles is refused (it needs roles:manage). */
export function fallbackRoles(): RoleOption[] {
  return SYSTEM_ROLES.map((key) => ({ key, name: roleLabel(key), isSystem: true, permissions: [] }));
}

export function toOverride(value: boolean | null | undefined): RequestOverride {
  return value === true ? 'allow' : value === false ? 'block' : '';
}

export function fromOverride(value: RequestOverride): boolean | null {
  return value === 'allow' ? true : value === 'block' ? false : null;
}

export function initialDetails(user: UserRow): ManageDetails {
  return {
    firstName: user.profile?.firstName ?? '',
    lastName: user.profile?.lastName ?? '',
    jobTitle: user.profile?.jobTitle ?? '',
    employeeNumber: user.profile?.employeeNumber ?? '',
    departmentId: user.profile?.department?.id ?? '',
    officeId: user.profile?.office?.id ?? '',
    managerId: user.profile?.manager?.id ?? '',
    requests: toOverride(user.profile?.canRaiseRequests),
  };
}

/** PATCH /users/:id/profile, shaped exactly as the web sends it. */
export function profileBody(d: ManageDetails) {
  return {
    firstName: d.firstName.trim(),
    lastName: d.lastName.trim(),
    jobTitle: d.jobTitle.trim() || null,
    employeeNumber: d.employeeNumber.trim() || null,
    ...(d.departmentId ? { departmentId: d.departmentId } : {}),
    ...(d.officeId ? { officeId: d.officeId } : {}),
    // Always sent: clearing a line manager has to be possible, and the
    // omit-when-empty pattern above can only ever set one.
    managerId: d.managerId || null,
    canRaiseRequests: fromOverride(d.requests),
  };
}

export function sameDetails(a: ManageDetails, b: ManageDetails): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function sameRoles(a: readonly string[], b: readonly string[]): boolean {
  return [...a].sort().join(',') === [...b].sort().join(',');
}

/** Conflicts across the union of every selected role's grants. */
export function sodConflictsFor(options: readonly RoleOption[], keys: readonly string[]): SodConflict[] {
  return findSodConflicts(options.filter((r) => keys.includes(r.key)).flatMap((r) => r.permissions));
}

export function toggleKey(keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
}

/**
 * Whether Save may be pressed. Roles cannot be emptied and a flagged conflict
 * must be acknowledged - but only when roles are part of what is being saved;
 * names are required only when details are.
 */
export function saveBlocked(input: {
  details: ManageDetails;
  detailsDirty: boolean;
  roleKeys: readonly string[];
  rolesDirty: boolean;
  conflicts: number;
  acknowledged: boolean;
}): boolean {
  const namesMissing = !input.details.firstName.trim() || !input.details.lastName.trim();
  const sodBlocked = input.conflicts > 0 && !input.acknowledged;
  return (
    (input.rolesDirty && (input.roleKeys.length === 0 || sodBlocked)) ||
    (input.detailsDirty && namesMissing)
  );
}

/** The same loose check the web invite form uses; the server has the strict one. */
export function looksLikeEmail(value: string): boolean {
  return /\S+@\S+\.\S+/.test(value);
}

export function canSubmitInvite(form: { firstName: string; lastName: string; email: string }, roleKeys: readonly string[]): boolean {
  return Boolean(
    form.firstName.trim() && form.lastName.trim() && looksLikeEmail(form.email) && roleKeys.length > 0,
  );
}

export function inviteBody(
  form: { firstName: string; lastName: string; email: string; jobTitle: string; departmentId: string; officeId: string },
  roleKeys: readonly string[],
) {
  return {
    email: form.email.trim(),
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    jobTitle: form.jobTitle.trim() || null,
    ...(form.departmentId ? { departmentId: form.departmentId } : {}),
    ...(form.officeId ? { officeId: form.officeId } : {}),
    roleKeys: [...roleKeys],
  };
}

export interface PeopleGates {
  /** Opens the manage sheet at all. */
  canManage: boolean;
  /** Invite a person, and "Invite all pending". */
  canInvite: boolean;
  /** The pending-invitations board. */
  canSeeInvitations: boolean;
  /** Details and account status (users:manage). */
  canStatus: boolean;
  canRoles: boolean;
  /** Invite with any role rather than Registered Employee only. */
  fullManager: boolean;
  /** HR-style: may only re-send an invitation. */
  canEmployees: boolean;
  /** Sign-in email: the Super Admin role, not users:manage (Company Admin holds that too). */
  canChangeEmail: boolean;
}

export function peopleGates(me: { permissions: readonly string[]; roles: readonly string[] } | null): PeopleGates {
  const has = (p: string) => Boolean(me?.permissions.includes(p));
  const users = has(PERMISSIONS.USERS_MANAGE);
  const roles = has(PERMISSIONS.ROLES_MANAGE);
  const employees = has(PERMISSIONS.EMPLOYEES_CREATE);
  return {
    canManage: users || roles || employees,
    canInvite: users || employees,
    canSeeInvitations: users,
    canStatus: users,
    canRoles: roles,
    fullManager: users,
    canEmployees: employees,
    canChangeEmail: Boolean(me?.roles.includes('SUPER_ADMIN')),
  };
}

/** The toast the web shows after "Invite all pending", as one sentence. */
export function inviteAllMessage(r: { pending: number; sent: number; failed: string[] }): {
  ok: boolean;
  message: string;
} {
  if (r.pending === 0) return { ok: true, message: 'Nobody is pending - every account is already active.' };
  if (r.failed.length === 0) return { ok: true, message: `Invitations sent to ${r.sent} people.` };
  return { ok: false, message: `Sent ${r.sent}, failed for: ${r.failed.join(', ')}` };
}

/**
 * Every active colleague, paged at the API's cap. The mobile client drops the
 * page meta, so a short page is what says "that was the last one".
 */
export async function fetchAllColleagues(
  fetchPage: (page: number, pageSize: number) => Promise<Colleague[]>,
  pageSize = 100,
  maxPages = 10,
): Promise<Colleague[]> {
  const all: Colleague[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const rows = (await fetchPage(page, pageSize)) ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}
