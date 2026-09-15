'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { AuthUser } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';

/**
 * Client-side route guard (v2.12 employee-portal audit).
 *
 * The API is, and remains, the authority: every endpoint enforces its own
 * permission and OWN-scope filter, so no data is exposed regardless of this
 * file. What this closes is a *presentational* gap the audit found — typing
 * `/people` or `/assets` as an employee rendered the module's chrome (filters,
 * column headers, the role-name dropdown) over empty data. The principle is
 * "employees should never know these modules exist", so a page they may not
 * use should never paint. Pages that already self-guard (roles, settings)
 * still do; this is the safety net for the ones that did not.
 *
 * Matching is deliberate about list-vs-detail: an employee is blocked from the
 * `/assets` LIST but must still reach `/assets/:id` for their own device (the
 * API returns 404 for anyone else's), so the assets/procurement rules are
 * exact-or-sub-section, not blanket prefix.
 */

interface GuardRule {
  /** True when this rule governs the given path. */
  matches: (path: string) => boolean;
  /** True when the user is allowed to see it. */
  allow: (user: AuthUser, can: (p: string) => boolean) => boolean;
}

const P = PERMISSIONS;
const startsWith = (prefix: string) => (path: string) =>
  path === prefix || path.startsWith(`${prefix}/`);

const RULES: GuardRule[] = [
  // Module list pages: hidden from OWN-scope users even though they may hold
  // the read permission. Exact match on the index so /assets/:id (own-device
  // detail) and /assets/new stay reachable per their own rules below.
  { matches: (p) => p === '/assets', allow: (u, can) => u.scope !== 'OWN' && can(P.ASSETS_READ) },
  {
    matches: (p) => p === '/assets/new',
    allow: (_u, can) => can(P.ASSETS_CREATE),
  },
  {
    matches: (p) => p === '/assets/price-sheet',
    allow: (_u, can) => can(P.ASSETS_COST_READ) && (can(P.ASSETS_IMPORT) || can(P.ASSETS_UPDATE)),
  },
  {
    matches: startsWith('/procurement'),
    allow: (u, can) => u.scope !== 'OWN' && can(P.PROCUREMENT_PR_READ),
  },
  // Straightforward permission-gated modules.
  { matches: startsWith('/inventory'), allow: (_u, can) => can(P.INVENTORY_READ) },
  { matches: startsWith('/budgets'), allow: (_u, can) => can(P.ASSETS_COST_READ) },
  { matches: startsWith('/invoices'), allow: (_u, can) => can(P.INVOICES_READ) },
  { matches: startsWith('/licenses'), allow: (_u, can) => can(P.LICENSES_READ) },
  { matches: startsWith('/maintenance'), allow: (_u, can) => can(P.MAINTENANCE_READ) },
  { matches: startsWith('/discovery'), allow: (_u, can) => can(P.DISCOVERY_READ) },
  { matches: startsWith('/analytics'), allow: (_u, can) => can(P.ANALYTICS_READ) },
  { matches: startsWith('/reports'), allow: (_u, can) => can(P.REPORTS_READ) },
  // Role, not permission: the expense report is Super Admin only, and Finance
  // holds every cost permission (the API enforces the same on the role).
  { matches: startsWith('/expenses'), allow: (u) => Boolean(u.roles?.includes('SUPER_ADMIN')) },
  { matches: startsWith('/audit'), allow: (_u, can) => can(P.AUDIT_READ) },
  { matches: startsWith('/people'), allow: (_u, can) => can(P.EMPLOYEES_READ) },
  { matches: startsWith('/settings/offices'), allow: (_u, can) => can(P.SETTINGS_MANAGE) },
  { matches: startsWith('/settings/vendors'), allow: (_u, can) => can(P.VENDORS_MANAGE) },
  { matches: startsWith('/settings/roles'), allow: (_u, can) => can(P.ROLES_MANAGE) },
  { matches: startsWith('/settings/integrations'), allow: (_u, can) => can(P.INTEGRATIONS_MANAGE) },
  { matches: startsWith('/settings/ai'), allow: (_u, can) => can(P.AI_CONFIGURE) },
  { matches: startsWith('/platform'), allow: (u) => Boolean(u.platformAdmin) },
];

/** Returns true when the user may view the path (no matching rule = allowed). */
export function canViewRoute(path: string, user: AuthUser, can: (p: string) => boolean): boolean {
  const rule = RULES.find((r) => r.matches(path));
  return rule ? rule.allow(user, can) : true;
}

/**
 * Redirects to the dashboard the moment a forbidden path is reached, so the
 * blocked page never paints. Renders nothing itself.
 */
export function RouteGuard({
  user,
  can,
}: {
  user: AuthUser;
  can: (...perms: string[]) => boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const allowed = canViewRoute(pathname, user, (p) => can(p));

  useEffect(() => {
    if (!allowed) router.replace('/dashboard');
  }, [allowed, router]);

  return null;
}
