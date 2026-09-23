import { ASSET_STATUS_TOKENS, TONE_PALETTE_LIGHT, TONE_PALETTE_DARK } from '@techpioasset/ui-tokens';
import type { AssetStatus } from '@techpioasset/domain';

/**
 * The design tokens, with no React Native in them (U1).
 *
 * `theme.ts` reads the device's colour scheme, so it imports react-native and
 * cannot be loaded by vitest - the same wall `tablet-layout-rules.ts` was
 * split out from. The values themselves are plain data and the rules about
 * them (the scale only goes one way; a tint must be visible on its card) are
 * worth testing, so they live here and `theme.ts` re-exports them.
 */

export const colors = {
  light: {
    background: '#f1f5f9',
    surface: '#ffffff',
    card: '#ffffff',
    border: '#e2e8f0',
    text: '#0f172a',
    muted: '#64748b',
    subtle: '#94a3b8',
    // The brand blue, sampled from the wordmark (U1). It used to be
    // `#2563eb` - Tailwind's default blue, which appears nowhere in the
    // PioAssets artwork. This is the blue the word "Assets" is actually set
    // in, so the app and the logo finally agree. White on it is 8.9:1.
    //
    // The logo's orange (#F88808) is deliberately NOT here. It is 1.14
    // against the danger tone already used for overdue and faulty equipment -
    // the eye cannot separate them - so it stays on the logo's tick and
    // nowhere else in the interface.
    brand: '#0040b0',
    brandText: '#ffffff',
    brandSoft: '#e8f0ff',
    // The three roles the brand colour was doing with one value.
    // `brandStrong` is the pressed state of a brand surface; `brandSoftFg`
    // is what goes ON a soft tile, which is not the same colour as the fill
    // behind a white label.
    brandStrong: '#00318a',
    brandSoftFg: '#0040b0',
    /** A surface one step above `card` - a sheet over a screen, a raised row. */
    surfaceRaised: '#ffffff',
    /** What a pressable turns while the finger is down. */
    pressed: '#e2e8f0',
    danger: '#dc2626',
    dangerSoft: '#fef2f2',
    success: '#16a34a',
    warning: '#d97706',
    headerBg: '#ffffff',
    tabBar: '#ffffff',
    tabActive: '#0040b0',
    tabInactive: '#94a3b8',
  },
  dark: {
    background: '#0b1120',
    surface: '#111a2e',
    card: '#111a2e',
    border: '#1e293b',
    text: '#e2e8f0',
    muted: '#94a3b8',
    subtle: '#64748b',
    // The wordmark blue lifted for a dark ground: the deep #0040b0 is very
    // nearly black against #0b1120 (U1).
    brand: '#5aa9ff',
    // White on this is 2.46:1, far under the 4.5 AA floor - and white on the
    // OLD dark blue was 3.68, so the label on every primary button in the
    // dark theme had been failing since the theme was written. A light brand
    // colour takes dark ink, which is what the platforms' own dark themes do
    // and what the web app already did. 7.67:1.
    brandText: '#0b1120',
    // `#172554` on a `#111a2e` card was a 1.18 contrast ratio: every icon
    // tile, avatar and stat tile on the dark theme was a colour you had to be
    // told was there. Lifted, with its own foreground so the icon inside
    // reads at 8.3 instead of the brand blue's 3.
    brandSoft: '#12294f',
    brandStrong: '#8cc3ff',
    brandSoftFg: '#9cc8ff',
    surfaceRaised: '#1a2640',
    pressed: '#1e293b',
    danger: '#f87171',
    dangerSoft: '#3f1d1d',
    success: '#4ade80',
    warning: '#fbbf24',
    headerBg: '#0f172a',
    tabBar: '#0f172a',
    tabActive: '#5aa9ff',
    tabInactive: '#64748b',
  },
};

export type ThemeColors = (typeof colors)['light'];
export type Scheme = 'light' | 'dark';

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

/**
 * The type scale (U1).
 *
 * Before this there was none: 700-odd inline `fontSize` values across fifteen
 * different sizes, because every screen was measured by hand and nothing
 * agreed with anything else. Seven roles replace all of them. Sizes are named
 * for the job the text does, never for how big it is, so "make the label
 * smaller" is a change in one place rather than a hunt.
 *
 * `lineHeight` is set on every role. React Native does not inherit it, and
 * text without one sets solid on Android - which is why several screens had
 * lines touching each other in Hindi and Punjabi but not in English.
 */
export const type = {
  /** A screen's own name, once per screen. */
  display: { fontSize: 24, fontWeight: '800', lineHeight: 30, letterSpacing: -0.6 },
  /** A big number, or a sheet's title. */
  title: { fontSize: 20, fontWeight: '800', lineHeight: 26, letterSpacing: -0.4 },
  /** A card or section heading. */
  heading: { fontSize: 17, fontWeight: '700', lineHeight: 23, letterSpacing: -0.2 },
  /** Running text, and a list row's first line (use `weight="bold"` there). */
  body: { fontSize: 15, fontWeight: '500', lineHeight: 21 },
  /** Field labels, buttons, anything that names a control. */
  label: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  /** A list row's second line: tag, serial, date, quantity. */
  caption: { fontSize: 12, fontWeight: '500', lineHeight: 17 },
  /** Pills, tab labels, badge counts. Nothing smaller than this exists. */
  micro: { fontSize: 11, fontWeight: '600', lineHeight: 15 },
} as const;

export type TypeRole = keyof typeof type;

/**
 * Card elevation.
 *
 * Light mode is a soft shadow. Dark mode used to be `{}` - literally nothing,
 * so a dark screen was flat rectangles separated by hairlines. Shadows do not
 * read on a dark ground; the convention that does is *lighter surface means
 * higher*, so on dark this returns a background one step up instead (U1).
 */
export function elevation(scheme: Scheme, level: 1 | 2 = 1) {
  if (scheme === 'dark') {
    return level === 2 ? { backgroundColor: colors.dark.surfaceRaised } : {};
  }
  const base = level === 2 ? { opacity: 0.1, r: 16, y: 6 } : { opacity: 0.06, r: 8, y: 2 };
  return {
    shadowColor: '#0f172a',
    shadowOpacity: base.opacity,
    shadowRadius: base.r,
    shadowOffset: { width: 0, height: base.y },
    elevation: level * 2,
  };
}

export function statusColor(status: AssetStatus, scheme: Scheme) {
  const tone = ASSET_STATUS_TOKENS[status].tone;
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  return palette[tone];
}

export function statusLabel(status: AssetStatus): string {
  return ASSET_STATUS_TOKENS[status].label;
}
