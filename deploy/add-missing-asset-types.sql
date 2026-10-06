-- ─────────────────────────────────────────────────────────────────────────────
-- Give Office Equipment, Furniture and Consumables their types.
--
--   psql "$DATABASE_URL" -f deploy/add-missing-asset-types.sql
--
-- Only IT Assets had types - 22 of them - so anything filed under the other
-- three could never be typed, never filtered by type, and showed up as a gap on
-- the asset list. That is how "Keyboard and Mouse" ended up untypeable.
--
-- The names are NOT invented here. They are the lists this repository already
-- carries in apps/api/prisma/seed/catalogue.ts, which production never received:
-- a tenant is provisioned with four bare categories by PlatformService, on the
-- reasoning that the type tree is the admin's to own (spec section 11). The
-- snag is that there is no screen and no write API for an admin to own it with,
-- so in practice the tree stayed empty.
--
-- Two names appear under IT Assets as well - "Projector" and "Cables". That
-- overlap is in the repository's own list and is kept: a projector can
-- reasonably be IT kit or office kit, and an IT cable is not a box of
-- consumable cables. Delete either later if it reads as noise.
--
-- Safe to run twice: existing types are skipped on (categoryId, key).
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE wanted (category_name text, type_name text) ON COMMIT DROP;

INSERT INTO wanted VALUES
  ('Furniture', 'Desk'), ('Furniture', 'Office chair'), ('Furniture', 'Conference table'),
  ('Furniture', 'Cabinet'), ('Furniture', 'Storage rack'), ('Furniture', 'Bookshelf'),
  ('Furniture', 'Reception furniture'), ('Furniture', 'Whiteboard'), ('Furniture', 'Office partition'),

  ('Office Equipment', 'Projector'), ('Office Equipment', 'Television'),
  ('Office Equipment', 'Conference-room device'), ('Office Equipment', 'Camera'),
  ('Office Equipment', 'Speaker'), ('Office Equipment', 'Shredder'),
  ('Office Equipment', 'Binding machine'), ('Office Equipment', 'Label printer'),
  ('Office Equipment', 'Attendance device'),

  ('Consumables', 'Printer toner'), ('Consumables', 'Paper'), ('Consumables', 'Stationery'),
  ('Consumables', 'Cleaning products'), ('Consumables', 'Pantry products'),
  ('Consumables', 'Batteries'), ('Consumables', 'Cables'), ('Consumables', 'Small accessories');

-- Every company gets them, keyed exactly as the seed keys them: lower case,
-- non-alphanumerics collapsed to hyphens.
INSERT INTO subcategories (id, "categoryId", key, name, "isActive", "createdAt", "updatedAt")
SELECT
  'type-' || substr(md5(c.id || w.type_name), 1, 20),
  c.id,
  regexp_replace(regexp_replace(lower(w.type_name), '[^a-z0-9]+', '-', 'g'), '^-|-$', '', 'g'),
  w.type_name,
  true,
  now(),
  now()
FROM wanted w
JOIN categories c ON c.name = w.category_name AND c."deletedAt" IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM subcategories s
  WHERE s."categoryId" = c.id
    AND s.key = regexp_replace(regexp_replace(lower(w.type_name), '[^a-z0-9]+', '-', 'g'), '^-|-$', '', 'g')
);

\echo ''
\echo 'Types per category now:'
SELECT c.name AS category, count(s.id) AS types
FROM categories c
LEFT JOIN subcategories s ON s."categoryId" = c.id AND s."deletedAt" IS NULL
WHERE c."deletedAt" IS NULL
GROUP BY c.name ORDER BY c.name;

COMMIT;
