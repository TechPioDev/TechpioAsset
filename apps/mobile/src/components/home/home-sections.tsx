import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { QueueKey, QuickAction } from '../../lib/home-plan';
import { QUEUES, type QueueRow } from '../../lib/home-queues';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { useT } from '../../providers/language';
import type { StringKey } from '../../i18n/strings';
import { Card, Chevron, SectionTitle } from '../ui';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Home's quick actions (0.3.30): the two to four things this role does most,
 * one tap from the first screen instead of two levels into Menu. Which ones is
 * decided by lib/home-plan.ts; this only draws them, as a row of equal tiles so
 * a thumb can find them without reading.
 */
/** v2.84 - the four buttons an employee uses most, in their language. */
const ACTION_KEY: Partial<Record<string, StringKey>> = {
  request: 'home.action.request',
  problem: 'home.action.problem',
  equipment: 'home.action.equipment',
  scan: 'home.action.scan',
};

export function QuickActions({ actions }: { actions: readonly QuickAction[] }) {
  const router = useRouter();
  const t = useT();
  const { c, radius, spacing } = useTheme();
  if (actions.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl }}>
      {actions.map((action) => (
        <Pressable
          key={action.key}
          onPress={() => router.push(action.href as never)}
          accessibilityRole="button"
          accessibilityLabel={ACTION_KEY[action.key] ? t(ACTION_KEY[action.key]!) : action.label}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 76,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingHorizontal: 4,
            paddingVertical: spacing.sm,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: pressed ? c.surface : c.card,
          })}
        >
          <Ionicons name={action.icon as IconName} size={22} color={c.brand} />
          <Text
            numberOfLines={2}
            style={{
              color: c.text,
              fontSize: 11.5,
              fontWeight: '700',
              textAlign: 'center',
              lineHeight: 14,
            }}
          >
            {ACTION_KEY[action.key] ? t(ACTION_KEY[action.key]!) : action.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * One work queue on Home (0.3.30): the first few things waiting for this
 * person, each opening the item itself, with "See all" for the rest.
 *
 * Renders nothing while it loads, when it is empty and when it fails - see
 * lib/home-queues.ts for why. `refreshKey` changes when Home is pulled to
 * refresh, so the queues reload with everything else on the screen.
 */
export function HomeQueue({ queue, refreshKey }: { queue: QueueKey; refreshKey: number }) {
  const { api, user } = useSession();
  const router = useRouter();
  const { c, spacing } = useTheme();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const spec = QUEUES[queue];
  const userId = user?.id ?? '';

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    api
      .request<unknown>(spec.path(userId))
      .then((payload) => {
        if (alive) setRows(spec.rows(payload, new Date()));
      })
      .catch(() => {
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [api, spec, userId, refreshKey]);

  if (rows.length === 0) return null;

  const toneColor = (tone: QueueRow['tone']) =>
    tone === 'danger' ? c.danger : tone === 'warning' ? c.warning : c.muted;

  return (
    <View style={{ marginBottom: spacing.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <SectionTitle>{spec.title}</SectionTitle>
        <Pressable onPress={() => router.push(spec.seeAllHref as never)} hitSlop={8}>
          <Text style={{ color: c.brand, fontSize: 13, fontWeight: '700' }}>See all</Text>
        </Pressable>
      </View>
      {rows.map((row) => (
        <Card
          key={row.id}
          onPress={() => router.push(row.href as never)}
          style={{
            marginBottom: spacing.sm,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
          }}
        >
          <Ionicons name={spec.icon as IconName} size={20} color={toneColor(row.tone)} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>
              {row.title}
            </Text>
            {row.subtitle ? (
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {row.subtitle}
              </Text>
            ) : null}
            {row.badge ? (
              <Text
                style={{
                  color: toneColor(row.tone),
                  fontSize: 12,
                  fontWeight: '700',
                  marginTop: 4,
                }}
                numberOfLines={1}
              >
                {row.badge}
              </Text>
            ) : null}
          </View>
          <Chevron />
        </Card>
      ))}
    </View>
  );
}
