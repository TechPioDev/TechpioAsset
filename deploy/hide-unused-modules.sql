-- ─────────────────────────────────────────────────────────────────────────────
-- Hide the Buying & Stock modules this company does not use.
--
--   psql "$DATABASE_URL" -f deploy/hide-unused-modules.sql
--
-- Catalogue, Procurement and Invoices were built to blueprint Volume III
-- (release v2.4, "Procurement & Warehouse Inventory"). They describe a
-- warehouse operation. This company has one office and a supplier who walks in,
-- and after months live the tables hold nothing at all: 0 catalogue offers,
-- 0 purchase requests, 0 orders, 0 goods receipts, 0 invoices.
--
-- Nothing is deleted. The navigation is driven by permissions, so withdrawing
-- the read permission hides the menu entry and the page without touching a line
-- of code - and `deploy/restore-hidden-modules.sql`, written beside this one,
-- puts every grant back exactly as it was.
--
-- Inventory is deliberately NOT hidden: the company wants it, simplified.
--
-- THE VENDOR ROLE KEEPS vendor-products:read. A supplier portal account exists
-- and has signed in, and the catalogue is the one page that account exists to
-- use. Hiding an internal menu is tidying; breaking an outside party's login is
-- an outage.
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE hiding (permission text) ON COMMIT DROP;
INSERT INTO hiding VALUES ('vendor-products:read'), ('procurement:pr:read'), ('invoices:read');

-- Exactly what is about to be withdrawn, and from whom.
CREATE TEMP TABLE removing ON COMMIT DROP AS
SELECT rp."roleId", rp."permissionId", r.name AS role_name, p.key AS permission
FROM role_permissions rp
JOIN roles r ON r.id = rp."roleId"
JOIN permissions p ON p.id = rp."permissionId"
WHERE p.key IN (SELECT permission FROM hiding)
  AND r.key <> 'VENDOR';

\echo ''
\echo 'Withdrawing these grants (the Vendor role is untouched):'
SELECT role_name, permission FROM removing ORDER BY permission, role_name;

-- The EXACT undo, emitted as SQL you can keep.
--
-- restore-hidden-modules.sql grants back to a fixed list of standard roles,
-- which is close but not identical: this company has two CUSTOM roles
-- ("Inventory Manager (custom)", "Office Administrator (custom)") that the
-- fixed list does not name, so 21 grants went out and only 19 would come back.
-- A rollback that silently returns less than it took is not a rollback.
--
-- Capture this block when you run the script:
--   ... -f deploy/hide-unused-modules.sql > /root/pioassets-modules-undo.sql
\echo ''
\echo '-- EXACT UNDO - save this:'
SELECT format(
  'INSERT INTO role_permissions ("roleId","permissionId") VALUES (%L,%L) ON CONFLICT DO NOTHING;',
  "roleId", "permissionId")
FROM removing ORDER BY role_name, permission;

DELETE FROM role_permissions rp
USING removing x
WHERE rp."roleId" = x."roleId" AND rp."permissionId" = x."permissionId";

\echo ''
\echo 'Still granted afterwards (should be the Vendor role only):'
SELECT r.name AS role, p.key AS permission
FROM role_permissions rp
JOIN roles r ON r.id = rp."roleId"
JOIN permissions p ON p.id = rp."permissionId"
WHERE p.key IN ('vendor-products:read','procurement:pr:read','invoices:read')
ORDER BY 2, 1;

COMMIT;
