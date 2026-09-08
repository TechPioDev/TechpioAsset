-- v2.47: close the vendor -> product -> order -> asset chain.
--
-- An asset recorded which supplier it came from but not which of that
-- supplier's listings, and an order line described what was being bought in
-- free text. So "how many units of this product do we own" and "which listing
-- did this laptop come from" were both unanswerable.
--
-- Both columns are nullable: assets and orders predate the link, and plenty of
-- assets arrive outside procurement entirely - an import, a donation, a thing
-- found in a cupboard. Nothing is backfilled, because the association would be
-- a guess from brand and model, and a guessed provenance is worse than an
-- honest blank.
--
-- ON DELETE RESTRICT is deliberate: a product with physical units behind it can
-- be archived but never removed.
ALTER TABLE "assets" ADD COLUMN "vendorProductId" TEXT;
ALTER TABLE "purchase_order_lines" ADD COLUMN "vendorProductId" TEXT;

CREATE INDEX "assets_companyId_vendorProductId_idx" ON "assets"("companyId", "vendorProductId");

ALTER TABLE "assets" ADD CONSTRAINT "assets_vendorProductId_fkey"
  FOREIGN KEY ("vendorProductId") REFERENCES "vendor_products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_vendorProductId_fkey"
  FOREIGN KEY ("vendorProductId") REFERENCES "vendor_products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
