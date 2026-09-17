import { Ionicons } from '@expo/vector-icons';
import { Fragment } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { MoreActionGroup, MoreActionKey } from '../../lib/asset-overview';
import { useTheme } from '../../theme';
import { AssetSheet } from './sheet';

/**
 * The "More actions" sheet (web: more-actions-menu.tsx, v2.61).
 *
 * Everything that used to be its own button in the header - receipt, edit,
 * the jumps to custody, transfer, disposal and price - lives here in groups,
 * so the header keeps one action (Report damage) in view. A bottom sheet
 * rather than an Alert: Android caps those at three buttons.
 */
export function MoreActionsSheet({
  visible,
  groups,
  assetName,
  onClose,
  onSelect,
}: {
  visible: boolean;
  groups: MoreActionGroup[];
  assetName: string;
  onClose: () => void;
  onSelect: (key: MoreActionKey) => void;
}) {
  const { c, spacing, radius } = useTheme();
  return (
    <AssetSheet visible={visible} title="More actions" subtitle={assetName} onClose={onClose}>
      {groups.map((group, gi) => (
        <Fragment key={group.title ?? gi}>
          {gi > 0 ? <View style={{ height: 1, backgroundColor: c.border, marginVertical: spacing.md }} /> : null}
          {group.title ? (
            <Text
              style={{
                color: c.muted,
                fontSize: 11,
                fontWeight: '700',
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                marginBottom: 6,
              }}
            >
              {group.title}
            </Text>
          ) : null}
          {group.items.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="menuitem"
              onPress={() => {
                onClose();
                onSelect(item.key);
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingVertical: 12,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                backgroundColor: pressed ? c.surface : 'transparent',
              })}
            >
              <Ionicons name={item.icon} size={20} color={c.muted} />
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '600', flex: 1 }}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={c.subtle} />
            </Pressable>
          ))}
        </Fragment>
      ))}
    </AssetSheet>
  );
}
