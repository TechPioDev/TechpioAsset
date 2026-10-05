import { describe, it, expect } from 'vitest';
import {
  STATUS_TOKEN_REGISTRY,
  ASSET_STATUS_TOKENS,
  ASSET_STATUS_GROUP_LABELS,
} from './status-tokens';
import { ASSET_STATUS_GROUPS } from '@techpioasset/domain';
import { TONES, TONE_PALETTE_LIGHT, TONE_PALETTE_DARK, type Tone } from './tones';

/** Relative luminance per WCAG 2.1. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('status token coverage', () => {
  it.each(STATUS_TOKEN_REGISTRY)('$name has a token for every value', ({ values, tokens }) => {
    for (const value of values) {
      const token = (tokens as Record<string, unknown>)[value];
      expect(token, `missing token for ${value}`).toBeDefined();
    }
    expect(Object.keys(tokens).sort()).toEqual([...values].sort());
  });

  it.each(STATUS_TOKEN_REGISTRY)('$name uses only declared tones', ({ tokens }) => {
    for (const token of Object.values(tokens)) {
      expect(TONES).toContain(token.tone);
    }
  });

  it.each(STATUS_TOKEN_REGISTRY)('$name has a non-empty label and icon', ({ tokens }) => {
    for (const [key, token] of Object.entries(tokens)) {
      expect(token.label.length, `${key} has an empty label`).toBeGreaterThan(0);
      // Lucide exports are PascalCase; a lowercase name would silently render nothing.
      expect(token.icon, `${key} icon is not a Lucide export name`).toMatch(/^[A-Z][A-Za-z0-9]*$/);
    }
  });
});

describe('tone palettes', () => {
  it('defines both schemes for every tone', () => {
    for (const tone of TONES) {
      expect(TONE_PALETTE_LIGHT[tone], `light ${tone}`).toBeDefined();
      expect(TONE_PALETTE_DARK[tone], `dark ${tone}`).toBeDefined();
    }
  });

  it('uses six-digit hex throughout', () => {
    for (const palette of [TONE_PALETTE_LIGHT, TONE_PALETTE_DARK]) {
      for (const entry of Object.values(palette)) {
        for (const value of Object.values(entry)) {
          expect(value).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });

  // Spec section 26 targets WCAG 2.1 AA. Badge text is the usual failure point,
  // so the fg/bg pair is asserted rather than eyeballed.
  it.each(TONES)('%s badge text meets AA contrast in light mode', (tone: Tone) => {
    const { fg, bg } = TONE_PALETTE_LIGHT[tone];
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(TONES)('%s badge text meets AA contrast in dark mode', (tone: Tone) => {
    const { fg, bg } = TONE_PALETTE_DARK[tone];
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('semantic consistency', () => {
  it('marks every irreversible end-of-life status as muted', () => {
    for (const status of ['RETIRED', 'DISPOSED', 'DONATED'] as const) {
      expect(ASSET_STATUS_TOKENS[status].tone).toBe('muted');
    }
  });

  it('marks loss and theft as critical, not merely danger', () => {
    expect(ASSET_STATUS_TOKENS.LOST.tone).toBe('critical');
    expect(ASSET_STATUS_TOKENS.STOLEN.tone).toBe('critical');
  });
});

describe('a group name never means two numbers (v3.0)', () => {
  it('does not reuse a status name for a group that merges several', () => {
    // The reported fault: "Assigned 155" in the fleet bar sat above
    // "Assigned 76" in the chart. The group merging ASSIGNED and IN_USE was
    // called "Assigned", so one word carried two numbers on one screen.
    const statusLabels = new Set(Object.values(ASSET_STATUS_TOKENS).map((t) => t.label));
    const clashes: string[] = [];
    for (const [key, label] of Object.entries(ASSET_STATUS_GROUP_LABELS)) {
      const statuses = ASSET_STATUS_GROUPS[key as keyof typeof ASSET_STATUS_GROUPS];
      // Sharing a name is fine when the group IS that one status - same set,
      // same number, nothing to contradict.
      if (statuses.length > 1 && statusLabels.has(label)) {
        clashes.push(`group "${key}" is called "${label}", which is also one status`);
      }
    }
    expect(clashes, clashes.join('; ')).toEqual([]);
  });

  it('names every group', () => {
    for (const key of Object.keys(ASSET_STATUS_GROUPS)) {
      expect(ASSET_STATUS_GROUP_LABELS[key as keyof typeof ASSET_STATUS_GROUP_LABELS]).toBeTruthy();
    }
  });
});
