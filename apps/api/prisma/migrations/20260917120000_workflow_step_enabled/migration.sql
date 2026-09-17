-- An On/Off switch on each approval step (v2.28).
--
-- A step switched off is left out when a chain is built for a NEW request;
-- requests already in flight carry their own snapshot and are untouched. A
-- switch rather than a delete, so the step's name, role and threshold
-- survive to be switched back on. Additive: every existing step defaults to
-- enabled and nothing changes until somebody flips one.

ALTER TABLE "workflow_steps" ADD COLUMN "isEnabled" BOOLEAN NOT NULL DEFAULT true;
