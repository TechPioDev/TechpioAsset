import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import { RLS_APP_URL } from './test/setup/rls-role';

/**
 * v2.7 R1 — the RLS-ON lane: the application boots connected as the
 * NON-superuser role with RLS_ENFORCE=true, so every policy actually bites.
 * Run with `pnpm --filter @techpioasset/api test:integration:rls`.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['test/rls-app.integration.test.ts'],
    globalSetup: ['./test/setup/rls-lane-setup.ts'],
    env: {
      DATABASE_URL: RLS_APP_URL,
      RLS_ENFORCE: 'true',
      LOGIN_RATE_LIMIT: '10000',
      PLATFORM_ADMIN_EMAILS: 'admin@techpioasset.dev',
    },
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
  resolve: {
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
});
