import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { lastVerifiedLabel } from '@techpioasset/domain';
import { holderNameOf, type ScanAction, type ScannedAsset } from '../lib/scan-actions';
import { statusColor, statusLabel, useTheme } from '../theme';
import { AssetSheet } from './assets/sheet';
import { StatusPill } from './ui';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * What the scanner found, and what to do with it (0.3.31).
 *
 * Shown only to somebody with floor work to do on the unit (lib/scan-actions.ts
 * decides); everybody else goes straight to the asset page as they always did.
 * The acts are big because this is used one-handed, standing, holding the
 * device that was just scanned. "Open asset" comes first so the path that
 * existed before this sheet is still one tap.
 *
 * It names the unit, its status, who holds it and when it was last seen, since
 * the first question after a scan is "is this the one I think it is?".
 */
export function ScanResultSheet({
  asset,
  actions,
  busyKey,
  notice,
  onAction,
  onClose,
}: {
  /** Null keeps the sheet shut. */
  asset: ScannedAsset | null;
  actions: readonly ScanAction[];
  /** The act in flight, if any: it spins and the rest wait. */
  busyKey: string | null;
  /** Said under the unit's name: "Marked as seen", or why it could not be. */
  notice: { text: string; tone: 'ok' | 'error' } | null;
  onAction: (action: ScanAction) => void;
  onClose: () => void;
}) {
  const { c, radius, scheme, spacing } = useTheme();
  const tone = asset ? statusColor(asset.status, scheme) : null;
  const holder = asset ? holderNameOf(asset) : null;

  return (
    <AssetSheet
      visible={asset !== null}
      title={asset?.name ?? ''}
      subtitle={asset?.assetTag}
      onClose={onClose}
    >
      {asset && tone ? (
        <View style={{ marginBottom: spacing.md, gap: 6 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <StatusPill label={statusLabel(asset.status)} bg={tone.bg} fg={tone.fg} />
            <Text style={{ color: c.muted, fontSize: 13 }}>
              {holder ? `With ${holder}` : 'Not assigned to anyone'}
            </Text>
          </View>
          <Text style={{ color: c.subtle, fontSize: 12 }}>
            {lastVerifiedLabel(asset.lastVerification ?? null, new Date(), (d) => d.toLocaleDateString())}
          </Text>
          {notice ? (
            <Text
              accessibilityRole={notice.tone === 'error' ? 'alert' : 'text'}
              style={{ color: notice.tone === 'error' ? c.danger : c.success, fontSize: 13, fontWeight: '700' }}
            >
              {notice.text}
            </Text>
          ) : null}
        </View>
      ) : null}

      {actions.map((action) => {
        const busy = busyKey === action.key;
        const fg = action.tone === 'danger' ? c.danger : action.tone === 'primary' ? c.brand : c.text;
        return (
          <Pressable
            key={action.key}
            onPress={() => onAction(action)}
            disabled={busyKey !== null}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ disabled: busyKey !== null, busy }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              minHeight: 56,
              paddingHorizontal: spacing.md,
              marginBottom: spacing.sm,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: action.tone === 'primary' ? c.brand : c.border,
              backgroundColor: pressed ? c.surface : c.card,
              opacity: busyKey !== null && !busy ? 0.5 : 1,
            })}
          >
            {busy ? (
              <ActivityIndicator size="small" color={fg} />
            ) : (
              <Ionicons name={action.icon as IconName} size={22} color={fg} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ color: fg, fontSize: 15, fontWeight: '700' }}>{action.label}</Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 1 }}>{action.hint}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={c.subtle} />
          </Pressable>
        );
      })}

      <Pressable
        onPress={onClose}
        disabled={busyKey !== null}
        accessibilityRole="button"
        style={{ alignItems: 'center', paddingVertical: spacing.md }}
      >
        <Text style={{ color: c.brand, fontSize: 14, fontWeight: '700' }}>Scan another</Text>
      </Pressable>
    </AssetSheet>
  );
}
