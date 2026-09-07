import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { ROLE_LABELS, ROLE_PERMISSIONS, SYSTEM_ROLES } from '@techpioasset/domain';

/**
 * Every tenant has every system role, and each holds what the matrix grants.
 *
 * This exists because the gap it closes was silent and shipped. Roles are rows
 * copied when a tenant is created, so a role added to the matrix afterwards
 * simply never appears for anybody already running. The vendor portal went out
 * that way: all six permissions present in the database, the Vendor role that
 * was meant to hold them missing entirely, and nothing anywhere saying so - the
 * grant sync only ever synced grants onto roles that already existed.
 *
 * The checks derive from the domain matrix rather than a list somebody has to
 * remember to update, so a role added tomorrow fails here until a migration
 * creates it for existing tenants.
 */

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe('system roles reach every tenant', () => {
  it('gives every company every system role', async () => {
    const companies = await prisma.company.count();
    expect(companies, 'no companies to check').toBeGreaterThan(0);

    const counts = await prisma.role.groupBy({
      by: ['key'],
      where: { key: { in: [...SYSTEM_ROLES] }, deletedAt: null },
      _count: { key: true },
    });
    const found = new Map(counts.map((c) => [c.key, c._count.key]));

    const short = SYSTEM_ROLES.filter((role) => (found.get(role) ?? 0) < companies).map(
      (role) => `${role} (${found.get(role) ?? 0}/${companies} tenants)`,
    );
    expect(
      short,
      `These system roles are missing from some tenants. Regenerate the grant-sync migration:\n  ${short.join('\n  ')}`,
    ).toEqual([]);
  });

  it('gives the Vendor role exactly the portal permissions, and no review', async () => {
    // Named because it is the one that shipped wrong, and because the grant it
    // must NOT hold is the interesting half: a supplier reviewing offers would
    // be marking its own homework.
    const roles = await prisma.role.findMany({
      where: { key: 'VENDOR', deletedAt: null },
      select: { companyId: true, permissions: { select: { permission: { select: { key: true } } } } },
    });
    expect(roles.length, 'no Vendor roles exist at all').toBeGreaterThan(0);

    const expected = [...ROLE_PERMISSIONS.VENDOR].sort();
    for (const role of roles) {
      const held = role.permissions.map((p) => p.permission.key).sort();
      expect(held, `Vendor role in company ${role.companyId}`).toEqual(expected);
      expect(held, 'a vendor must never review offers').not.toContain('vendor-products:review');
    }
  });

  it('names roles the way the seed would', async () => {
    // A role created by the sync migration and one created by the seed must be
    // indistinguishable, or tenants drift apart in the roles screen.
    const roles = await prisma.role.findMany({
      where: { key: { in: [...SYSTEM_ROLES] }, deletedAt: null },
      select: { key: true, name: true, isSystem: true },
      take: 2000,
    });
    const wrong = roles
      .filter((r) => r.name !== ROLE_LABELS[r.key as keyof typeof ROLE_LABELS]?.name || !r.isSystem)
      .map((r) => `${r.key} named "${r.name}"`);
    expect([...new Set(wrong)]).toEqual([]);
  });
});
