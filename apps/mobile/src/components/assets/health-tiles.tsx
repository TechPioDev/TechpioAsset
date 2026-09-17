import { Text, View } from 'react-native';
import type { HealthTile } from '@techpioasset/domain';
import { useTheme } from '../../theme';
import { useToneColor } from './detail-parts';

/**
 * The Device health strip's tiles (web: HealthTileCard). Which tiles exist is
 * the domain's deviceHealthTiles - only what the agent reported, never a
 * figure nobody measured - so this only draws them, two to a row.
 */
function Tile({ tile }: { tile: HealthTile }) {
  const { c, radius } = useTheme();
  const toneColor = useToneColor(tile.tone ?? 'muted');
  const color = tile.tone ? toneColor : c.text;
  return (
    <View
      style={{
        flexBasis: '48%',
        flexGrow: 1,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: radius.md,
        padding: 12,
      }}
      accessible
      accessibilityLabel={`${tile.label}: ${tile.value}${tile.hint ? `, ${tile.hint}` : ''}`}
    >
      <Text style={{ color: c.subtle, fontSize: 12 }}>{tile.label}</Text>
      <Text style={{ color, fontSize: 18, fontWeight: '700', marginTop: 4 }} numberOfLines={1}>
        {tile.value}
      </Text>
      {tile.percent != null ? (
        <View
          style={{
            height: 6,
            borderRadius: 3,
            backgroundColor: c.background,
            overflow: 'hidden',
            marginTop: 8,
          }}
        >
          <View
            style={{
              width: `${tile.percent}%`,
              height: '100%',
              borderRadius: 3,
              backgroundColor: tile.tone ? toneColor : c.brand,
            }}
          />
        </View>
      ) : null}
      {tile.hint ? <Text style={{ color: c.subtle, fontSize: 12, marginTop: 4 }}>{tile.hint}</Text> : null}
    </View>
  );
}

export function HealthTileGrid({ tiles }: { tiles: HealthTile[] }) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {tiles.map((tile, i) => (
        <Tile key={`${tile.key}-${i}`} tile={tile} />
      ))}
    </View>
  );
}
