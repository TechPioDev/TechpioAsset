-- Put back what deploy/hide-unused-modules.sql withdrew.
--
--   psql "$DATABASE_URL" -f deploy/restore-hidden-modules.sql
--
-- Grants the three read permissions to every role that holds the matching
-- "manage" permission, plus the roles that plainly ought to see them. It
-- restores capability rather than replaying a recorded diff, because a diff
-- recorded in a temp table is gone the moment the session ends - and a rollback
-- you cannot run six months later is not a rollback.
--
-- Safe to run twice: ON CONFLICT DO NOTHING.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO role_permissions ("roleId", "permissionId")
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.key IN ('vendor-products:read','procurement:pr:read','invoices:read')
  AND r.key IN (
    'SUPER_ADMIN','COMPANY_ADMIN','IT_ADMINISTRATOR','FINANCE','AUDITOR',
    'OFFICE_ADMINISTRATOR','PROCUREMENT_MANAGER','INVENTORY_MANAGER'
  )
ON CONFLICT DO NOTHING;

\echo 'Granted again:'
SELECT r.name AS role, p.key AS permission
FROM role_permissions rp
JOIN roles r ON r.id = rp."roleId"
JOIN permissions p ON p.id = rp."permissionId"
WHERE p.key IN ('vendor-products:read','procurement:pr:read','invoices:read')
ORDER BY 2, 1;

COMMIT;
