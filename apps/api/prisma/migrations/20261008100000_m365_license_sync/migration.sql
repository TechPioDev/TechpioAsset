-- Microsoft 365 licence sync (v3.12).
--
-- Two additions. A licence can now say it is mirrored from an outside system,
-- and a company can hold one connection to its Microsoft 365 tenant.
--
-- Additive only: five nullable columns on an existing table and one new table.
-- Nothing existing is rewritten, so every licence entered by hand reads exactly
-- as it did before, with all five columns null.

ALTER TABLE "software_licenses"
  ADD COLUMN "externalSource" TEXT,
  ADD COLUMN "externalId" TEXT,
  ADD COLUMN "externalSeatsUsed" INTEGER,
  ADD COLUMN "externalStatus" TEXT,
  ADD COLUMN "externalSyncedAt" TIMESTAMP(3);

-- One row per outside product per company. Hand-entered licences have a null
-- source and id; Postgres treats nulls as distinct in a unique index, so they
-- never collide with each other.
CREATE UNIQUE INDEX "software_licenses_companyId_externalSource_externalId_key"
  ON "software_licenses"("companyId", "externalSource", "externalId");

CREATE TABLE "m365_connections" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretEncrypted" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncMessage" TEXT,
    "lastSyncSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "m365_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "m365_connections_companyId_key" ON "m365_connections"("companyId");

ALTER TABLE "m365_connections"
  ADD CONSTRAINT "m365_connections_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Row-Level Security ───────────────────────────────────────────────────────
--
-- This table holds one company's credentials for another organisation's
-- systems, so it is the last table that should ship uncovered. Same policy
-- body as every other tenant table (see 20260906022856_rls_all_tenant_tables):
-- NULLIF treats an empty GUC as unset, FORCE subjects the owner too, and the
-- policy is permissive while the GUC is unset so the nightly sync - which runs
-- with no tenant in context - can still read each company's connection.
ALTER TABLE "m365_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "m365_connections" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "m365_connections"
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR "companyId" = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    OR "companyId" = current_setting('app.tenant_id', true)
  );

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'techpioasset_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "m365_connections" TO techpioasset_app;
  END IF;
END $$;
