import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT, type Tone } from '@techpioasset/ui-tokens';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Card, Chevron, EmptyState, IconBadge, ListSkeleton, PullRefresh, StatusPill } from '../src/components/ui';

export interface PoRow {
  id: string;
  poNumber: string;
  status: string;
  issuedDate: string | null;
  total: string;
  currency: string;
  vendor: { name: string } | null;
}

export const PO_TONE: Record<string, Tone> = {
  DRAFT: 'neutral',
  ISSUED: 'progress',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'neutral',
  CLOSED: 'neutral',
};

export const poLabel = (status: string) =>
  status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');

/** Purchase orders, receivable ones first — the loading-dock view. */
export default function PurchaseOrdersScreen() {
  const { api } = useSession();
  const router = useRouter();
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [rows, setRows] = useState<PoRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = (await api.request<PoRow[]>('/procurement/orders?pageSize=100')) ?? [];
      const receivable = (s: string) => s === 'ISSUED' || s === 'PARTIALLY_RECEIVED';
      setRows([...all].sort((a, b) => Number(receivable(b.status)) - Number(receivable(a.status))));
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.background }}
      data={rows}
      keyExtractor={(r) => r.id}
      refreshControl={<PullRefresh refreshing={loading} onRefresh={load} />}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 }}
      ListEmptyComponent={
        loading ? <ListSkeleton /> : (
          <EmptyState
            icon="cube-outline"
            title="No purchase orders"
            message="Orders converted from approved requests appear here to receive."
          />
        )
      }
      renderItem={({ item }) => {
        const tone = palette[PO_TONE[item.status] ?? 'neutral'];
        return (
          <Card
            onPress={() => router.push(`/purchase-order/${item.id}`)}
            style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
          >
            <IconBadge icon="cube-outline" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                {item.poNumber}
              </Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {[item.vendor?.name, `${Number(item.total).toLocaleString()} ${item.currency}`]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              <View style={{ marginTop: 8 }}>
                <StatusPill label={poLabel(item.status)} bg={tone.bg} fg={tone.fg} />
              </View>
            </View>
            <Chevron />
          </Card>
        );
      }}
    />
  );
}
