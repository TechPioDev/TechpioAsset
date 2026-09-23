import { useColorScheme } from 'react-native';
import { useAppearance } from './providers/appearance';
import { colors, elevation, radius, spacing, type } from './lib/theme-tokens';
import type { Scheme, ThemeColors, TypeRole } from './lib/theme-tokens';

/**
 * Mobile theme. The tokens themselves live in `lib/theme-tokens.ts` - plain
 * data with no React Native in it, so the rules about them can be tested -
 * and are re-exported here so every screen keeps importing one place.
 *
 * Status colours come from the shared token package, so they match the web app
 * exactly (spec section 7).
 */
export { colors, elevation, radius, spacing, type, statusColor, statusLabel } from './lib/theme-tokens';
export type { Scheme, ThemeColors, TypeRole } from './lib/theme-tokens';

export interface Theme {
  scheme: Scheme;
  c: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  type: typeof type;
  elevation: (level?: 1 | 2) => ReturnType<typeof elevation>;
}

export function useTheme(): Theme {
  // The device setting is the default, not the rule: a stored preference of
  // light or dark overrides it, which is what Settings > Appearance sets.
  const system = (useColorScheme() ?? 'light') as Scheme;
  const { preference } = useAppearance();
  const scheme: Scheme = preference === 'system' ? system : preference;
  return {
    scheme,
    c: colors[scheme],
    spacing,
    radius,
    type,
    elevation: (level: 1 | 2 = 1) => elevation(scheme, level),
  };
}

export type { TypeRole as TypeRoleName };
