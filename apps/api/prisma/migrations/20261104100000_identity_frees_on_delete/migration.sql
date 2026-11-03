-- A deleted asset no longer reserves its identity (v3.16).
--
-- The owner tried to register a webcam and was refused with "A record with
-- these values already exists" - the tag was on another asset. The same
-- refusal also came from assets that had been DELETED: the unique indexes
-- covered every row, so a tag or serial on a record removed as a mistake
-- could never be used again, and nothing on screen could say why.
--
-- The four identity indexes become partial: unique among live rows only.
-- Soft-deleted rows keep their values (the history still names them) but no
-- longer collide with anything. Named with the column so the API's fallback
-- message can still tell which value clashed.
DROP INDEX IF EXISTS "assets_companyId_assetTag_key";
DROP INDEX IF EXISTS "assets_companyId_serialNumber_key";
DROP INDEX IF EXISTS "assets_companyId_macAddress_key";
DROP INDEX IF EXISTS "assets_companyId_imei_key";

CREATE UNIQUE INDEX "assets_companyId_assetTag_live_key"
  ON "assets" ("companyId", "assetTag")
  WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "assets_companyId_serialNumber_live_key"
  ON "assets" ("companyId", "serialNumber")
  WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "assets_companyId_macAddress_live_key"
  ON "assets" ("companyId", "macAddress")
  WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "assets_companyId_imei_live_key"
  ON "assets" ("companyId", "imei")
  WHERE "deletedAt" IS NULL;

-- Lookups by tag and serial used the unique indexes; deleted rows are read
-- by audit and recovery, so keep a plain index over every row for them.
CREATE INDEX IF NOT EXISTS "assets_companyId_assetTag_idx" ON "assets" ("companyId", "assetTag");
CREATE INDEX IF NOT EXISTS "assets_companyId_serialNumber_idx" ON "assets" ("companyId", "serialNumber");
