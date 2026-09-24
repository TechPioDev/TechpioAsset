import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, Share, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { SheetShell } from '../sheet-shell';
import { Button } from '../ui';

/**
 * The bottom-sheet chrome the people sheets share - same look as the hand-over
 * sheet, so managing a person does not feel like a different app.
 */
export function PeopleSheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // U2 - see AssetSheet: one shell, so the people sheets gained the grabber
  // and the swipe-down without their own copy of the chrome.
  return (
    <SheetShell visible={visible} title={title} subtitle={subtitle} onClose={onClose}>
      {children}
    </SheetShell>
  );
}

/** A small uppercase heading inside a sheet. */
export function SheetLabel({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return (
    <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>{children}</Text>
  );
}

/** Multi-select chips - the roles picker. */
export function ToggleChips({
  options,
  selected,
  onToggle,
  locked,
}: {
  options: { key: string; name: string; custom?: boolean }[];
  selected: readonly string[];
  onToggle: (key: string) => void;
  /** Rendered ticked and untappable - Super Admin on the account that holds it. */
  locked?: (key: string) => boolean;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = selected.includes(o.key);
        const isLocked = locked?.(o.key) ?? false;
        return (
          <Pressable
            key={o.key}
            onPress={() => onToggle(o.key)}
            disabled={isLocked}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: isLocked }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: on ? c.brand : c.border,
              backgroundColor: on ? c.brand : 'transparent',
              opacity: isLocked ? 0.6 : 1,
            }}
          >
            {on ? <Ionicons name="checkmark" size={14} color={c.brandText} /> : null}
            <Text style={{ color: on ? c.brandText : c.text, fontSize: 13, fontWeight: '600' }}>
              {o.name}
              {o.custom ? ' · custom' : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * An invitation link, shown once, with a way to hand it over. The app has no
 * clipboard module, so it goes through the share sheet - which offers Copy
 * anyway, next to the chat apps people actually hand links over in.
 */
export function InviteLink({ url }: { url: string }) {
  const { c, radius, spacing } = useTheme();
  return (
    <View style={{ marginTop: spacing.sm }}>
      <Text
        selectable
        style={{
          color: c.text,
          fontSize: 12,
          backgroundColor: c.surface,
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: radius.sm,
          padding: spacing.sm,
          marginBottom: spacing.sm,
        }}
      >
        {url}
      </Text>
      <Button
        label="Share or copy link"
        icon="share-outline"
        variant="secondary"
        onPress={() => void Share.share({ message: url }).catch(() => undefined)}
      />
    </View>
  );
}

export function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
