import { defineConfig } from 'vitest/config';

/**
 * Tests only the pure `src/lib` core (offline queue, API-client helpers). The
 * React Native screens are excluded: they import the RN runtime, which cannot be
 * loaded outside a device or emulator. The logic that matters for data integrity
 * lives in the lib and is fully covered here.
 *
 * v2.84 adds src/i18n: plain string tables and a lookup, no RN import.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/lib/**/*.test.ts', 'src/i18n/**/*.test.ts'],
  },
});
