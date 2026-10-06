-- One row per company per day: what the fleet looked like that morning (v3.6).
--
-- The dashboard's mock asked for "+12% vs last month" on every card. Nothing
-- recorded history, so that number could only have been decoration - a trend is
-- a comparison, and there was nothing to compare against.
--
-- Counts are STORED, not derived. "What did it look like a month ago" cannot be
-- recomputed from today's rows: assets have changed status, been retired, been
-- deleted. Recomputing would answer a different question while looking like the
-- same one.

CREATE TABLE "fleet_snapshots" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "takenOn" DATE NOT NULL,
    "total" INTEGER NOT NULL,
    "assigned" INTEGER NOT NULL,
    "available" INTEGER NOT NULL,
    "inStock" INTEGER NOT NULL,
    "onOrder" INTEGER NOT NULL,
    "underRepair" INTEGER NOT NULL,
    "critical" INTEGER NOT NULL,
    "retired" INTEGER NOT NULL,
    "other" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_snapshots_pkey" PRIMARY KEY ("id")
);

-- One index, not two. This serves both jobs: the upsert key that keeps the
-- sweep idempotent within a day, and the "newest snapshot in a 20-to-45-day
-- window" range scan the trend does. A second index on the same pair would
-- cost every insert and answer nothing the first cannot.
CREATE UNIQUE INDEX "fleet_snapshots_companyId_takenOn_key"
  ON "fleet_snapshots"("companyId", "takenOn");

ALTER TABLE "fleet_snapshots"
  ADD CONSTRAINT "fleet_snapshots_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Row-Level Security ───────────────────────────────────────────────────────
--
-- A new table carrying a companyId ships UNCOVERED unless something says
-- otherwise, and rls-coverage.integration.test.ts fails the day it does - which
-- is exactly how four tables drifted in uncovered before v2.42.
--
-- Body copied verbatim from 20260906022856_rls_all_tenant_tables: NULLIF treats
-- an empty GUC as unset, because a pooled connection resets the parameter to ''
-- rather than NULL and the older IS NULL form then blocked every row for
-- GUC-less work. FORCE so the owner is subject too; permissive while the GUC is
-- unset, which is what lets background jobs - including the sweep that writes
-- this table - keep working.
ALTER TABLE "fleet_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fleet_snapshots" FORCE ROW LEVEL SECURITY;

-- The GUC is app.tenant_id. I first wrote app.company_id from memory, which
-- would have matched nothing and blocked every row for the app role while
-- looking perfectly reasonable.
CREATE POLICY tenant_isolation ON "fleet_snapshots"
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR "companyId" = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR "companyId" = current_setting('app.tenant_id', true)
  );

-- Guarded: the role exists on deployed environments but not in every developer
-- database, and a migration that fails there fails for everyone.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'techpioasset_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "fleet_snapshots" TO techpioasset_app;
  END IF;
END $$;
