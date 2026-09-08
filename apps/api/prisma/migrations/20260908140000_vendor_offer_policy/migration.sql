-- v2.46: whether a supplier's offer waits for an internal decision.
--
-- Defaults to REVIEW_REQUIRED so an existing tenant's workflow is unchanged
-- until somebody chooses otherwise in settings.
CREATE TYPE "VendorOfferPolicy" AS ENUM ('REVIEW_REQUIRED', 'PUBLISH_IMMEDIATELY');

ALTER TABLE "companies"
  ADD COLUMN "vendorOfferPolicy" "VendorOfferPolicy" NOT NULL DEFAULT 'REVIEW_REQUIRED';
