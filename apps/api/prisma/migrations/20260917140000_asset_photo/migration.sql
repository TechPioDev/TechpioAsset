-- A picture of the asset itself (v2.61).
--
-- The redesigned detail page leads with an image of the unit. One bought
-- through the catalogue shows its listing's picture; anything else - an
-- import, a donation, a thing found in a cupboard - had nothing to show.
-- This lets somebody photograph it once. The bytes live in an Attachment
-- row, like the condition photos, so they carry a hash, size and uploader.
--
-- Additive and nullable: every existing asset keeps NULL and renders exactly
-- as before, and the phone ignores a field it does not know. No new table,
-- so RLS coverage is unchanged.

ALTER TABLE "assets" ADD COLUMN "photoAttachmentId" TEXT;

CREATE UNIQUE INDEX "assets_photoAttachmentId_key" ON "assets"("photoAttachmentId");

ALTER TABLE "assets"
  ADD CONSTRAINT "assets_photoAttachmentId_fkey"
  FOREIGN KEY ("photoAttachmentId") REFERENCES "attachments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
