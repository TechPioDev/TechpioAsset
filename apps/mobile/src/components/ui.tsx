import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, type ComponentProps, type ReactNode, type RefObject } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  type RefreshControlProps,
  ScrollView,
  Text as RNText,
  type TextProps as RNTextProps,
  type TextStyle,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { useTheme, type ThemeColors, type TypeRole } from '../theme';
import { tapped } from '../lib/haptics';
import { FadeIn } from './motion';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Every piece of text in the app (U1).
 *
 * There was no such component, so each screen set `fontSize` and `color` by
 * hand: 700-odd inline declarations, fifteen sizes, five weights, and no two
 * screens agreeing. `variant` picks a role from the scale and `tone` picks an
 * ink; neither is a number, which is the point - a screen can no longer
 * invent a size, and changing the scale changes the app.
 *
 * `style` still wins where something genuinely is a one-off (a number tuned
 * to its tile). That escape hatch is deliberate: a component nobody can
 * override gets copied instead of used.
 */
export function Text({
  variant = 'body',
  tone = 'default',
  weight,
  numeric = false,
  style,
  ...props
}: {
  variant?: TypeRole;
  /** Which ink: the main one, the quieter one, a state, or on a brand fill. */
  tone?: 'default' | 'muted' | 'subtle' | 'brand' | 'danger' | 'success' | 'onBrand';
  /** Overrides the role's own weight, for a row's first line or a total. */
  weight?: TextStyle['fontWeight'];
  /**
   * Fixed-width digits (U3). For anything read as a figure rather than a
   * word: asset tags, serials, quantities, money, dates. In a proportional
   * face a 1 is narrower than a 0, so a column of numbers wobbles as it
   * updates and two tags of the same length do not line up.
   */
  numeric?: boolean;
} & RNTextProps) {
  const { c, type } = useTheme();
  const ink: Record<NonNullable<typeof tone>, string> = {
    default: c.text,
    muted: c.muted,
    subtle: c.subtle,
    brand: c.brand,
    danger: c.danger,
    success: c.success,
    onBrand: c.brandText,
  };
  return (
    <RNText
      {...props}
      style={[
        type[variant] as TextStyle,
        { color: ink[tone] },
        weight ? { fontWeight: weight } : null,
        numeric ? { fontVariant: ['tabular-nums' as const] } : null,
        style,
      ]}
    />
  );
}

/**
 * The feedback a pressable gives while the finger is on it (U1).
 *
 * Everything used to fade its whole self to `opacity: 0.85`, which is the
 * cheapest possible answer and reads as the screen dimming rather than the
 * control being pushed. A tinted ground plus a shade of scale reads as
 * physical. Pair it with `tapped()` on press.
 */
export function pressedStyle(pressed: boolean, tint: string): ViewStyle {
  return pressed ? { backgroundColor: tint, transform: [{ scale: 0.985 }] } : {};
}

/** Screen wrapper: themed background + consistent horizontal padding. */
export function Screen({
  children,
  scroll = false,
  padded = true,
  refreshControl,
  scrollRef,
  fade = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  refreshControl?: ComponentProps<typeof ScrollView>['refreshControl'];
  /** With `scroll`, a handle on the list so a screen can bring one of its sections into view. */
  scrollRef?: RefObject<ScrollView | null>;
  /**
   * Settle the content in rather than cutting to it (U4).
   *
   * For a screen that shows `DetailSkeleton` first: the swap from outline to
   * record was a hard cut, which reads as a flicker. Off by default, because
   * a screen you return to constantly should not re-animate every time.
   */
  fade?: boolean;
}) {
  const { c, spacing } = useTheme();
  const pad = padded ? { padding: spacing.lg } : undefined;
  const body = fade ? <FadeIn>{children}</FadeIn> : children;
  if (scroll) {
    return (
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: c.background }}
        contentContainerStyle={[{ paddingBottom: spacing.xxl }, pad]}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
      >
        {body}
      </ScrollView>
    );
  }
  return <View style={[{ flex: 1, backgroundColor: c.background }, pad]}>{body}</View>;
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

/**
 * The outline of a record's page while it loads (U2).
 *
 * `ListSkeleton` gave lists this treatment; detail screens kept a bare
 * spinner centred on an empty page, which says "something is happening
 * somewhere" and nothing else. Twelve screens had the identical block. This
 * is the shape of what is coming - a title, a status pill, a couple of cards
 * of facts - so the page appears to assemble rather than to flash.
 */
