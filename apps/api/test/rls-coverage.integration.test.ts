import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Every tenant table is covered by the RLS backstop (v2.42).
 *
 * This test exists because the gap it closes was invisible. Policies were
 * applied to the tables that existed on the day of the v2.1 rollout, and
 * nothing revisited them - so four tables (agent_enrolment_tokens,
 * approval_delegations, device_agents, request_assessments) drifted in
 * uncovered, and six more arrived with the vendor catalogue. Nothing failed,
 * nothing warned, and pg_policies looked healthy because it only lists what is
 * there.
 *
 * It is the same lesson as the role grants: a rule applied once to whatever
 * exists that day is not a rule, it is a snapshot. So the check is derived from
 * the schema rather than from a list somebody has to remember to update - a new
 * table with a companyId fails here the day it is added.
 *
 * Three things have to be true, and the third is the one that looks fine when
 * it is wrong: a policy on a table without RLS enabled is a policy nobody
 * enforces.
 */

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

interface TableRow {
  relname: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  has_policy: boolean;
}

async function tenantTables(): Promise<TableRow[]> {
  return prisma.$queryRaw<TableRow[]>`
    SELECT c.relname,
           c.relrowsecurity      AS rls_enabled,
           c.relforcerowsecurity AS rls_forced,
           EXISTS (SELECT 1 FROM pg_policies p
                    WHERE p.schemaname = 'public'
                      AND p.tablename = c.relname
                      AND p.policyname = 'tenant_isolation') AS has_policy
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema = 'public'
                      AND col.table_name = c.relname
                      AND col.column_name = 'companyId')
     ORDER BY c.relname`;
}

describe('RLS covers every tenant table', () => {
  it('finds tenant tables to check at all', async () => {
    // Guards the guard: a query that silently matched nothing would pass every
    // assertion below and prove nothing.
    const tables = await tenantTables();
    expect(tables.length).toBeGreaterThan(40);
  });

  it('has a tenant_isolation policy on each one', async () => {
    const missing = (await tenantTables()).filter((t) => !t.has_policy).map((t) => t.relname);
    expect(
      missing,
      `These tables carry a companyId but have no tenant_isolation policy. Add them to an RLS migration:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('has row level security switched on, not merely a policy written', async () => {
    const off = (await tenantTables()).filter((t) => !t.rls_enabled).map((t) => t.relname);
    expect(off, `Policy present but RLS disabled - it enforces nothing:\n  ${off.join('\n  ')}`).toEqual(
      [],
    );
  });

  it('forces it, so the table owner is subject too', async () => {
    // Without FORCE, anything connecting as the owner - a migration, a script,
    // a mistake in the connection string - bypasses the backstop entirely.
    const unforced = (await tenantTables()).filter((t) => !t.rls_forced).map((t) => t.relname);
    expect(unforced, `RLS not FORCEd, so the owner bypasses it:\n  ${unforced.join('\n  ')}`).toEqual([]);
  });

  it('covers the vendor catalogue tables specifically', async () => {
    // Named rather than left to the sweep above: these are the ones that
    // carry another supplier's prices, which is the leak that would matter most.
    const byName = new Map((await tenantTables()).map((t) => [t.relname, t]));
    for (const table of [
      'vendor_products',
      'vendor_product_images',
      'vendor_product_reviews',
      'procurement_selections',
      'category_spec_fields',
      'quality_checks',
    ]) {
      const row = byName.get(table);
      expect(row, `${table} is missing or has no companyId`).toBeDefined();
      expect(row!.has_policy, `${table} has no tenant_isolation policy`).toBe(true);
      expect(row!.rls_enabled, `${table} has RLS disabled`).toBe(true);
      expect(row!.rls_forced, `${table} does not FORCE RLS`).toBe(true);
    }
  });
});
