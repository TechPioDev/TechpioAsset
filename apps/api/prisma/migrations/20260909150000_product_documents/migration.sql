-- v2.49: the paperwork a product comes with.
--
-- Datasheets, manuals, compliance certificates. PDF and images only - see the
-- note in packages/domain/src/product-documents.ts for why an Office file from
-- a supplier is not accepted.
CREATE TYPE "ProductDocumentKind" AS ENUM ('DATASHEET', 'USER_MANUAL', 'WARRANTY', 'BROCHURE', 'COMPLIANCE_CERTIFICATE', 'TECHNICAL_SPECIFICATION', 'INSTALLATION_GUIDE', 'OTHER');

CREATE TABLE "vendor_product_documents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vendorProductId" TEXT NOT NULL,
    "kind" "ProductDocumentKind" NOT NULL,
    "title" TEXT,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "uploadedById" TEXT,
    CONSTRAINT "vendor_product_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vendor_product_documents_companyId_vendorProductId_idx" ON "vendor_product_documents"("companyId", "vendorProductId");

ALTER TABLE "vendor_product_documents" ADD CONSTRAINT "vendor_product_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendor_product_documents" ADD CONSTRAINT "vendor_product_documents_vendorProductId_fkey" FOREIGN KEY ("vendorProductId") REFERENCES "vendor_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, by the same rule that covers every other tenant table
-- rather than a policy written out by hand here. A new table shipping without
-- it is exactly the drift 20260906022856_rls_all_tenant_tables existed to fix,
-- and the coverage test would fail on this table if this block were left out.
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

-- The runtime role's privileges on the new table.
--
-- RLS decides which rows; a GRANT decides whether the role may look at the
-- table at all, and they are separate. Production connects as techpioasset_app,
-- which is NOSUPERUSER and NOBYPASSRLS, so without this every query against
-- this table would fail with "permission denied" - the policy above would never
-- even be consulted. Guarded on the role existing, because a developer database
-- has only the owner.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'techpioasset_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "vendor_product_documents" TO techpioasset_app;
  END IF;
END $$;
