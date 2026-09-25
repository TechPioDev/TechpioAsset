-- ─────────────────────────────────────────────────────────────────────────────
-- Make a restored production database safe to put on staging.
--
-- Run by deploy/scrub-staging-db.sh, in one transaction, BEFORE the staging
-- containers are allowed to start. Order matters: an API that boots against an
-- unscrubbed restore can email and notify real people within seconds.
--
-- Two things this file is built around:
--
--   1. mail_settings OVERRIDES the environment. RoutingMailProvider tries the
--      database transport first and only falls back to MAIL_PROVIDER, so a
--      restored production row would send real mail through the real SMTP
--      server to real addresses no matter what .env.staging says. Deleting that
--      row is not tidying up - it is the difference between a safe staging box
--      and one that mails 52 people. Same for ai_settings, which carries a real
--      API key.
--
--   2. NULL is preserved everywhere. A profile with no phone number keeps no
--      phone number, because filling every optional column hides exactly the
--      empty-field bugs staging exists to catch.
--
-- Names become fake but STABLE: derived from the row id, so the same person is
-- the same fake person across restores and a bug report stays readable.
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on

-- ── Guard 1: is this actually staging? ───────────────────────────────────────
--
-- The whole file is destructive. Pointed at production by a mistyped variable
-- it would delete the mail configuration and rename every employee. So it
-- refuses to run against a database whose name does not say staging.
DO $$
BEGIN
  IF current_database() NOT LIKE '%staging%' THEN
    RAISE EXCEPTION
      'REFUSING TO SCRUB: connected to "%" - this script only runs on a database with "staging" in its name.',
      current_database();
  END IF;
END $$;

-- ── Guard 2: has the schema grown a personal column I do not handle? ─────────
--
-- 106 models and growing. A hardcoded scrub list goes stale silently, and a
-- scrub believed to be complete is more dangerous than no scrub at all - you
-- would put the box on the internet thinking it was clean. So the file asks the
-- database what personal-looking text columns exist and stops if any is not on
-- the list below. A false alarm costs one line; a miss costs real data.
DO $$
DECLARE unhandled text;
BEGIN
  SELECT string_agg(c.table_name || '.' || c.column_name, ', ' ORDER BY c.table_name)
    INTO unhandled
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.data_type IN ('text', 'character varying')
    AND lower(c.column_name) ~ '(email|phone|mobile|passwordhash|mfasecret|firstname|lastname|displayname|employeenumber|avatarkey|ipaddress|useragent|externalidpsubject|tokenhash|secret|apikey|contactname|address)'
    AND (c.table_name || '.' || c.column_name) NOT IN (
      'agent_enrolment_tokens.graceTokenHash', 'agent_enrolment_tokens.tokenHash',
      'ai_settings.apiKeyEncrypted',
      'assets.macAddress',
      'audit_logs.ipAddress', 'audit_logs.userAgent',
      'companies.address', 'companies.contactEmail', 'companies.contactPhone',
      'device_agents.previousTokenHash', 'device_agents.tokenHash',
      'email_logs.toEmail',
      'mail_settings.fromAddress',
      'offices.addressLine1', 'offices.addressLine2',
      'refresh_tokens.ipAddress', 'refresh_tokens.tokenHash', 'refresh_tokens.userAgent',
      'scim_tokens.tokenHash',
      'user_profiles.avatarKey', 'user_profiles.displayName', 'user_profiles.employeeNumber',
      'user_profiles.firstName', 'user_profiles.lastName', 'user_profiles.phone',
      'users.email', 'users.externalIdpSubject', 'users.mfaSecret', 'users.passwordHash',
      'vendors.addressLine1', 'vendors.contactEmail', 'vendors.contactName', 'vendors.contactPhone',
      'verification_tokens.ipAddress', 'verification_tokens.tokenHash',
      'webhook_subscriptions.secret'
    );
  IF unhandled IS NOT NULL THEN
    RAISE EXCEPTION
      E'REFUSING TO SCRUB: the schema has personal columns this scrub does not handle:\n  %\nAdd them to deploy/staging-scrub.sql (scrub them, or list them as reviewed) and run again.',
      unhandled;
  END IF;
END $$;

BEGIN;

-- ── The two rows that can reach the outside world ────────────────────────────
DELETE FROM mail_settings;   -- else DB settings beat MAIL_PROVIDER=mock
DELETE FROM ai_settings;     -- carries a real encrypted API key

-- ── Anything that is a credential, a session or a delivery address ───────────
DELETE FROM device_tokens;           -- push targets: real phones
DELETE FROM refresh_tokens;          -- live sessions
DELETE FROM verification_tokens;     -- password-reset / invite links
DELETE FROM scim_tokens;
DELETE FROM agent_enrolment_tokens;
DELETE FROM webhook_subscriptions;   -- would POST staging events to real endpoints
DELETE FROM email_logs;              -- a log of who was mailed at what address
DELETE FROM notifications;           -- bodies embed real names, denormalised

