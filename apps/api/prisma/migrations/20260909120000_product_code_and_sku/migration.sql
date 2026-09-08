-- v2.48: a readable identifier per listing, and a supplier SKU that means something.
--
-- productCode is ours: LAP-DELL-5420-001, unique per company, assigned on
-- creation. Nullable only because listings existed before it did; production
-- held none when this shipped, so every listing there has one from the start.
--
-- vendorSku is the supplier's own and is unique WITHIN that supplier, not across
-- the catalogue - two vendors may both call a thing "5420" and neither is wrong.
-- Postgres treats nulls as distinct, so the listings without a SKU do not
-- collide with each other.
ALTER TABLE "vendor_products" ADD COLUMN "productCode" TEXT;

CREATE UNIQUE INDEX "vendor_products_companyId_productCode_key"
  ON "vendor_products"("companyId", "productCode");

CREATE UNIQUE INDEX "vendor_products_companyId_vendorId_vendorSku_key"
  ON "vendor_products"("companyId", "vendorId", "vendorSku");
