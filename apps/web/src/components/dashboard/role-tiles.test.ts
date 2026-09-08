import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TILE_ICONS } from './role-tiles';

/**
 * Every icon the dashboard can send must be one this component can draw.
 *
 * A name missing from the map is not an error at runtime - it falls back to a
 * generic glyph - so two unrelated tiles quietly wear the same icon and it
 * reads as a rendering fault. Derived from the service rather than restated,
 * because a list copied by hand is a list that drifts.
 */
const SERVICE = path.resolve(
  __dirname,
  '../../../../../apps/api/src/dashboard/dashboard.service.ts',
);

describe('dashboard tile icons', () => {
  it('can draw every icon the dashboard service emits', () => {
    const source = readFileSync(SERVICE, 'utf8');
    const emitted = [...source.matchAll(/^\s*icon: '([A-Za-z]+)',$/gm)].map((m) => m[1]!);

    expect(emitted.length).toBeGreaterThan(5);
    const missing = [...new Set(emitted)].filter((name) => !(name in TILE_ICONS));
    expect(
      missing,
      `icons the dashboard sends but this map cannot draw: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
