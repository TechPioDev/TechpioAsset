import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { MenuTone } from '../lib/menu';
import { elevation, useTheme } from '../theme';
import type { IconName } from './ui';

/**
 * Card tiles for the phone menu (v2.58): a category card on the menu, an item
 * tile inside a category. Each category keeps one colour everywhere it appears,
 * so the colour itself becomes a way of finding things again.
 *
 * Tints are soft behind the icon and the icon carries the strong colour; label
 * text stays in the theme's ink so it reads in both light and dark.
 */

const TONES: Record<MenuTone, { light: [string, string]; dark: [string, string] }> = {
  // [icon colour, soft background]
  blue: { light: ['#2563eb', '#eff6ff'], dark: ['#60a5fa', '#172554'] },
  teal: { light: ['#0d9488', '#f0fdfa'], dark: ['#2dd4bf', '#134e4a'] },
  indigo: { light: ['#4f46e5', '#eef2ff'], dark: ['#818cf8', '#1e1b4b'] },
  amber: { light: ['#b45309', '#fffbeb'], dark: ['#fbbf24', '#451a03'] },
  violet: { light: ['#7c3aed', '#f5f3ff'], dark: ['#a78bfa', '#2e1065'] },
  green: { light: ['#15803d', '#f0fdf4'], dark: ['#4ade80', '#14532d'] },
  slate: { light: ['#475569', '#f1f5f9'], dark: ['#cbd5e1', '#1e293b'] },
};

export function useTone(tone: MenuTone) {
  const { scheme } = useTheme();
  const [fg, bg] = TONES[tone][scheme];
  return { fg, bg };
}

/** Two columns with an even gap, whatever the screen width. */
export function TileGrid({ children }: { children: ReactNode }) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>{children}</View>
  );
}

function IconBlock({ icon, tone, size }: { icon: string; tone: MenuTone; size: number }) {
  const { fg, bg } = useTone(tone);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon as IconName} size={size * 0.52} color={fg} />
    </View>
  );
}

export function CategoryCard({
  title,
  description,
  icon,
  tone,
  count,
  onPress,
}: {
  title: string;
  description: string;
  icon: string;
  tone: MenuTone;
  count: number;
  onPress: () => void;
}) {
  const { c, scheme, spacing, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${count} ${count === 1 ? 'option' : 'options'}`}
      style={({ pressed }) => ({
        // Two per row: half the width, less half the gap.
        flexBasis: '47%',
        flexGrow: 1,
        minHeight: 132,
        padding: spacing.lg,
        borderRadius: radius.lg,
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: c.border,
        opacity: pressed ? 0.7 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
        ...elevation(scheme),
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <IconBlock icon={icon} tone={tone} size={44} />
        <Text style={{ color: c.subtle, fontSize: 12, fontWeight: '600' }}>{count}</Text>
      </View>
      <Text style={{ color: c.text, fontSize: 15, fontWeight: '700', marginTop: spacing.md }}>
        {title}
      </Text>
      <Text style={{ color: c.muted, fontSize: 12, marginTop: 2, lineHeight: 16 }} numberOfLines={2}>
        {description}
      </Text>
    </Pressable>
  );
}

export function ItemTile({
  label,
  description,
  icon,
  tone,
  onPress,
}: {
  label: string;
  description: string;
  icon: string;
  tone: MenuTone;
  onPress: () => void;
}) {
  const { c, scheme, spacing, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      style={({ pressed }) => ({
        flexBasis: '47%',
        flexGrow: 1,
        minHeight: 118,
        padding: spacing.md,
        borderRadius: radius.lg,
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: c.border,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
        ...elevation(scheme),
      })}
    >
      <IconBlock icon={icon} tone={tone} size={48} />
      <Text
        style={{ color: c.text, fontSize: 14, fontWeight: '700', marginTop: spacing.sm, textAlign: 'center' }}
        numberOfLines={2}
      >
        {label}
      </Text>
      <Text
        style={{ color: c.muted, fontSize: 11, marginTop: 2, textAlign: 'center', lineHeight: 15 }}
        numberOfLines={2}
      >
        {description}
      </Text>
    </Pressable>
  );
}

/** A full-width row for search results, where the category matters as much as the item. */
export function ResultRow({
  label,
  group,
  icon,
  tone,
  onPress,
}: {
  label: string;
  group: string;
  icon: string;
  tone: MenuTone;
  onPress: () => void;
}) {
  const { c, spacing, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        padding: spacing.md,
        marginBottom: spacing.sm,
        borderRadius: radius.md,
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: c.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <IconBlock icon={icon} tone={tone} size={38} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: c.muted, fontSize: 12 }}>{group}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.subtle} />
    </Pressable>
  );
}
