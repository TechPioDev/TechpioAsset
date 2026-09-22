-- An asset that names a holder cannot be in a status that says nobody has it
-- (v2.75). The owner found a mouse shown as "Available" and "Assigned to
-- Banti Kumar" in one row. The API now refuses the status change; this is the
-- backstop for every other path - a script, an import, a future bug - so the
-- register can never hold the contradiction again.
--
-- Checked read-only on the live register before shipping: zero rows violate
-- it. NOT VALID: Postgres enforces the check on every INSERT and UPDATE from
-- now on but does not re-read existing rows, so the migration can never keep
-- the API from starting. Should a contradictory row somehow exist already,
-- the next write to it is refused until it is put right.
ALTER TABLE "assets" ADD CONSTRAINT "assets_holder_matches_status"
  CHECK (
    "assignedUserId" IS NULL
    OR "status" NOT IN ('DRAFT','REQUESTED','ORDERED','RECEIVED','AVAILABLE','RESERVED','IN_STORAGE','RETURNED','RETIRED','DISPOSED','DONATED')
  ) NOT VALID;
