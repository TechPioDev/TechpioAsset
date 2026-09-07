-- Row-Level Security for every tenant table that was missing it (v2.42).
--
-- Ten tables carried a companyId with no tenant_isolation policy: the six from
-- the vendor catalogue, plus agent_enrolment_tokens, approval_delegations,
-- device_agents and request_assessments, which drifted in after the v2.1
-- rollout. The cause is the one the grant-sync migration exists for: policies
-- are applied once to the tables that exist that day, and nothing revisits
-- them. A table added later ships uncovered and nothing says so.
--
-- Not a leak in any of those cases - every query goes through tenantFilter -
-- but the database-level backstop is the thing that holds when a query does
-- not, which is the entire point of having it.
--
-- Driven off "has a companyId column and lacks the policy" rather than a hand
-- written list, so it cannot disagree with the schema it is fixing. The
-- policy body is copied verbatim from 20260803154535_rls_policy_empty_guc:
-- NULLIF treats an empty GUC as unset, because a pooled connection resets the
-- parameter to '' rather than NULL and the older IS NULL form then blocked
-- every row for GUC-less work.
--
-- FORCE so the table owner is subject too; permissive while the GUC is unset,
-- which is what lets the platform plane and background jobs keep working.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE c.relkind = 'r'
       AND EXISTS (
             SELECT 1 FROM information_schema.columns col
              WHERE col.table_schema = 'public'
                AND col.table_name = c.relname
                AND col.column_name = 'companyId')
       AND NOT EXISTS (
             SELECT 1 FROM pg_policies p
              WHERE p.schemaname = 'public'
                AND p.tablename = c.relname
                AND p.policyname = 'tenant_isolation')
     ORDER BY c.relname
  LOOP
    RAISE NOTICE 'Adding tenant_isolation to %', r.tablename;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.tablename);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I '
      || 'USING (NULLIF(current_setting(''app.tenant_id'', true), '''') IS NULL '
      || 'OR "companyId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (NULLIF(current_setting(''app.tenant_id'', true), '''') IS NULL '
      || 'OR "companyId" = current_setting(''app.tenant_id'', true))',
      r.tablename);
  END LOOP;
END $$;

-- A table that has the policy but never had RLS switched on is a policy nobody
-- enforces - the most misleading state of the three, because pg_policies looks
-- right. Catch it in the same pass.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM pg_policies p
                    WHERE p.schemaname = 'public' AND p.tablename = c.relname
                      AND p.policyname = 'tenant_isolation')
       AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  LOOP
    RAISE NOTICE 'Enabling/forcing RLS on %', r.tablename;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
