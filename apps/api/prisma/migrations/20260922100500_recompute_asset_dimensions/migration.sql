-- Bring the two derived status dimensions back in step with `status` (v2.76).
--
-- The list's "In stock / Available / Deployed" pills read lifecycleState and
-- availabilityState, which the Prisma client derives from `status` on every
-- write through it. Writes that bypass the client - the accessories import
-- script, hand repairs in SQL - leave them stale or NULL: the owner saw a
-- Thinkpad "Assigned" to somebody with "In stock · Available" beside it, and
-- 87 imported accessories carried no dimensions at all.
--
-- The mapping is LEGACY_MAP in packages/domain/src/asset-dimensions.ts, copied
-- here exactly. Condition and ownership are orthogonal and are not touched.
-- Idempotent: only rows whose dimensions differ from the derivation change.
UPDATE "assets"
   SET "lifecycleState" = (CASE "status"
         WHEN 'DRAFT'        THEN 'PLANNED'
         WHEN 'REQUESTED'    THEN 'IN_PROCUREMENT'
         WHEN 'ORDERED'      THEN 'IN_PROCUREMENT'
         WHEN 'RECEIVED'     THEN 'IN_STOCK'
         WHEN 'AVAILABLE'    THEN 'IN_STOCK'
         WHEN 'RESERVED'     THEN 'IN_STOCK'
         WHEN 'ASSIGNED'     THEN 'DEPLOYED'
         WHEN 'IN_USE'       THEN 'DEPLOYED'
         WHEN 'IN_STORAGE'   THEN 'IN_STOCK'
         WHEN 'IN_TRANSIT'   THEN 'DEPLOYED'
         WHEN 'UNDER_REPAIR' THEN 'IN_MAINTENANCE'
         WHEN 'DAMAGED'      THEN 'IN_MAINTENANCE'
         WHEN 'LOST'         THEN 'DEPLOYED'
         WHEN 'STOLEN'       THEN 'DEPLOYED'
         WHEN 'RETURNED'     THEN 'IN_STOCK'
         WHEN 'RETIRED'      THEN 'RETIRED'
         WHEN 'DISPOSED'     THEN 'DISPOSED'
         WHEN 'DONATED'      THEN 'DISPOSED'
       END)::"LifecycleState",
       "availabilityState" = (CASE "status"
         WHEN 'DRAFT'        THEN 'AVAILABLE'
         WHEN 'REQUESTED'    THEN 'RESERVED'
         WHEN 'ORDERED'      THEN 'RESERVED'
         WHEN 'RECEIVED'     THEN 'AVAILABLE'
         WHEN 'AVAILABLE'    THEN 'AVAILABLE'
         WHEN 'RESERVED'     THEN 'RESERVED'
         WHEN 'ASSIGNED'     THEN 'ASSIGNED'
         WHEN 'IN_USE'       THEN 'ASSIGNED'
         WHEN 'IN_STORAGE'   THEN 'AVAILABLE'
         WHEN 'IN_TRANSIT'   THEN 'IN_TRANSIT'
         WHEN 'UNDER_REPAIR' THEN 'IN_REPAIR'
         WHEN 'DAMAGED'      THEN 'IN_REPAIR'
         WHEN 'LOST'         THEN 'LOST'
         WHEN 'STOLEN'       THEN 'LOST'
         WHEN 'RETURNED'     THEN 'AVAILABLE'
         WHEN 'RETIRED'      THEN 'AVAILABLE'
         WHEN 'DISPOSED'     THEN 'AVAILABLE'
         WHEN 'DONATED'      THEN 'AVAILABLE'
       END)::"AvailabilityState"
 WHERE "deletedAt" IS NULL
   AND (
     "lifecycleState" IS DISTINCT FROM (CASE "status"
         WHEN 'DRAFT' THEN 'PLANNED' WHEN 'REQUESTED' THEN 'IN_PROCUREMENT' WHEN 'ORDERED' THEN 'IN_PROCUREMENT'
         WHEN 'RECEIVED' THEN 'IN_STOCK' WHEN 'AVAILABLE' THEN 'IN_STOCK' WHEN 'RESERVED' THEN 'IN_STOCK'
         WHEN 'ASSIGNED' THEN 'DEPLOYED' WHEN 'IN_USE' THEN 'DEPLOYED' WHEN 'IN_STORAGE' THEN 'IN_STOCK'
         WHEN 'IN_TRANSIT' THEN 'DEPLOYED' WHEN 'UNDER_REPAIR' THEN 'IN_MAINTENANCE' WHEN 'DAMAGED' THEN 'IN_MAINTENANCE'
         WHEN 'LOST' THEN 'DEPLOYED' WHEN 'STOLEN' THEN 'DEPLOYED' WHEN 'RETURNED' THEN 'IN_STOCK'
         WHEN 'RETIRED' THEN 'RETIRED' WHEN 'DISPOSED' THEN 'DISPOSED' WHEN 'DONATED' THEN 'DISPOSED'
       END)::"LifecycleState"
     OR "availabilityState" IS DISTINCT FROM (CASE "status"
         WHEN 'DRAFT' THEN 'AVAILABLE' WHEN 'REQUESTED' THEN 'RESERVED' WHEN 'ORDERED' THEN 'RESERVED'
         WHEN 'RECEIVED' THEN 'AVAILABLE' WHEN 'AVAILABLE' THEN 'AVAILABLE' WHEN 'RESERVED' THEN 'RESERVED'
         WHEN 'ASSIGNED' THEN 'ASSIGNED' WHEN 'IN_USE' THEN 'ASSIGNED' WHEN 'IN_STORAGE' THEN 'AVAILABLE'
         WHEN 'IN_TRANSIT' THEN 'IN_TRANSIT' WHEN 'UNDER_REPAIR' THEN 'IN_REPAIR' WHEN 'DAMAGED' THEN 'IN_REPAIR'
         WHEN 'LOST' THEN 'LOST' WHEN 'STOLEN' THEN 'LOST' WHEN 'RETURNED' THEN 'AVAILABLE'
         WHEN 'RETIRED' THEN 'AVAILABLE' WHEN 'DISPOSED' THEN 'AVAILABLE' WHEN 'DONATED' THEN 'AVAILABLE'
       END)::"AvailabilityState"
   );
