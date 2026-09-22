-- v2.82 (Phase 6): handovers, returns and stock counts recorded with no signal.
--
-- One row per offline change the server applied (or found already done),
-- keyed by the phone's own id, so a retried upload is recognised and never
-- applied twice. Additive only: a new table, nothing existing changes.

CREATE TABLE "offline_operation_receipts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "clientGeneratedId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "serverId" TEXT,
    "message" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "offline_operation_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "offline_operation_receipts_clientGeneratedId_key" ON "offline_operation_receipts"("clientGeneratedId");
CREATE INDEX "offline_operation_receipts_companyId_createdAt_idx" ON "offline_operation_receipts"("companyId", "createdAt");

ALTER TABLE "offline_operation_receipts" ADD CONSTRAINT "offline_operation_receipts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON "offline_operation_receipts" TO techpioasset_app;
  END IF;
END $$;
