-- CreateTable
CREATE TABLE "vendor_proposed_specs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vendorProductId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_proposed_specs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_proposed_specs_companyId_normalizedKey_idx" ON "vendor_proposed_specs"("companyId", "normalizedKey");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_proposed_specs_vendorProductId_normalizedKey_key" ON "vendor_proposed_specs"("vendorProductId", "normalizedKey");

-- AddForeignKey
ALTER TABLE "vendor_proposed_specs" ADD CONSTRAINT "vendor_proposed_specs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_proposed_specs" ADD CONSTRAINT "vendor_proposed_specs_vendorProductId_fkey" FOREIGN KEY ("vendorProductId") REFERENCES "vendor_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tenant isolation, same as every other table carrying a companyId. The
-- coverage test fails the build without it.
ALTER TABLE "vendor_proposed_specs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vendor_proposed_specs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "vendor_proposed_specs";
CREATE POLICY tenant_isolation ON "vendor_proposed_specs"
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR "companyId" = current_setting('app.tenant_id', true))
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR "companyId" = current_setting('app.tenant_id', true));
