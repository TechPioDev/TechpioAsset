import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { Text } from './ui';
import { committed, refused } from '../lib/haptics';
import {
  expireToasts,
  pushToast,
  toneForMessage,
  type Toast,
  type ToastTone,
} from '../lib/toast-queue';

/**
 * What the app says when it is telling you rather than asking you (U2).
 *
 * 93 native `Alert.alert` calls said things like "Count recorded" and "Could
 * not download the report". A native alert stops the app, dims the screen and
 * waits for a tap - correct for a decision, wrong for a statement. These
 * arrive over the top of the screen, say the same thing, and leave.
 *
 * The API is a module-level object rather than a hook on purpose. Those 93
 * call sites are inside `catch` blocks, async helpers and plain functions,
 * most of which are not components and cannot hold a hook. `toast.error(...)`
 * works anywhere, which is what made converting them safe rather than a
 * rewrite of every screen's structure.
 *
 * With no host mounted - a test, a screen rendered in isolation - every call
 * is a no-op. A message failing to appear must never take the app down with
 * it, least of all the message that says something already went wrong.
 */

type Listener = (t: Toast[]) => void;

let queue: Toast[] = [];
let listener: Listener | null = null;

function emit(next: Toast[]) {
  queue = next;
  listener?.(queue);
}

function show(tone: ToastTone, title: string, body?: string) {
  emit(pushToast(queue, { tone, title, body }, Date.now()));
  if (tone === 'error') refused();
  else if (tone === 'success') committed();
}

export const toast = {
  success: (title: string, body?: string) => show('success', title, body),
  error: (title: string, body?: string) => show('error', title, body),
  info: (title: string, body?: string) => show('info', title, body),
  /**
   * For a converted native alert whose tone is carried by
   * its own wording - "Could not save" is a failure, "Count recorded" is not.
   * Lets a mechanical replacement keep the original words and still get the
   * right colour.
   */
  say: (title: string, body?: string) => show(toneForMessage(title), title, body),
  /** Clears everything - used when a screen deliberately takes over. */
  clear: () => emit([]),
};

/** One message. Slides down as it arrives, fades as it goes. */
function ToastRow({ item, onDismiss }: { item: Toast; onDismiss: (id: string) => void }) {
  const { c, radius, spacing, elevation } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 9, tension: 70 }).start();
  }, [anim]);

  const look: Record<ToastTone, { bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap }> =
    {
      success: { bg: c.success, fg: '#ffffff', icon: 'checkmark-circle' },
      error: { bg: c.danger, fg: '#ffffff', icon: 'alert-circle' },
      info: { bg: c.card, fg: c.text, icon: 'information-circle' },
    };
  const v = look[item.tone];

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
      }}
    >
      <Pressable
        onPress={() => onDismiss(item.id)}
        accessibilityRole="alert"
        accessibilityLabel={`${item.title}${item.body ? `. ${item.body}` : ''}`}
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: spacing.md,
          backgroundColor: v.bg,
          borderRadius: radius.lg,
          borderWidth: item.tone === 'info' ? 1 : 0,
          borderColor: c.border,
          paddingVertical: 12,
          paddingHorizontal: 14,
          marginBottom: spacing.sm,
          ...elevation(2),
        }}
      >
        <Ionicons name={v.icon} size={20} color={v.fg} style={{ marginTop: 1 }} />
        <View style={{ flex: 1 }}>
          <Text variant="label" weight="700" style={{ color: v.fg }}>
            {item.title}
          </Text>
          {item.body ? (
            <Text variant="caption" style={{ color: v.fg, opacity: 0.9, marginTop: 2 }}>
              {item.body}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Mounted once, above everything. Sits under the status bar so it never
 * covers the header's own controls, and passes touches through everywhere it
 * is not drawing - a message must not block the button you are reaching for.
 */
export function ToastHost() {
  const insets = useSafeAreaInsets();
  const { spacing } = useTheme();
  const [items, setItems] = useState<Toast[]>(queue);

  useEffect(() => {
    listener = setItems;
    return () => {
      listener = null;
    };
  }, []);

  // One timer for the whole host rather than one per message.
  useEffect(() => {
    if (items.length === 0) return;
    const id = setInterval(() => emit(expireToasts(queue, Date.now())), 500);
    return () => clearInterval(id);
  }, [items.length]);

  if (items.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + spacing.sm,
        left: spacing.lg,
        right: spacing.lg,
        zIndex: 1000,
      }}
    >
      {items.map((item) => (
        <ToastRow
          key={item.id}
          item={item}
          onDismiss={(id) => emit(queue.filter((t) => t.id !== id))}
        />
      ))}
    </View>
  );
}
