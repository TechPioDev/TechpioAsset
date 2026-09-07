import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_DEFAULT_SCOPE } from '@techpioasset/domain';

/**
 * A supplier can reach the catalogue (v2.44).
 *
 * This exists because it shipped broken and looked fine. The Catalogue nav
 * entry was marked ownScopeHidden - a flag meant to keep company-shaped modules
 * away from employees - and a supplier's scope is OWN. So the one page a vendor
 * account exists to use was hidden from vendor accounts, with the comment
 * "it is the one page a vendor account needs" directly above the flag that hid
 * it. Nothing failed; the link was simply absent.
 *
 * The permission is gate enough on its own, and the first test is what proves
 * that: no OWN-scope role except the supplier holds it.
 */

const shell = readFileSync(join(process.cwd(), 'src/components/app-shell.tsx'), 'utf8');

/**
 * The nav entry block for a given href, with comments stripped.
 *
 * Stripped because the entry carries a comment explaining why the flag is
 * absent, and a comment about a thing is not the thing.
 */
function navEntry(href: string): string {
  const marker = `href: '${href}'`;
  const start = shell.indexOf(marker);
  expect(start, `no nav entry for ${href}`).toBeGreaterThan(-1);
  const end = shell.indexOf('},', start);
  return shell
    .slice(start, end)
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('the catalogue is reachable by the accounts that need it', () => {
  it('is not hidden from OWN-scope users, because suppliers are OWN-scope', () => {
    expect(ROLE_DEFAULT_SCOPE.VENDOR, 'a supplier sees only its own records').toBe('OWN');
    expect(
      navEntry('/catalogue'),
      'ownScopeHidden on the catalogue hides it from the only role that must see it',
    ).not.toContain('ownScopeHidden');
  });

  it('is gated on the catalogue permission, which is enough on its own', () => {
    expect(navEntry('/catalogue')).toContain('VENDOR_PRODUCTS_READ');
  });

  it('is held by no other OWN-scope role, so the permission alone is safe', () => {
    // If an OWN-scope role ever gains catalogue read, this fails and the nav
    // needs rethinking rather than silently showing them supplier pricing.
    const ownScopeRoles = (Object.keys(ROLE_DEFAULT_SCOPE) as (keyof typeof ROLE_DEFAULT_SCOPE)[]).filter(
      (role) => ROLE_DEFAULT_SCOPE[role] === 'OWN' && role !== 'VENDOR',
    );
    const holders = ownScopeRoles.filter((role) =>
      (ROLE_PERMISSIONS[role] as readonly string[]).includes(PERMISSIONS.VENDOR_PRODUCTS_READ),
    );
    expect(holders).toEqual([]);
  });

  it('gives a supplier catalogue actions rather than "confirm your equipment"', () => {
    const dashboard = readFileSync(join(process.cwd(), 'src/app/(app)/dashboard/page.tsx'), 'utf8');
    expect(dashboard).toContain('VENDOR_QUICK_ACTIONS');
    // A supplier has no kit to confirm, so that copy must be behind the check.
    expect(dashboard).toContain('isVendor');
  });
});
