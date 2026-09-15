-- Company contact details for report letterheads (expense PDF and Excel).
-- Additive: nullable, no default, so no existing row is rewritten.
ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "contactPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "contactEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT;
