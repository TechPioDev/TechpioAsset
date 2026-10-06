/**
 * v2.7 R1 — provisions the non-superuser `techpioasset_app` role in the LOCAL
 * database, mirroring deploy/rls-app-role.sql (which remains the production
 * path, run by an operator with a strong password). Idempotent; test-only
 * password, local embedded Postgres only.
 */

export const RLS_APP_PASSWORD = 'rls-lane-local-only';

/**
 * The same server the admin client talks to, with the app role's credentials
 * swapped in.
 *
 * This used to hardcode `localhost:5432`. On a machine where another project
 * already owns 5432 - which is why this cluster runs on 5433 - all six tests
 * in the lane failed with "authentication failed for techpioasset_app": they
 * had reached a completely different database and been turned away at the
 * door. The message says credentials, the cause was the address, and the lane
 * that proves tenant isolation is the worst one to have failing for a reason
 * nobody reads twice.
 */
function appRoleUrl(): string {
  const admin = new URL(process.env.DATABASE_URL ?? 'postgresql://localhost:5432/techpioasset');
  admin.username = 'techpioasset_app';
  admin.password = RLS_APP_PASSWORD;
  return admin.toString();
}

export const RLS_APP_URL = appRoleUrl();

interface RawClient {
  $executeRawUnsafe(sql: string): Promise<unknown>;
}

export async function provisionRlsRole(admin: RawClient): Promise<void> {
  await admin.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'techpioasset_app') THEN
        CREATE ROLE techpioasset_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
          PASSWORD '${RLS_APP_PASSWORD}';
      ELSE
        ALTER ROLE techpioasset_app WITH LOGIN NOSUPERUSER NOBYPASSRLS
          PASSWORD '${RLS_APP_PASSWORD}';
      END IF;
    END
    $$;
  `);
  await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE techpioasset TO techpioasset_app`);
  await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO techpioasset_app`);
  await admin.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO techpioasset_app`,
  );
  await admin.$executeRawUnsafe(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO techpioasset_app`,
  );
}
