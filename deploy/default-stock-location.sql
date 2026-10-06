-- ─────────────────────────────────────────────────────────────────────────────
-- Give each company one stock location, so Inventory can actually be used.
--
--   psql "$DATABASE_URL" -f deploy/default-stock-location.sql
--
-- The Locations tab is gone (v3.3): a company with one office and a supplier
-- who walks in does not need to model shelves. But stock movements are still
-- recorded against a location, and there were none - so "Add stock" led to a
-- form that could not be submitted.
--
-- One location per company, created only where none exists. The UI selects it
-- automatically when it is the only one, so nobody is asked a question with a
-- single answer.
--
-- Safe to run twice: companies that already have a location are skipped.
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO stock_locations (id, "companyId", code, name, "officeId", "isActive", "createdAt", "updatedAt")
SELECT
  'loc-default-' || substr(md5(c.id), 1, 12),
  c.id,
  'STORE',
  'Office store',
  -- Attach to the company's default office when there is one, so a future
  -- second office starts from somewhere sensible rather than from nothing.
  (SELECT o.id FROM offices o
    WHERE o."companyId" = c.id AND o."deletedAt" IS NULL
    ORDER BY (o."isDefault" IS NOT TRUE), o."createdAt" LIMIT 1),
  true,
  now(),
  now()
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM stock_locations s WHERE s."companyId" = c.id AND s."deletedAt" IS NULL
);

\echo ''
\echo 'Stock locations now:'
SELECT c.name AS company, s.code, s.name, coalesce(o.name, '(no office)') AS office
FROM stock_locations s
JOIN companies c ON c.id = s."companyId"
LEFT JOIN offices o ON o.id = s."officeId"
WHERE s."deletedAt" IS NULL
ORDER BY 1, 2;

COMMIT;
