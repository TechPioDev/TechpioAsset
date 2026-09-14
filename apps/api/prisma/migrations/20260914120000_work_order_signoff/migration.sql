-- Work-order sign-off: accept -> start -> complete (AWAITING_APPROVAL) ->
-- approve (COMPLETED) or send back (IN_PROGRESS).
--
-- Additive only. Existing rows keep their status; every new column is nullable
-- with no default, so no row is rewritten. The new enum values are not used in
-- this migration (Postgres forbids using a value added in the same transaction).

-- AlterEnum
ALTER TYPE "MaintenanceStatus" ADD VALUE IF NOT EXISTS 'AWAITING_APPROVAL';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WORK_ORDER_AWAITING_APPROVAL';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WORK_ORDER_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WORK_ORDER_SENT_BACK';

-- AlterTable
ALTER TABLE "maintenance_records"
  ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "acceptedById" TEXT,
  ADD COLUMN IF NOT EXISTS "completedById" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedById" TEXT,
  ADD COLUMN IF NOT EXISTS "sendBackReason" TEXT,
  ADD COLUMN IF NOT EXISTS "restoreAssetOnApproval" BOOLEAN;
