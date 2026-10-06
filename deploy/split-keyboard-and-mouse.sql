-- ─────────────────────────────────────────────────────────────────────────────
-- Split "Keyboard and Mouse" into a keyboard and a mouse.
--
--   psql "$DATABASE_URL" -f deploy/split-keyboard-and-mouse.sql
--
-- One record held two objects, so it could not be given a type - Keyboard and
-- Mouse are different types - and it sat under Office Equipment, a category
-- with no types defined at all. It was the last asset with no type.
--
-- The existing row KEEPS its id, tag and history and becomes the keyboard: the
-- physical label says "Logi", somebody is holding it, and the handover record
-- runs back to 19 August. Inventing two new rows and deleting the old one would
-- throw that away to make the data tidier, which is the wrong trade.
--
-- The mouse is a new asset carrying the same holder, office, condition and
-- assignment date, so the history reads as it actually happened.
--
-- NOTE: raw SQL bypasses the Prisma client extension that derives
-- lifecycleState and availabilityState from status, so both are set here by
-- hand to match the original. A row inserted without them would be the only
-- asset in the fleet missing its dimensions.
--
-- Safe to run twice: it does nothing once the mouse exists.
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE source ON COMMIT DROP AS
SELECT a.*
FROM assets a
WHERE a."assetTag" = 'Logi'
  AND a.name = 'Keyboard and Mouse'
  AND a."deletedAt" IS NULL;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM source;
  IF n = 0 THEN
    RAISE NOTICE 'Nothing to split - no undivided "Keyboard and Mouse" found. Already done?';
  ELSIF n > 1 THEN
    RAISE EXCEPTION 'REFUSING: % rows match, expected 1.', n;
  END IF;
END $$;

\echo ''
\echo 'Before:'
SELECT "assetTag", name, status::text, 'no type' AS type FROM source;

-- ── 1. The existing record becomes the keyboard ──────────────────────────────
UPDATE assets a
SET name = 'Logitech Keyboard',
    "categoryId" = (SELECT id FROM categories WHERE name = 'IT Assets' AND "companyId" = a."companyId"),
    "subcategoryId" = (
      SELECT s.id FROM subcategories s
      JOIN categories c ON c.id = s."categoryId"
      WHERE c.name = 'IT Assets' AND c."companyId" = a."companyId" AND s.name = 'Keyboard'
    ),
    "updatedAt" = now()
FROM source src
WHERE a.id = src.id;

-- ── 2. The mouse becomes its own asset ───────────────────────────────────────
INSERT INTO assets (
  id, "companyId", "assetTag", name, "categoryId", "subcategoryId", "qrToken",
  status, "lifecycleState", "availabilityState", condition, "trackingType",
  "officeId", "assignedUserId", "createdAt", "updatedAt"
)
SELECT
  'split-' || substr(md5(src.id || 'mouse'), 1, 20),
  src."companyId",
  src."assetTag" || '-M',
  'Logitech Mouse',
  (SELECT id FROM categories WHERE name = 'IT Assets' AND "companyId" = src."companyId"),
  (SELECT s.id FROM subcategories s
     JOIN categories c ON c.id = s."categoryId"
    WHERE c.name = 'IT Assets' AND c."companyId" = src."companyId" AND s.name = 'Mouse'),
  'qr-' || substr(md5(src.id || 'mouse-qr'), 1, 24),
  src.status,
  -- Set by hand: see the note at the top.
  src."lifecycleState",
  src."availabilityState",
  src.condition,
  src."trackingType",
  src."officeId",
  src."assignedUserId",
  now(),
  now()
FROM source src
WHERE NOT EXISTS (SELECT 1 FROM assets x WHERE x."assetTag" = src."assetTag" || '-M');

-- ── 3. The mouse has been with its holder as long as the keyboard has ────────
INSERT INTO asset_assignments (id, "assetId", "userId", "assignedAt", "conditionOut", "createdAt", "updatedAt")
SELECT
  'split-' || substr(md5(src.id || 'mouse-assign'), 1, 20),
  m.id,
  src."assignedUserId",
  COALESCE(
    (SELECT aa."assignedAt" FROM asset_assignments aa
      WHERE aa."assetId" = src.id AND aa."returnedAt" IS NULL
      ORDER BY aa."assignedAt" LIMIT 1),
    now()
  ),
  src.condition,
  now(),
  now()
FROM source src
JOIN assets m ON m."assetTag" = src."assetTag" || '-M'
WHERE src."assignedUserId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM asset_assignments x WHERE x."assetId" = m.id);

\echo ''
\echo 'After:'
SELECT a."assetTag", a.name, s.name AS type, c.name AS category, a.status::text,
       p."firstName" || ' ' || p."lastName" AS holder,
       to_char(aa."assignedAt", 'YYYY-MM-DD') AS held_since
FROM assets a
LEFT JOIN subcategories s ON s.id = a."subcategoryId"
LEFT JOIN categories c ON c.id = a."categoryId"
LEFT JOIN users u ON u.id = a."assignedUserId"
LEFT JOIN user_profiles p ON p."userId" = u.id
LEFT JOIN asset_assignments aa ON aa."assetId" = a.id AND aa."returnedAt" IS NULL
WHERE a."assetTag" IN ((SELECT "assetTag" FROM source), (SELECT "assetTag" || '-M' FROM source))
ORDER BY a."assetTag";

\echo ''
\echo 'Assets still without a type (should be none):'
SELECT count(*) FROM assets WHERE "deletedAt" IS NULL AND "subcategoryId" IS NULL;

COMMIT;
