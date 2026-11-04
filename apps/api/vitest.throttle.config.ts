import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * v2.8 S5 — the throttling lane.
 *
 * Rate limiting can only be proven by actually reaching the limit, and a
 * limit low enough to reach quickly would make every other suite flaky. So it
 * gets its own lane with a deliberately small ceiling.
 *
 * Run with `pnpm --filter @techpioasset/api test:integration:throttle`.
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
    include: ['test/tenant-throttle.integration.test.ts'],
    env: {
      // Small enough to reach in a test, large enough for setup (provisioning
      // a tenant and two logins) not to trip it first.
      RATE_LIMIT_MAX: '25',
      RATE_LIMIT_TTL_SECONDS: '60',
      LOGIN_RATE_LIMIT: '10000',
      PLATFORM_ADMIN_EMAILS: 'admin@techpioasset.dev',
    },
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
  resolve: {
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
});
