import { describe, expect, it } from 'vitest';
import { colors, elevation, type } from './theme-tokens';

/**
 * U1 - the type scale and the colour roles it needs.
 *
 * Before this the app set `fontSize` inline 700-odd times across fifteen
 * sizes, and the dark theme's brand tint was a 1.18 contrast ratio against
 * the card it sat on - an icon tile you had to be told was there. These are
 * the properties that stop both from coming back.
 */

/** WCAG 2.1 relative luminance, so the claims here are measured not asserted. */
function luminance(hex: string): number {
  const v = parseInt(hex.replace('#', ''), 16);
  const channels = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('the type scale', () => {
  const roles = Object.keys(type) as (keyof typeof type)[];

  it('gets smaller in one direction, with no two roles the same size', () => {
    const sizes = roles.map((r) => type[r].fontSize);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  it('never goes below 11pt, which is the floor for a pill or tab label', () => {
    for (const role of roles) expect(type[role].fontSize, role).toBeGreaterThanOrEqual(11);
  });

  it('sets a line height on every role', () => {
    // React Native does not inherit lineHeight, and text without one sets
    // solid on Android - which is how Hindi and Punjabi ended up touching.
    for (const role of roles) {
      expect(type[role].lineHeight, role).toBeGreaterThan(type[role].fontSize);
    }
  });
});

describe('the dark theme has depth', () => {
  it('raises a level-2 surface instead of returning nothing', () => {
    // It used to be `{}` on dark: shadows do not read on a dark ground, so
    // every card was flat. Lighter surface = higher is the answer that does.
    const raised = elevation('dark', 2) as { backgroundColor?: string };
    expect(raised.backgroundColor).toBe(colors.dark.surfaceRaised);
    expect(contrast(colors.dark.surfaceRaised, colors.dark.card)).toBeGreaterThan(1.05);
  });

  it('still casts a shadow on light', () => {
    expect(elevation('light', 1)).toHaveProperty('shadowOpacity');
  });
});

describe('a tinted tile is visible in both themes', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const c = colors[scheme];

    it(`${scheme}: the tint is distinguishable from the card behind it`, () => {
      expect(contrast(c.brandSoft, c.card)).toBeGreaterThan(1.05);
    });

    it(`${scheme}: the icon on that tint clears AA for a UI component`, () => {
      // 3:1 is the bar for a graphical object. The dark theme's icon used to
      // be `c.brand` on `#172554`, which did not reach it.
      expect(contrast(c.brandSoftFg, c.brandSoft)).toBeGreaterThanOrEqual(3);
    });

    it(`${scheme}: white-on-brand button text clears AA for normal text`, () => {
      expect(contrast(c.brandText, c.brand)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${scheme}: the pressed tint differs from the resting surface`, () => {
      expect(c.pressed).not.toBe(c.surface);
      expect(c.brandStrong).not.toBe(c.brand);
    });
  }
});