-- ── People ───────────────────────────────────────────────────────────────────
--
-- Fake but stable, and NULL stays NULL.
UPDATE user_profiles p SET
  "firstName"      = f.fn,
  "lastName"       = f.ln,
  "displayName"    = CASE WHEN p."displayName"    IS NULL THEN NULL ELSE f.fn || ' ' || f.ln END,
  "employeeNumber" = CASE WHEN p."employeeNumber" IS NULL THEN NULL
                          ELSE 'EMP-' || lpad((abs(hashtext(p.id)) % 10000)::text, 4, '0') END,
  phone            = CASE WHEN p.phone            IS NULL THEN NULL
                          ELSE '+91 90000 ' || lpad((abs(hashtext(p.id)) % 100000)::text, 5, '0') END,
  -- The uploads volume is not copied to staging, so every avatar key would be a
  -- 404. Nulling it is the honest state, and it exercises the initials-avatar
  -- path that most people see anyway.
  "avatarKey"      = NULL
FROM (
  SELECT id,
    (ARRAY['Aarav','Priya','Rohan','Neha','Vikram','Anjali','Karan','Divya',
           'Arjun','Meera','Sanjay','Pooja'])[(abs(hashtext(id)) % 12) + 1] AS fn,
    (ARRAY['Sharma','Verma','Patel','Reddy','Nair','Gupta','Singh','Iyer',
           'Bose','Menon','Rao','Joshi'])[(abs(hashtext(id || 'ln')) % 12) + 1] AS ln
  FROM user_profiles
) f
WHERE f.id = p.id;

-- .invalid is reserved by RFC 2606: it can never resolve and can never receive
-- mail. If a send ever does escape, it has nowhere to land.
UPDATE users SET
  email                = 'user-' || substr(md5(id), 1, 8) || '@staging.invalid',
  "passwordHash"       = :'password_hash',   -- one known password, supplied at run time
  "mfaSecret"          = NULL,               -- nobody has the staging authenticator
  "mfaEnabledAt"       = NULL,
  "externalIdpSubject" = NULL;

-- ── Organisation and supplier contact details ────────────────────────────────
UPDATE companies SET
  "contactEmail" = CASE WHEN "contactEmail" IS NULL THEN NULL ELSE 'company@staging.invalid' END,
  "contactPhone" = CASE WHEN "contactPhone" IS NULL THEN NULL ELSE '+91 90000 00000' END,
  address        = CASE WHEN address        IS NULL THEN NULL ELSE 'Staging address' END;

UPDATE offices SET
  "addressLine1" = CASE WHEN "addressLine1" IS NULL THEN NULL ELSE 'Staging address line 1' END,
  "addressLine2" = CASE WHEN "addressLine2" IS NULL THEN NULL ELSE 'Staging address line 2' END;

-- Vendor names are kept: the vendor-isolation rules are a thing staging has to
-- be able to test, and that needs recognisable suppliers. Only the humans and
-- the ways to reach them are replaced.
UPDATE vendors SET
  "contactName"  = CASE WHEN "contactName"  IS NULL THEN NULL ELSE 'Staging Contact' END,
  "contactEmail" = CASE WHEN "contactEmail" IS NULL THEN NULL
                        ELSE 'vendor-' || substr(md5(id), 1, 6) || '@staging.invalid' END,
  "contactPhone" = CASE WHEN "contactPhone" IS NULL THEN NULL ELSE '+91 90000 00001' END,
  "addressLine1" = CASE WHEN "addressLine1" IS NULL THEN NULL ELSE 'Staging address line 1' END;

UPDATE disposal_records SET recipient = 'Staging Recipient' WHERE recipient IS NOT NULL;

-- ── Audit trail: keep the history, drop the tracking ─────────────────────────
-- Who did what and when is the useful part and stays. Where they were sitting
-- and what browser they used is not, and is personal.
UPDATE audit_logs      SET "ipAddress" = NULL, "userAgent" = NULL;
UPDATE device_agents   SET "tokenHash" = '', "previousTokenHash" = NULL;
UPDATE assets          SET "macAddress" = NULL WHERE "macAddress" IS NOT NULL;

COMMIT;

-- ── How to get in ────────────────────────────────────────────────────────────
-- Every account now has the same password. These are the ones worth using.
\echo ''
\echo 'Scrub complete. Sign in to staging with these (password: the one you passed in):'
SELECT u.email,
       coalesce(p."displayName", p."firstName" || ' ' || p."lastName") AS name,
       r.name AS role
FROM users u
JOIN user_profiles p ON p."userId" = u.id
LEFT JOIN user_roles ur ON ur."userId" = u.id
LEFT JOIN roles r ON r.id = ur."roleId"
WHERE u."deletedAt" IS NULL
ORDER BY (r.key = 'SUPER_ADMIN') DESC NULLS LAST, u.email
LIMIT 8;