export function DetailSkeleton() {
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

  const block = (lines: number, key: number) => (
    <View
      key={key}
      style={{
        backgroundColor: c.card,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: c.border,
        padding: 16,
        marginBottom: spacing.md,
      }}
    >
      {Array.from({ length: lines }, (_, i) => bar(i === 0 ? '45%' : '80%', i === 0 ? 11 : 13, i ? 12 : 0))}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background, padding: spacing.lg }}>
      <Animated.View
        style={{ opacity: pulse }}
        accessibilityRole="progressbar"
        accessibilityLabel="Loading"
      >
        {bar('65%', 22)}
        {bar('35%', 13, 10)}
        <View style={{ width: 92, height: 22, borderRadius: 999, backgroundColor: c.border, marginTop: 14, marginBottom: spacing.xl }} />
        {[3, 2, 4].map((lines, i) => block(lines, i))}
      </Animated.View>
    </View>
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
        onPress={() => {
          tapped();
          onPress();
        }}
        style={({ pressed }) => [base, style, pressedStyle(pressed, c.pressed)]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}

export function SectionTitle({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { spacing } = useTheme();
  return (
    <Text
      variant="micro"
      tone="muted"
      weight="700"
      style={[{ letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: spacing.sm }, style]}
    >
      {children}
    </Text>
  );
}

/**
 * Coloured status badge. Pass explicit bg/fg (from the shared tone tokens).
 *
 * `quiet` is the same words with the colour turned down (U3): a dot in the
 * tone, then muted text on a hairline. An asset row carries up to four of
 * these - status, lifecycle, availability, condition - and as four filled
 * blocks a list of sixty assets was a field of colour with no hierarchy in
 * it. The first badge on a row stays solid and the rest go quiet, so the eye
 * lands on the status and the others are there when you look for them.
 * Nothing is hidden; only its shout is.
 */
export function StatusPill({
  label,
  bg,
  fg,
  variant = 'solid',
}: {
  label: string;
  bg: string;
  fg: string;
  variant?: 'solid' | 'quiet';
}) {
  const { c } = useTheme();
  if (variant === 'quiet') {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: c.border,
          paddingLeft: 7,
          paddingRight: 9,
          paddingVertical: 3,
          alignSelf: 'flex-start',
        }}
      >
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg }} />
        <Text variant="micro" tone="muted" numberOfLines={1}>
          {label}
        </Text>
      </View>
    );
  }
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
      <Text variant="micro" weight="700" numberOfLines={1} style={{ color: fg }}>
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
  // U1 - each variant now names the colour it turns while held, instead of
  // every button dimming itself to 0.9 opacity.
  const map: Record<
    'primary' | 'secondary' | 'danger' | 'ghost',
    { bg: string; fg: string; border?: string; held: string }
  > = {
    primary: { bg: c.brand, fg: c.brandText, held: c.brandStrong },
    secondary: { bg: c.surface, fg: c.text, border: c.border, held: c.pressed },
    danger: { bg: 'transparent', fg: c.danger, border: c.danger, held: c.dangerSoft },
    ghost: { bg: 'transparent', fg: c.brand, held: c.brandSoft },
  };
  const v = map[variant];
  const isOff = disabled || loading;
  return (
    <Pressable
      onPress={() => {
        tapped();
        onPress();
      }}
      disabled={isOff}
      accessibilityRole="button"
      accessibilityState={{ disabled: isOff, busy: loading }}
      style={({ pressed }) => [
        {
          backgroundColor: v.bg,
          borderRadius: radius.md,
          paddingVertical: 14,
          paddingHorizontal: 16,
          // 48 clears the 44pt minimum even when the label wraps to nothing.
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          borderWidth: v.border ? 1 : 0,
          borderColor: v.border,
          opacity: isOff ? 0.5 : 1,
        },
        style,
        pressed && !isOff ? pressedStyle(true, v.held) : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={v.fg} /> : null}
          <Text variant="body" weight="700" style={{ color: v.fg }}>
            {label}
          </Text>
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
          <Text variant="label">{label}</Text>
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
  // U1 - the icon sits ON the soft tile, so its default is the tile's own
  // foreground. `c.brand` was a 3:1 smudge on the dark theme's tint.
  const accent = tint ?? c.brandSoftFg;
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
        {/* Tabular figures so a column of tiles does not jitter as counts change. */}
        <Text
          variant="title"
          style={{ flexShrink: 1, fontVariant: ['tabular-nums'] }}
          numberOfLines={1}
        >
          {value}
        </Text>
      </View>
      <Text variant="caption" tone="muted" style={{ marginTop: 8 }} numberOfLines={2}>
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
    <Pressable
      onPress={() => {
        tapped();
        onPress();
      }}
      style={({ pressed }) => [base, pressedStyle(pressed, c.pressed)]}
    >
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
      {/* Sized off the circle, so this one stays a number rather than a role. */}
      <Text style={{ color: c.brandSoftFg, fontWeight: '800', fontSize: size * 0.36 }}>
        {initials}
      </Text>
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
      <Text variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {message ? (
        <Text
          variant="body"
          tone="muted"
          style={{ textAlign: 'center', marginTop: 6, maxWidth: 280 }}
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
      <Ionicons name={icon} size={20} color={tint ?? c.brandSoftFg} />
    </View>
  );
}

export function Chevron() {
  const { c } = useTheme();
  return <Ionicons name="chevron-forward" size={18} color={c.subtle} />;
}

export type { ThemeColors, IconName, TypeRole };
