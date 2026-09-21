import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, type ComponentProps, type ReactNode, type RefObject } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  type RefreshControlProps,
  ScrollView,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { useTheme, type ThemeColors } from '../theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Screen wrapper: themed background + consistent horizontal padding. */
export function Screen({
  children,
  scroll = false,
  padded = true,
  refreshControl,
  scrollRef,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  refreshControl?: ComponentProps<typeof ScrollView>['refreshControl'];
  /** With `scroll`, a handle on the list so a screen can bring one of its sections into view. */
  scrollRef?: RefObject<ScrollView | null>;
}) {
  const { c, spacing } = useTheme();
  const pad = padded ? { padding: spacing.lg } : undefined;
  if (scroll) {
    return (
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: c.background }}
        contentContainerStyle={[{ paddingBottom: spacing.xxl }, pad]}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    );
  }
  return <View style={[{ flex: 1, backgroundColor: c.background }, pad]}>{children}</View>;
}

/**
 * Pull-to-refresh in the brand colour (0.3.29).
 *
 * Every list already had a RefreshControl, but a bare one: Android drew its
 * default spinner on a white disc, which is a bright hole in the dark theme
 * and matched nothing else on the screen in the light one. This is the same
 * control with the theme applied, so a screen says what it refreshes and not
 * what colour it is.
 *
 * It has to stay a thin pass-through. On Android ScrollView clones whatever it
 * is given as `refreshControl` and hands it the scroll content as children and
 * a style, so every prop received is forwarded to the real RefreshControl.
 */
export function PullRefresh(props: RefreshControlProps) {
  const { c } = useTheme();
  return (
    <RefreshControl
      colors={[c.brand]}
      tintColor={c.brand}
      progressBackgroundColor={c.card}
      {...props}
    />
  );
}

/**
 * Placeholder rows for a list that has not loaded yet (0.3.29).
 *
 * Lists rendered nothing at all until their first response, so on a slow
 * connection a screen was a blank page under a spinner and read as broken or
 * empty. These are the outline of the cards about to arrive - an icon square
 * and two lines, which is what nearly every row in the app is - pulsing gently
 * so it reads as "coming" rather than "this is the content".
 *
 * Goes in a FlatList's ListEmptyComponent while loading, which is also why it
 * can never sit on top of real rows: a list with rows has no empty component.
 */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  const { c, radius, spacing } = useTheme();
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const bar = (width: `${number}%`, height: number, marginTop = 0) => (
    <View style={{ width, height, marginTop, borderRadius: 6, backgroundColor: c.border }} />
  );

  return (
    <Animated.View
      style={{ opacity: pulse }}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      {Array.from({ length: rows }, (_, index) => (
        <View
          key={index}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            backgroundColor: c.card,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: c.border,
            padding: 16,
            marginBottom: spacing.md,
          }}
        >
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.border }} />
          <View style={{ flex: 1 }}>
            {bar(index % 2 === 0 ? '70%' : '55%', 13)}
            {bar(index % 2 === 0 ? '40%' : '48%', 10, 9)}
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

/** Elevated surface. */
export function Card({
  children,
  style,
  onPress,
  level = 1,
}: {
  children: ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  level?: 1 | 2;
}) {
  const { c, radius, elevation } = useTheme();
  const base: ViewStyle = {
    backgroundColor: c.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: 16,
    ...elevation(level),
  };
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [base, style, pressed && { opacity: 0.85 }]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}

