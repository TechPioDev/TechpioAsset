-- Assets that have left service (v3.13).
--
-- 1. Retired, disposed and donated assets no longer claim to be available.
--
-- The status map gave all three an availability of AVAILABLE, so every
-- scrapped laptop was stored as available to hand out and the asset list
-- showed "Disposed" and "Available" on the same row. The map now gives them
-- none; this brings the rows already written into line. Only the derived
-- column changes - status, history and every other field are untouched.
UPDATE "assets"
SET "availabilityState" = NULL
WHERE "status" IN ('RETIRED', 'DISPOSED', 'DONATED')
  AND "availabilityState" IS NOT NULL;

-- 2. Fleet snapshots say whether their total included disposed assets.
--
-- From now on the dashboard's total leaves out disposed and donated assets,
-- and so does the nightly snapshot. Every row written before this counted
-- them, so those rows are marked false, and the trend compares only rows that
-- counted the same thing. Nothing is deleted.
ALTER TABLE "fleet_snapshots" ADD COLUMN "excludesDisposed" BOOLEAN NOT NULL DEFAULT true;
UPDATE "fleet_snapshots" SET "excludesDisposed" = false;
