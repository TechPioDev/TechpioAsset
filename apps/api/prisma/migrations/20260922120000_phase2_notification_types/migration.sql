-- v2.78 (Phase 2): a supplier asked for a quote, and the Monday summary.
--
-- Postgres will not add an enum value inside a transaction that then uses it,
-- so these stand alone in their own migration with nothing after them.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RFQ_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WEEKLY_SUMMARY';