export function SectionTitle({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { c, spacing } = useTheme();
  return (
    <Text
      style={[
        {
          color: c.muted,
          fontSize: 12,
          fontWeight: '700',
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          marginBottom: spacing.sm,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Coloured status badge. Pass explicit bg/fg (from the shared tone tokens). */
export function StatusPill({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 3,
        alignSelf: 'flex-start',
      }}
    >
      <Text numberOfLines={1} style={{ color: fg, fontSize: 11, fontWeight: '700' }}>
        {label}
      </Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: ViewStyle;
}) {
  const { c, radius } = useTheme();
  const map: Record<'primary' | 'secondary' | 'danger' | 'ghost', { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.brand, fg: c.brandText },
    secondary: { bg: c.surface, fg: c.text, border: c.border },
    danger: { bg: 'transparent', fg: c.danger, border: c.danger },
    ghost: { bg: 'transparent', fg: c.brand },
  };
  const v = map[variant];
  const isOff = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isOff}
      style={({ pressed }) => [
        {
          backgroundColor: v.bg,
          borderRadius: radius.md,
          paddingVertical: 14,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          borderWidth: v.border ? 1 : 0,
          borderColor: v.border,
          opacity: isOff ? 0.5 : pressed ? 0.9 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={v.fg} /> : null}
          <Text style={{ color: v.fg, fontWeight: '700', fontSize: 15 }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  labelRight,
  ...props
}: { label?: string; labelRight?: ReactNode } & TextInputProps) {
  const { c, radius, spacing } = useTheme();
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? (
        // labelRight sits on the baseline of the label rather than under the
        // input, which is where "Forgot password?" belongs: beside the thing it
        // is about, not below the box you have just failed to fill in.
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 6,
          }}
        >
          <Text style={{ color: c.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
          {labelRight}
        </View>
      ) : null}
      <TextInput
        placeholderTextColor={c.subtle}
        style={{
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface,
          color: c.text,
          borderRadius: radius.md,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 15,
        }}
        {...props}
      />
    </View>
  );
}

/** Dashboard metric tile. */
export function StatCard({
  icon,
  value,
  label,
  tint,
  onPress,
}: {
  icon: IconName;
  value: string | number;
  label: string;
  tint?: string;
  onPress?: () => void;
}) {
  const { c, radius, elevation } = useTheme();
  const accent = tint ?? c.brand;
  // Icon beside the number rather than stacked above it. Eight of these open
  // the Home screen, and at 130px each they filled the phone before a single
  // asset was visible; this reads the same and takes about a third less height.
  const body = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: c.brandSoft,
          }}
        >
          <Ionicons name={icon} size={18} color={accent} />
        </View>
        <Text style={{ color: c.text, fontSize: 22, fontWeight: '800', flexShrink: 1 }} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Text style={{ color: c.muted, fontSize: 12, marginTop: 8 }} numberOfLines={2}>
        {label}
      </Text>
    </>
  );
  const base: ViewStyle = {
    flex: 1,
    backgroundColor: c.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: 12,
    ...elevation(1),
  };
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.85 }]}>
      {body}
    </Pressable>
  ) : (
    <View style={base}>{body}</View>
  );
}

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const { c } = useTheme();
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?';
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: c.brandSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: c.brand, fontWeight: '800', fontSize: size * 0.36 }}>{initials}</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
}: {
  icon: IconName;
  title: string;
  message?: string;
}) {
  const { c, spacing } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxl * 2, paddingHorizontal: spacing.lg }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 20,
          backgroundColor: c.surface,
          borderWidth: 1,
          borderColor: c.border,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.lg,
        }}
      >
        <Ionicons name={icon} size={30} color={c.subtle} />
      </View>
      <Text style={{ color: c.text, fontSize: 16, fontWeight: '700', textAlign: 'center' }}>
        {title}
      </Text>
      {message ? (
        <Text
          style={{
            color: c.muted,
            fontSize: 14,
            textAlign: 'center',
            marginTop: 6,
            lineHeight: 20,
            maxWidth: 280,
          }}
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
}

/** Simple icon in a tinted rounded square — used inside list rows. */
export function IconBadge({ icon, tint }: { icon: IconName; tint?: string }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: c.brandSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={20} color={tint ?? c.brand} />
    </View>
  );
}

export function Chevron() {
  const { c } = useTheme();
  return <Ionicons name="chevron-forward" size={18} color={c.subtle} />;
}

export type { ThemeColors, IconName };
