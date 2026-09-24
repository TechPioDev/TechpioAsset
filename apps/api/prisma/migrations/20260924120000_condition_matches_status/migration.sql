-- Bring the graded condition and the status back into agreement (v2.90).
--
-- Condition is graded by a person at a handover and then left alone, while
-- status changes whenever something happens to the asset. Nothing kept the
-- two in step, so an asset reported damaged kept the grade it was handed out
-- with: the owner's docking station read "Damaged" and "Condition: Good" at
-- the same time and asked which to believe.
--
-- Both directions are now enforced on write (reconcileConditionAndStatus in
-- packages/domain). This repairs the rows written before that existed - the
-- code fix is forward-looking and cannot heal history by itself.
--
-- The rule here is the safe half of that function, and only the safe half:
--
--   A damaged asset is graded damaged. "Damaged" constrains - a broken thing
--   cannot be in service - so this direction is unambiguous.
--
--   A broken grade on an asset still claiming to be in circulation takes it
--   out of service, for the same reason.
--
-- The opposite move is NOT made here: an asset graded Good while its status
-- says Damaged is not returned to service, because "Good" does not name a
-- status and a migration must not decide that a fault was fixed.
--
-- Idempotent: only rows that actually contradict themselves change.

-- Damaged status, a grade that claims otherwise.
UPDATE "assets"
   SET "condition" = 'DAMAGED'
 WHERE "status" = 'DAMAGED'
   AND "condition" IN ('NEW', 'GOOD', 'FAIR');

-- A broken grade on an asset the status still has in circulation.
UPDATE "assets"
   SET "status" = 'DAMAGED'
 WHERE "condition" IN ('DAMAGED', 'UNUSABLE')
   AND "status" IN (
         'AVAILABLE', 'RESERVED', 'ASSIGNED', 'IN_USE',
         'IN_STORAGE', 'RECEIVED', 'RETURNED'
       );

-- The two derived dimensions follow `status`, and the statement above wrote
-- it straight through SQL, so bring them along for any row it moved. Same
-- mapping as 20260922100500_recompute_asset_dimensions.
UPDATE "assets"
   SET "lifecycleState" = 'IN_MAINTENANCE',
       "availabilityState" = 'IN_REPAIR'
 WHERE "status" = 'DAMAGED'
   AND ("lifecycleState" IS DISTINCT FROM 'IN_MAINTENANCE'
        OR "availabilityState" IS DISTINCT FROM 'IN_REPAIR');
