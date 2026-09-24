import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { MAX_HEALTH, assetHealthSummary, type AssetHealth } from '@techpioasset/domain';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { useTheme } from '../theme';
import { Text } from './ui';

/**
 * How healthy a piece of equipment is, at a glance (v2.89).
 *
 * The score is derived rather than stored - see `assetHealth` in the domain -
 * so this only draws it. It carries the tone's colour AND the count in words,
 * because five shapes differing only in fill is exactly the readout that
 * fails somebody who cannot see the difference; the accessibility label
 * carries the whole claim, reasons included.
 */
export function HealthStars({ health, size = 'sm' }: { health: AssetHealth; size?: 'sm' | 'lg' }) {
  const { scheme } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  const colour = palette[health.tone].fg;
  const px = size === 'lg' ? 17 : 13;

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
      accessibilityRole="text"
      accessibilityLabel={`Condition score: ${assetHealthSummary(health)}`}
    >
      <View style={{ flexDirection: 'row', gap: 1 }} accessibilityElementsHidden>
        {Array.from({ length: MAX_HEALTH }, (_, i) => (
          <Ionicons key={i} name={i < health.stars ? 'star' : 'star-outline'} size={px} color={colour} />
        ))}
      </View>
      <Text variant={size === 'lg' ? 'label' : 'micro'} weight="700" style={{ color: colour }}>
        {health.stars}/{MAX_HEALTH}
      </Text>
    </View>
  );
}
