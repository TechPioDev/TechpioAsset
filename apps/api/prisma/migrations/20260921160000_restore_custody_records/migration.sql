-- Restore the custody record of every held asset that has none (v2.74).
--
-- `assets.assignedUserId` names the holder; the open row in `asset_assignments`
-- is the handover itself - what a return closes and a hand-over moves. Both
-- importers set the holder and never wrote the row, so on the live register 97
-- of 163 held assets (nearly every imported accessory) showed "Assigned to ..."
-- while Record return answered "This asset has no open assignment to return".
-- The owner hit it while offboarding somebody.
--
-- The code now writes the row at import and heals a missing one on return or
-- hand-over (src/assets/custody-record.ts). This repairs the rows already there
-- in one go, so handover receipts, condition photos and offboarding all work
-- without each asset having to be touched first.
--
-- What is written, and what is deliberately not:
--   - assignedAt is the asset's own assignmentDate, else the day it was created
--     (the import date) - the best the register knows;
--   - conditionOut is the asset's current condition;
--   - acknowledgedAt stays NULL: nobody confirmed receipt, because nobody was
--     asked. acknowledgementMethod = 'IMPORT_BACKFILL' marks the row so the
--     receipt-reminder sweep skips it - no holder is emailed by this repair;
--   - an asset that names a holder but is AVAILABLE (or any status outside
--     custody) is left alone: that is a different inconsistency, for a person
--     to look at, not for a script to paper over.
--
-- Idempotent: an asset that already has an open assignment is never touched,
-- so a re-run writes nothing. Adds rows only; changes and deletes none.

INSERT INTO "asset_assignments" (
  "id", "assetId", "userId", "assignedById", "assignedAt", "conditionOut",
  "notes", "acknowledgementMethod", "createdAt", "updatedAt"
)
SELECT
  'asg_' || replace(gen_random_uuid()::text, '-', ''),
  a."id",
  a."assignedUserId",
  NULL,
  COALESCE(a."assignmentDate", a."createdAt"),
  a."condition",
  'Recorded from the imported register. No handover was captured in PioAssets, so the holder was never asked to confirm receipt.',
  'IMPORT_BACKFILL',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "assets" a
WHERE a."deletedAt" IS NULL
  AND a."assignedUserId" IS NOT NULL
  AND a."status" IN ('ASSIGNED', 'IN_USE', 'UNDER_REPAIR', 'DAMAGED')
  AND NOT EXISTS (
        SELECT 1 FROM "asset_assignments" x
         WHERE x."assetId" = a."id" AND x."returnedAt" IS NULL
      );
