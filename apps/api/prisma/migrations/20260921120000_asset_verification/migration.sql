-- Physical verification of assets (v2.72).
--
-- The owner asked for a verification round on the phone: walk the floor, scan
-- each label, and see "142 of 168 verified". That needs somewhere to record
-- "this unit was seen, by whom, when". One row per confirmation; the asset
-- itself is not changed, so nothing that reads assets today reads differently.
--
-- Additive only: a new table, no column added to or removed from any existing
-- one. An API that does not know the table simply never touches it.

CREATE TABLE "asset_verifications" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT,
    "method" TEXT NOT NULL DEFAULT 'SCAN',
    "note" TEXT,
    CONSTRAINT "asset_verifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "asset_verifications_companyId_verifiedAt_idx" ON "asset_verifications"("companyId", "verifiedAt");
CREATE INDEX "asset_verifications_assetId_verifiedAt_idx" ON "asset_verifications"("assetId", "verifiedAt");

ALTER TABLE "asset_verifications" ADD CONSTRAINT "asset_verifications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_verifications" ADD CONSTRAINT "asset_verifications_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_verifications" ADD CONSTRAINT "asset_verifications_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant isolation, by the same rule that covers every other tenant table.
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

-- The runtime role's privileges. RLS decides which rows; a GRANT decides
-- whether the role may see the table at all, and production connects as
-- techpioasset_app.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'techpioasset_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "asset_verifications" TO techpioasset_app;
  END IF;
END $$;
