-- v2.51: the low-stock warning for a supplier's own threshold.
--
-- Its own type rather than reusing LOW_STOCK, which means our warehouse running
-- down and is routed to internal staff. Alone in its migration: Postgres will
-- not add an enum value and then use it in the same transaction.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VENDOR_PRODUCT_LOW_STOCK';
