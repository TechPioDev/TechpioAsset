import type { Prisma } from '@prisma/client';
import type { AuthUser } from '@techpioasset/contracts';
import { AppError } from './errors/app-error.js';

/**
 * Data-scope filters.
 *
 * Spec section 3: "Employees must not see other employees' assets, requests,
 * invoices, or costs." These functions produce Prisma `where` fragments that
 * every list and read path composes in, so isolation is a property of the query
 * layer rather than something each controller has to remember. That matters
 * because the endpoints most likely to leak - reports and exports - are exactly
 * the ones where an ad-hoc check is most likely to be forgotten.
 *
 * Tenancy is always applied first: no query crosses a company boundary.
 */

export function tenantFilter(user: AuthUser): { companyId: string } {
  return { companyId: user.companyId };
}

/**
 * True when the actor is an external supplier user rather than a colleague.
 *
 * Decided by the link on the account, not by the role, because the role can be
 * edited by an administrator and the link is what every query actually filters
 * on. If those two ever disagree, the narrower one has to win.
 */
export function isVendorUser(user: AuthUser): boolean {
  return Boolean(user.vendorId);
}

/**
 * Restricts vendor-owned rows to the one vendor the actor belongs to.
 *
 * Internal staff get the tenant filter alone - they are meant to see every
 * vendor. A supplier user gets its own vendorId added, and a supplier user with
 * no vendorId is a misconfiguration that must fail closed: returning the tenant
 * filter there would hand one supplier the entire catalogue of its competitors,
 * which is the single worst outcome this module can produce.
 */
export function vendorScopeFilter(user: AuthUser): { companyId: string; vendorId?: string } {
  const base = tenantFilter(user);
  if (!user.roles.includes('VENDOR')) return base;
  if (!user.vendorId) {
    throw new Error(
      'Vendor user has no vendor linked; refusing to run an unscoped vendor query',
    );
  }
  return { ...base, vendorId: user.vendorId };
}

/**
 * Refuses an external supplier outright (v2.42).
 *
 * For the things a supplier must never reach at all, rather than reach a scoped
 * view of: how its offer scored against a competitor's, and which offer the
 * buyer chose. A permission gate is not enough on its own here, because vendors
 * legitimately hold vendor-products:manage for their own drafts - so the gate
 * that keeps them out of a comparison has to be about who they are, not what
 * they may edit.
 *
 * Checked against the vendor link rather than the role, so an administrator
 * granting a supplier account an extra role cannot open this door.
 */
export function denyVendorUsers(user: AuthUser, what: string): void {
  if (isVendorUser(user) || user.roles.includes('VENDOR')) {
    throw AppError.forbidden(`Vendor users may not ${what}`);
  }
}

/** Restricts assets to what the actor's scope permits. */
export function assetScopeFilter(user: AuthUser): Prisma.AssetWhereInput {
  const base: Prisma.AssetWhereInput = tenantFilter(user);

  switch (user.scope) {
    case 'ALL':
      return base;

    case 'DEPARTMENT':
      // A departmentless user with department scope sees nothing rather than
      // everything - failing open here would be the worst possible default.
      return user.departmentId
        ? { ...base, departmentId: user.departmentId }
        : { ...base, id: { in: [] } };

    case 'DIRECT_REPORTS':
      return {
        ...base,
        OR: [{ assignedUserId: user.id }, { assignedUser: { profile: { managerId: user.id } } }],
      };

    case 'OWN':
    default:
      return { ...base, assignedUserId: user.id };
  }
}

/** Restricts requests to what the actor's scope permits. */
export function requestScopeFilter(user: AuthUser): Prisma.AssetRequestWhereInput {
  const base: Prisma.AssetRequestWhereInput = tenantFilter(user);

  switch (user.scope) {
    case 'ALL':
      return base;

    case 'DEPARTMENT':
      return user.departmentId
        ? { ...base, departmentId: user.departmentId }
        : { ...base, id: { in: [] } };

    case 'DIRECT_REPORTS':
      return {
        ...base,
        OR: [
          { requesterId: user.id },
          { beneficiaryId: user.id },
          { managerId: user.id },
          { requester: { profile: { managerId: user.id } } },
          // v2.24 - the Manager-role fallback. With no line manager recorded,
          // the manager step goes to the Manager role; a scope that then hides
          // those very requests would hand the role an inbox it cannot open.
          // Visibility follows responsibility: only requests from manager-less
          // requesters, and only for Manager-role holders.
          ...(user.roles.includes('MANAGER')
            ? [{ requester: { profile: { managerId: null } } } as const]
            : []),
        ],
      };

    case 'OWN':
    default:
      // Includes requests raised on the employee's behalf by HR, which are theirs
      // to track even though they did not create them.
      return { ...base, OR: [{ requesterId: user.id }, { beneficiaryId: user.id }] };
  }
}

/** Restricts user records to what the actor's scope permits. */
export function userScopeFilter(user: AuthUser): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = tenantFilter(user);

  switch (user.scope) {
    case 'ALL':
      return base;
    case 'DEPARTMENT':
      return user.departmentId
        ? { ...base, profile: { departmentId: user.departmentId } }
        : { ...base, id: { in: [] } };
    case 'DIRECT_REPORTS':
      return { ...base, OR: [{ id: user.id }, { profile: { managerId: user.id } }] };
    case 'OWN':
    default:
      return { ...base, id: user.id };
  }
}

/**
 * True when the actor may see monetary fields. Callers strip cost columns rather
 * than omitting the row, so HR can still manage an asset it may not price
 * (spec section 3).
 */
export function canSeeCost(user: AuthUser): boolean {
  return user.permissions.includes('assets:cost:read');
}

/**
 * True when the actor may see which supplier an asset came from (v2.12).
 *
 * Who sold us the laptop is procurement information, not something the person
 * carrying it needs - the employee-portal audit found vendor names ("Dell
 * Technologies", "Apple Business") reaching employees through the asset list.
 * Gated on the same permission that governs the vendor records themselves, so
 * the answer cannot drift from who may open /vendors.
 */
export function canSeeVendor(user: AuthUser): boolean {
  return user.permissions.includes('vendors:read');
}

/** Removes monetary fields from a payload for actors without cost permission. */
export function redactCost<T extends Record<string, unknown>>(
  user: AuthUser,
  record: T,
  fields: readonly (keyof T)[] = [
    'purchaseCost',
    'currentValue',
    'salvageValue',
    'unitCost',
    'averageCost',
    'estimatedCost',
  ] as readonly (keyof T)[],
): T {
  if (canSeeCost(user)) return record;
  const copy = { ...record };
  for (const field of fields) {
    if (field in copy) delete copy[field];
  }
  return copy;
}
