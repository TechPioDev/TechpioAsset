-- v2.51: stock depth on a supplier's listing.
--
-- Deliberately not the warehouse model. StockLevel keys quantity on an item at
-- a location we own; a supplier's availability is their stock in their
-- building, which we neither hold nor can count. Reusing it would record us as
-- holding things we do not have.
--
-- lowStockThreshold is nullable and means "no low band": inventing a default
-- would put every small supplier permanently in amber.
--
-- The change log is separate from the audit trail because a supplier cannot
-- read that, and this is mostly for them - "you set this to 10 on the 3rd" is
-- the question they actually ask. Append-only.
ALTER TABLE "vendor_products" ADD COLUMN "lowStockThreshold" INTEGER;

CREATE TABLE "vendor_product_stock_changes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vendorProductId" TEXT NOT NULL,
    "previousQuantity" INTEGER NOT NULL,
    "newQuantity" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" TEXT,
    CONSTRAINT "vendor_product_stock_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vendor_product_stock_changes_companyId_vendorProductId_crea_idx" ON "vendor_product_stock_changes"("companyId", "vendorProductId", "createdAt");

ALTER TABLE "vendor_product_stock_changes" ADD CONSTRAINT "vendor_product_stock_changes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendor_product_stock_changes" ADD CONSTRAINT "vendor_product_stock_changes_vendorProductId_fkey" FOREIGN KEY ("vendorProductId") REFERENCES "vendor_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A quantity below zero is meaningless. The contract refuses it at the edge and
-- the domain refuses it again, but neither is the database, and this table is
-- the record everything else is reconciled against.
ALTER TABLE "vendor_products" ADD CONSTRAINT "vendor_products_availableQuantity_nonneg" CHECK ("availableQuantity" >= 0);

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
    GRANT SELECT, INSERT, UPDATE, DELETE ON "vendor_product_stock_changes" TO techpioasset_app;
  END IF;
END $$;
