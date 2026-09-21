import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import { PERMISSIONS, workOrderActions } from '@techpioasset/domain';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Button, Card, EmptyState, IconBadge, ListSkeleton, PullRefresh, StatusPill } from '../src/components/ui';
import { WO_TONE, woLabel } from './work-orders';

/**
 * Every maintenance record. Each card opens the work order; a job assigned to
 * me that I have not accepted carries "Acknowledge" - the same accept call as
 * "My work orders", so work can start.
 */

interface MaintenanceRow {
  id: string;
  type: string;
  status: string;
  title: string;
  scheduledFor: string | null;
  technicianId: string | null;
  acceptedById: string | null;
  completedById: string | null;
  asset: { assetTag: string; name: string } | null;
  vendor: { name: string } | null;
}

export default function MaintenanceScreen() {
  const { api, user } = useSession();
  const { c, scheme, spacing } = useTheme();
  const router = useRouter();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  const [rows, setRows] = useState<MaintenanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const canManage = user?.permissions.includes(PERMISSIONS.MAINTENANCE_MANAGE) ?? false;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.request<MaintenanceRow[]>('/maintenance?pageSize=50')) ?? []);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  async function acknowledge(id: string) {
    setAcknowledging(id);
    try {
      await api.request(`/maintenance/${id}/accept`, { method: 'POST', body: {} });
      await load();
    } catch (error) {
      Alert.alert('Could not acknowledge', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setAcknowledging(null);
    }
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.background }}
      data={rows}
      keyExtractor={(r) => r.id}
      refreshControl={<PullRefresh refreshing={loading} onRefresh={load} />}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 }}
      ListEmptyComponent={
        loading ? <ListSkeleton /> : (
          <EmptyState icon="construct-outline" title="No maintenance records" message="Repairs and services logged against assets appear here." />
        )
      }
      renderItem={({ item }) => {
        const tone = palette[WO_TONE[item.status] ?? 'neutral'];
        const canAcknowledge = workOrderActions(item, { id: user?.id ?? '', canManage }).accept;
        return (
          <Card
            onPress={() => router.push(`/work-order/${item.id}`)}
            style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
          >
            <IconBadge icon="construct-outline" tint={tone.fg} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {item.asset ? `${item.asset.name} · ${item.asset.assetTag}` : item.type}
              </Text>
              <View style={{ flexDirection: 'row', marginTop: 8 }}>
                <StatusPill label={woLabel(item.status)} bg={tone.bg} fg={tone.fg} />
              </View>
              {canAcknowledge ? (
                <Button
                  label="Acknowledge"
                  icon="checkmark-circle-outline"
                  loading={acknowledging === item.id}
                  onPress={() => void acknowledge(item.id)}
                  style={{ marginTop: spacing.md, paddingVertical: 10 }}
                />
              ) : null}
            </View>
          </Card>
        );
      }}
    />
  );
}
