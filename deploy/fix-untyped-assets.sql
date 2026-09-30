-- ─────────────────────────────────────────────────────────────────────────────
-- Give four assets the type they obviously have.
--
--   psql "$DATABASE_URL" -f deploy/fix-untyped-assets.sql
--
-- Five assets carry no subcategory, so they vanish from every Type filter. The
-- owner reported this as "the filters don't work": filtering to Laptop +
-- Available returned nothing while an asset literally named "Dell Laptop" sat
-- in the Available list. The filter was right; the data was thin.
--
-- Four of the five are unambiguous. The fifth, "Keyboard and Mouse", is two
-- objects in one record and is deliberately NOT touched here - it needs
-- splitting or renaming, which is a decision, not a repair.
--
-- Written as a one-off script rather than a migration on purpose. The
-- condition/status repair earlier was a migration because it restored an
-- invariant across every row in every tenant. This is four specific rows in
-- one company, and a migration would carry those asset tags into every
-- environment and every future tenant forever.
--
-- Safe to run twice: it only touches rows that still have no type.
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on

BEGIN;

-- The intended changes, named by BOTH tag and name. The subcategory is
-- resolved inside the asset's OWN category, which is owned by the asset's own
-- company - so this cannot reach across tenants even if another company
-- happens to use the same asset tag.
CREATE TEMP TABLE intended (tag text, name text, type_name text) ON COMMIT DROP;
INSERT INTO intended VALUES
  ('5J3',      'Dell Laptop',          'Laptop'),
  ('IS-13252', 'Asus laptop',          'Laptop'),
  ('C270',     'Camera',               'Webcam'),   -- a Logitech C270 is a webcam
  ('L490',     'Lenovo ThinkPad L490', 'Laptop');

CREATE TEMP TABLE matched ON COMMIT DROP AS
SELECT a.id, a."assetTag", a.name, s.id AS subcategory_id, s.name AS type_name
FROM assets a
JOIN intended i ON i.tag = a."assetTag" AND i.name = a.name
JOIN subcategories s ON s."categoryId" = a."categoryId" AND s.name = i.type_name
WHERE a."deletedAt" IS NULL AND a."subcategoryId" IS NULL;

\echo ''
\echo 'About to set a type on these assets:'
SELECT "assetTag", name, type_name AS will_become FROM matched ORDER BY "assetTag";

-- Refuse to touch more rows than were reviewed. A script that quietly does
-- more than it printed is worse than one that refuses.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM matched;
  IF n > 4 THEN
    RAISE EXCEPTION 'REFUSING: matched % rows, expected at most 4. Review before running.', n;
  END IF;
END $$;

UPDATE assets a
SET "subcategoryId" = m.subcategory_id,
    "updatedAt" = now()
FROM matched m
WHERE a.id = m.id;

\echo ''
\echo 'Assets still without a type (Keyboard and Mouse is expected to remain):'
SELECT a."assetTag", a.name, a.status::text, coalesce(c.name,'-') AS category
FROM assets a LEFT JOIN categories c ON c.id = a."categoryId"
WHERE a."deletedAt" IS NULL AND a."subcategoryId" IS NULL
ORDER BY a.name;

COMMIT;
