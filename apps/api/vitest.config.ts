import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Importing ConfigModule validates the environment at load time, and a
    // unit test only has to import a service to pull it in. Nothing here
    // connects anywhere; these are placeholders so the lane is the same with
    // or without a .env (CI's unit job has none). Vitest 5 fails the run on
    // the unhandled rejection that used to pass silently.
    env: {
      DATABASE_URL: 'postgresql://unit:unit@localhost:5432/unit',
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'unit-test-placeholder-not-a-secret-access-0000',
      JWT_REFRESH_SECRET: 'unit-test-placeholder-not-a-secret-refresh-000',
      MFA_ENCRYPTION_KEY: 'unit-test-placeholder-not-a-secret-mfa-key-00',
    },
  },
  resolve: {
    // API source uses Node-style '.js' specifiers so tsc emits valid CommonJS;
    // Vite needs to be told those map back to the TypeScript sources.
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
});
