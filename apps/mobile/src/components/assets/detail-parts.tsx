import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { reportFreshnessWording, type DetailRow, type DetailTone } from '@techpioasset/domain';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT, type Tone } from '@techpioasset/ui-tokens';
import { useTheme } from '../../theme';
import type { IconName } from '../ui';
import { toast } from '../toast';

/**
 * The small pieces every asset-detail tab is built from (web: the Row, Tone and
 * ReportedFreshness components). The words come from the domain package; these
 * only decide how they sit on a phone.
 */

/** A value as a coloured badge, in the shared tone palette. */
export function ToneBadge({ tone, label }: { tone: Tone | DetailTone; label: string }) {
  const { scheme } = useTheme();
  const t = (scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT)[tone];
  return (
    <View
      style={{
        backgroundColor: t.bg,
        borderColor: t.border,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: t.fg, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

/** A tone's solid colour, for dots and bars. */
export function useToneColor(tone: Tone | DetailTone): string {
  const { scheme } = useTheme();
  return (scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT)[tone].fg;
}

/**
 * Puts a serial or MAC where it can be pasted (v2.62). The app ships no
 * clipboard module, so the system share sheet does the job - both platforms
 * list "Copy" in it - and on the browser build the page clipboard is used
 * directly. Long-pressing the value itself selects it as well.
 */
export async function copyValue(value: string, label: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      await navigator.clipboard.writeText(value);
      toast.say('Copied', `${label} copied to the clipboard.`);
      return;
    } catch {
      toast.say('Clipboard is blocked', `Select the ${label.toLowerCase()} and copy it instead.`);
      return;
    }
  }
  try {
    await Share.share({ message: value });
  } catch {
    toast.say('Could not open the share sheet', `Long-press the ${label.toLowerCase()} to select it.`);
  }
}

/** The small copy glyph after a copyable value; it confirms with a tick. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const { c } = useTheme();
  const [done, setDone] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Copy ${label}`}
      hitSlop={8}
      onPress={() => {
        void copyValue(value, label).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      style={{ paddingLeft: 6 }}
    >
      <Ionicons name={done ? 'checkmark' : 'copy-outline'} size={15} color={done ? c.success : c.subtle} />
    </Pressable>
  );
}

/**
 * One label/value line. Values wrap rather than truncate: a processor name or
 * a notes-derived model string is exactly what someone opened the tab to read.
 */
export function InfoRow({
  label,
  value,
  last = false,
  onPress,
  copy,
  mono = false,
}: {
  label: string;
  /** A string, a badge, or null for the dash. */
  value: ReactNode;
  last?: boolean;
  /** When set, the value reads as a link and the row opens something. */
  onPress?: () => void;
  /** When set, a copy glyph follows the value and the value is selectable. */
  copy?: string | null;
  /** Identifiers read better fixed-width. */
  mono?: boolean;
}) {
  const { c } = useTheme();
  const body = (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.border,
      }}
    >
      <Text style={{ color: c.muted, fontSize: 14 }}>{label}</Text>
      <View style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
        {value == null || typeof value === 'string' || typeof value === 'number' ? (
          <Text
            selectable={Boolean(copy)}
            style={{
              color: onPress ? c.brand : c.text,
              fontWeight: '600',
              fontSize: 14,
              textAlign: 'right',
              flexShrink: 1,
              ...(mono ? { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' } : {}),
            }}
          >
            {value ?? '—'}
          </Text>
        ) : (
          value
        )}
        {copy ? <CopyButton value={copy} label={label} /> : null}
      </View>
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="link">
      {body}
    </Pressable>
  ) : (
    body
  );
}

/** Shared domain rows, a badge where the row carries a tone. */
export function DetailRows({ rows }: { rows: DetailRow[] }) {
  return (
    <>
      {rows.map((row, i) => (
        <InfoRow
          key={row.label}
          label={row.label}
          value={row.tone && row.value != null ? <ToneBadge tone={row.tone} label={row.value} /> : row.value}
          last={i === rows.length - 1}
        />
      ))}
    </>
  );
}

/**
 * How old the agent's snapshot is, ahead of the data rather than under it: you
 * should know a snapshot is eighteen days old before reading it as fact.
 */
export function FreshnessBanner({ source, at }: { source: string; at: string }) {
  const { c, scheme, spacing, radius } = useTheme();
  const { freshness, headline, detail } = reportFreshnessWording(source, at, new Date(at).toLocaleString());
  const warn = (scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT).warning;

  if (freshness === 'stale') {
    return (
      <View
        style={{
          flexDirection: 'row',
          gap: spacing.sm,
          backgroundColor: warn.bg,
          borderColor: warn.border,
          borderWidth: 1,
          borderRadius: radius.md,
          padding: spacing.md,
          marginBottom: spacing.md,
        }}
      >
        <Ionicons name="warning-outline" size={18} color={warn.fg} style={{ marginTop: 1 }} />
        <Text style={{ color: warn.fg, fontSize: 13, lineHeight: 19, flex: 1 }}>
          <Text style={{ fontWeight: '700' }}>{headline}</Text> {detail}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md }}>
      <Ionicons name="refresh-outline" size={14} color={freshness === 'ageing' ? warn.fg : c.subtle} />
      <Text style={{ color: freshness === 'ageing' ? warn.fg : c.subtle, fontSize: 12, flex: 1 }}>
        {headline}
      </Text>
    </View>
  );
}

/**
 * The tab strip, scrolled sideways: ten web sections do not fit across a
 * phone, and squeezing them into equal thirds cut "OS & Security" to "OS &…".
 * Each tab carries the web nav's glyph, and a count (installed software) sits
 * in a small pill after the label rather than inside it.
 */
export function TabStrip<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: K; label: string; icon?: IconName; badge?: number }[];
  active: K;
  onChange: (key: K) => void;
}) {
  const { c, spacing } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginBottom: spacing.xl, flexGrow: 0 }}
      contentContainerStyle={{
        gap: 6,
        padding: 4,
        backgroundColor: c.card,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
      }}
    >
      {tabs.map((t) => {
        const on = t.key === active;
        const fg = on ? '#fff' : c.muted;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 9,
              backgroundColor: on ? c.brand : 'transparent',
            }}
          >
            {t.icon ? <Ionicons name={t.icon} size={15} color={fg} /> : null}
            <Text style={{ color: fg, fontWeight: '700', fontSize: 14 }}>{t.label}</Text>
            {t.badge ? (
              <View
                style={{
                  backgroundColor: on ? 'rgba(255,255,255,0.22)' : c.background,
                  borderRadius: 999,
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                }}
              >
                <Text style={{ color: fg, fontSize: 11, fontWeight: '700' }}>{t.badge}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * A card's heading with an optional action on the right - the web's
 * SectionTitle with its `action` slot, for "View full hardware details" and
 * the warranty standing badge.
 */
export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const { c, spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
        marginBottom: spacing.sm,
      }}
    >
      <Text style={{ color: c.text, fontSize: 15, fontWeight: '700', flexShrink: 1 }}>{children}</Text>
      {action}
    </View>
  );
}

/** A small brand-coloured "View X →" link at the foot of a card. */
export function CardLink({ label, onPress }: { label: string; onPress: () => void }) {
  const { c, spacing } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      hitSlop={6}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.md, alignSelf: 'flex-start' }}
    >
      <Text style={{ color: c.brand, fontSize: 13, fontWeight: '600' }}>{label}</Text>
      <Ionicons name="arrow-forward" size={13} color={c.brand} />
    </Pressable>
  );
}

/** The honest empty state for a tab with nothing reported (web: EmptyState). */
export function TabEmpty({ title, message }: { title: string; message: string }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 16 }}>
      <Ionicons name="search-outline" size={28} color={c.subtle} />
      <Text style={{ color: c.text, fontSize: 16, fontWeight: '700', marginTop: 12, textAlign: 'center' }}>
        {title}
      </Text>
      <Text style={{ color: c.muted, fontSize: 14, marginTop: 6, lineHeight: 20, textAlign: 'center' }}>
        {message}
      </Text>
    </View>
  );
}
