import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import {
  MAINTENANCE_OPEN_STATUSES,
  PERMISSIONS,
  maintenanceStatusLabel,
  workOrderActions,
} from '@techpioasset/domain';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Button, Card, EmptyState, IconBadge, StatusPill } from '../src/components/ui';

/**
 * v2.5 H6 - the technician's work-order list. "Mine" is the default (the jobs
 * on my plate, SLA-overdue first); "All open" shows the rest of the queue.
 * A job assigned to me that I have not accepted carries its Accept button on
 * the card - work cannot start until it is pressed.
 */

export interface WorkOrderRow {
  id: string;
  type: string;
  status: string;
  title: string;
  scheduledFor: string | null;
  technicianId: string | null;
  acceptedById: string | null;
  completedById: string | null;
  slaDueAt: string | null;
  escalatedAt: string | null;
  asset: { id: string; assetTag: string; name: string } | null;
}

export const WO_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'critical' | 'muted'> = {
  REQUESTED: 'neutral',
  SCHEDULED: 'info',
  IN_PROGRESS: 'warning',
  ON_HOLD: 'neutral',
  AWAITING_APPROVAL: 'info',
  COMPLETED: 'success',
  CANCELLED: 'muted',
  FAILED: 'critical',
};

/** "Awaiting approval", and "Closed" for a signed-off (COMPLETED) order. */
export function woLabel(status: string): string {
  return maintenanceStatusLabel(status);
}

export function isSlaOverdue(row: { slaDueAt: string | null; status: string }): boolean {
  return (
    row.slaDueAt != null &&
    new Date(row.slaDueAt).getTime() < Date.now() &&
    !['COMPLETED', 'CANCELLED', 'FAILED'].includes(row.status)
  );
}

// Open work, including jobs finished and waiting on a manager's sign-off.
const OPEN: readonly string[] = MAINTENANCE_OPEN_STATUSES;

export default function WorkOrdersScreen() {
  const { api, user } = useSession();
  const { c, scheme, spacing } = useTheme();
  const router = useRouter();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState<string | null>(null);
  const canManage = user?.permissions.includes(PERMISSIONS.MAINTENANCE_MANAGE) ?? false;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = scope === 'mine' ? `&technicianId=${user?.id ?? ''}` : '';
      const all = (await api.request<WorkOrderRow[]>(`/maintenance?pageSize=100${query}`)) ?? [];
      const open = all.filter((r) => OPEN.includes(r.status));
      // Overdue SLAs first, then soonest deadline, then newest.
      open.sort((a, b) => {
        const overdue = Number(isSlaOverdue(b)) - Number(isSlaOverdue(a));
        if (overdue !== 0) return overdue;
        const dueA = a.slaDueAt ? new Date(a.slaDueAt).getTime() : Infinity;
        const dueB = b.slaDueAt ? new Date(b.slaDueAt).getTime() : Infinity;
        return dueA - dueB;
      });
      setRows(open);
    } finally {
      setLoading(false);
    }
  }, [api, scope, user?.id]);
  useEffect(() => void load(), [load]);

  async function accept(id: string) {
    setAccepting(id);
    try {
      await api.request(`/maintenance/${id}/accept`, { method: 'POST', body: {} });
      await load();
    } catch (error) {
      Alert.alert('Could not accept', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setAccepting(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, paddingBottom: 0 }}>
        {(
          [
            ['mine', 'Mine'],
            ['all', 'All open'],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setScope(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: scope === key }}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: 99,
              backgroundColor: scope === key ? c.brand : c.surface,
              borderWidth: 1,
              borderColor: scope === key ? c.brand : c.border,
            }}
          >
            <Text
              style={{
                color: scope === key ? c.brandText : c.muted,
                fontWeight: '600',
                fontSize: 13,
              }}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 }}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="build-outline"
              title={scope === 'mine' ? 'Nothing on your plate' : 'No open work orders'}
              message={
                scope === 'mine'
                  ? 'Work orders assigned to you appear here, overdue first.'
                  : 'Open repairs and services appear here.'
              }
            />
          )
        }
        renderItem={({ item }) => {
          const tone = palette[WO_TONE[item.status] ?? 'neutral'];
          const overdue = isSlaOverdue(item);
          const canAccept = workOrderActions(item, { id: user?.id ?? '', canManage }).accept;
          return (
            <Card
              onPress={() => router.push(`/work-order/${item.id}`)}
              style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
            >
              <IconBadge icon="build-outline" tint={overdue ? c.danger : undefined} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {item.asset ? `${item.asset.assetTag} · ` : ''}
                  {item.type.toLowerCase()}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  <StatusPill label={woLabel(item.status)} bg={tone.bg} fg={tone.fg} />
                  {item.slaDueAt ? (
                    <StatusPill
                      label={
                        overdue
                          ? `SLA overdue${item.escalatedAt ? ' · escalated' : ''}`
                          : `due ${new Date(item.slaDueAt).toLocaleDateString()}`
                      }
                      bg={overdue ? palette.critical.bg : palette.info.bg}
                      fg={overdue ? palette.critical.fg : palette.info.fg}
                    />
                  ) : null}
                </View>
                {canAccept ? (
                  <Button
                    label="Accept"
                    icon="checkmark-circle-outline"
                    loading={accepting === item.id}
                    onPress={() => void accept(item.id)}
                    style={{ marginTop: spacing.md, paddingVertical: 10 }}
                  />
                ) : null}
              </View>
            </Card>
          );
        }}
      />
    </View>
  );
}
