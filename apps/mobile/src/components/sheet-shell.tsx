import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useTheme } from '../theme';
import { Text } from './ui';
import { tapped } from '../lib/haptics';

/**
 * The frame every bottom sheet in the app sits in (U2).
 *
 * The sheets were bare `Modal animationType="slide"`: no grabber, no way to
 * swipe them away, and a backdrop that appeared at full strength the instant
 * the sheet did. Since the sheets are where the real work happens - a
 * handover, a condition photo, a stock count - this is where polish is worth
 * most.
 *
 * Three things it adds. A grabber, so it reads as something you can pull
 * down. A drag that follows your finger and lets go past a threshold, which
 * is how everyone expects a sheet to close. And a backdrop that fades in with
 * the sheet rather than snapping.
 *
 * Built on `PanResponder` from React Native itself rather than
 * react-native-gesture-handler: one sheet's vertical drag does not justify a
 * native dependency and a rebuild of the app shell.
 */
export function SheetShell({
  visible,
  title,
  subtitle,
  onClose,
  children,
  /** A sheet mid-edit asks first rather than vanishing on a stray swipe. */
  swipeToClose = true,
  headerRight,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  swipeToClose?: boolean;
  headerRight?: ReactNode;
}) {
  const { c, spacing, radius } = useTheme();
  const drag = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      drag.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    } else {
      fade.setValue(0);
    }
  }, [visible, drag, fade]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claim the gesture only for a deliberate downward drag, so a list
        // inside the sheet still scrolls normally.
        onMoveShouldSetPanResponder: (_e, g) =>
          swipeToClose && g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
        onPanResponderMove: (_e, g) => {
          if (g.dy > 0) drag.setValue(g.dy);
        },
        onPanResponderRelease: (_e, g) => {
          // Far enough, or flicked hard enough: let it go.
          if (g.dy > 120 || g.vy > 0.8) {
            tapped();
            Animated.timing(drag, {
              toValue: 600,
              duration: 160,
              useNativeDriver: true,
            }).start(onClose);
            return;
          }
          Animated.spring(drag, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
        },
      }),
    [drag, onClose, swipeToClose],
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'flex-end' }}
      >
        <Animated.View
          style={{
            ...StyleSheetAbsoluteFill,
            backgroundColor: 'rgba(2,6,23,0.45)',
            opacity: fade,
          }}
        >
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>

        <Animated.View
          style={{
            backgroundColor: c.background,
            borderTopLeftRadius: radius.xl + 2,
            borderTopRightRadius: radius.xl + 2,
            maxHeight: '92%',
            paddingBottom: spacing.xl,
            transform: [{ translateY: drag }],
          }}
          {...responder.panHandlers}
        >
          {/* The grabber. Says "you can pull this down" before you try. */}
          <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 4 }}>
            <View
              style={{ width: 38, height: 4, borderRadius: 999, backgroundColor: c.border }}
            />
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.sm,
              paddingBottom: spacing.lg,
              borderBottomWidth: 1,
              borderBottomColor: c.border,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="heading" weight="800" numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? (
                <Text variant="label" tone="muted" style={{ marginTop: 2 }} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {headerRight}
            <Pressable
              onPress={() => {
                tapped();
                onClose();
              }}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color={c.muted} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: spacing.lg }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Inlined rather than importing StyleSheet for one constant. */
const StyleSheetAbsoluteFill = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};
