import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuthUser } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { canViewRoute } from './route-guard';

/**
 * The expense report is Super Admin only (v2.59).
 *
 * Gated on the ROLE, not a permission, because Finance holds every cost
 * permission and must still not see it. These pin the three places the web
 * enforces that presentationally - route guard, sidebar, dashboard shortcut -
 * so a later "tidy-up" onto a permission cannot quietly open it to Finance.
 * The API enforces the same rule regardless.
 */

const ALL = Object.values(PERMISSIONS) as string[];
const userWith = (roles: string[]): AuthUser =>
  ({ id: 'u1', email: 'x@example.com', roles, permissions: ALL, scope: 'ALL' }) as unknown as AuthUser;
const canAll = () => true;

describe('the expenses page is Super Admin only', () => {
  it('lets a Super Admin through the route guard', () => {
    expect(canViewRoute('/expenses', userWith(['SUPER_ADMIN']), canAll)).toBe(true);
  });

  it('turns away every other role, even holding every permission', () => {
    for (const roles of [['FINANCE'], ['IT_MANAGER'], ['AUDITOR'], []]) {
      expect(canViewRoute('/expenses', userWith(roles), canAll), roles.join(',')).toBe(false);
    }
  });

  it('shows the sidebar entry by role, with no permission that Finance could satisfy', () => {
    const shell = readFileSync(join(process.cwd(), 'src/components/app-shell.tsx'), 'utf8');
    const start = shell.indexOf("href: '/expenses'");
    expect(start, 'no nav entry for /expenses').toBeGreaterThan(-1);
    const entry = shell.slice(start, shell.indexOf('}', start));
    expect(entry).toContain("roles: ['SUPER_ADMIN']");
    expect(entry).not.toContain('permission');
    // The filter must actually read the roles field.
    expect(shell).toMatch(/!i\.roles \|\| i\.roles\.some/);
  });

  it('offers the dashboard shortcut only to a Super Admin', () => {
    const dashboard = readFileSync(join(process.cwd(), 'src/app/(app)/dashboard/page.tsx'), 'utf8');
    const start = dashboard.indexOf("href: '/expenses'");
    expect(start).toBeGreaterThan(-1);
    expect(dashboard.slice(start, dashboard.indexOf('},', start))).toContain("role: 'SUPER_ADMIN'");
  });
});
