-- v2.50: notification types for the supplier catalogue.
--
-- Postgres will not add an enum value inside a transaction that then uses it,
-- so these stand alone in their own migration with nothing after them.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VENDOR_PRODUCT_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VENDOR_PRODUCT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VENDOR_PRODUCT_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VENDOR_PRODUCT_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VENDOR_PRODUCT_OUT_OF_STOCK';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VENDOR_OFFER_SELECTED';
