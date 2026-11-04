import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * v2.10 S3 — the measurement lane.
 *
 * Deliberately NOT part of any automatic run: it needs the load tenant present
 * and takes minutes. It exists because the background jobs had no measurement
 * at all, which is how `runStockSweep` came to reload every movement ever
 * recorded once per stock level without anyone noticing. A job nobody times is
 * a job whose cost nobody knows.
 *
 * It is a vitest lane rather than a plain script because Nest DI needs emitted
 * decorator metadata, and both tsx and esbuild drop it — the same reason the
 * integration lanes carry the swc plugin.
 *
 *   pnpm --filter @techpioasset/api perf:sweep
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
    include: ['test/sweep-timing.perf.test.ts', 'test/export-memory.perf.test.ts'],
    env: {
      LOGIN_RATE_LIMIT: '10000',
      PLATFORM_ADMIN_EMAILS: 'admin@techpioasset.dev',
    },
    // A sweep over a million-row ledger is allowed to take a while; that is the
    // number being measured.
    // --expose-gc so the memory probe can force a collection before sampling.
    // Without it, peak heapUsed measures how much was ALLOCATED before the
    // collector happened to run - which for a two-second export is mostly
    // garbage, and moved by 25% between identical runs.
    poolOptions: { forks: { execArgv: ['--expose-gc'] } },
    testTimeout: 900_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
  resolve: {
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
});
