-- Inline images in request messages (v2.60).
--
-- An attachment may now belong to one comment, so a photo sent in a message
-- renders in the thread it was sent in and inherits that message's
-- visibility - an internal note's image is as hidden from the requester as
-- the note is. Additive and nullable only: every existing attachment keeps
-- commentId NULL and stays in the request's attachments panel exactly as
-- before. No new table, so RLS coverage is unchanged.

ALTER TABLE "attachments" ADD COLUMN "commentId" TEXT;

ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_commentId_fkey"
  FOREIGN KEY ("commentId") REFERENCES "request_comments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Read on every open of a request with a conversation, and Postgres does not
-- index foreign keys for you.
CREATE INDEX "attachments_commentId_idx" ON "attachments"("commentId");
