import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import {
  REQUEST_STATUS_TOKENS,
  TONE_PALETTE_DARK,
  TONE_PALETTE_LIGHT,
} from '@techpioasset/ui-tokens';
import type { RequestStatus } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { personName, formatMoney } from '../../src/lib/format';
import { Avatar, Card, Chevron, EmptyState, ListSkeleton, PullRefresh, StatusPill } from '../../src/components/ui';

interface ApprovalRow {
  id: string;
  requestNumber: string;
  status: RequestStatus;
  currentStep: { name: string; kind: string } | null;
  businessReason: string;
  estimatedCost: string | null;
  currency: string;
  requester: {
    email: string;
    profile: { firstName: string | null; lastName: string | null } | null;
  } | null;
  items: { id: string; description: string; quantity: number }[];
}

/** The signed-in user's queue - every request whose live step points at them,
 *  whether it is theirs to approve or theirs to answer. */
export default function ApprovalsScreen() {
  const { api } = useSession();
  const router = useRouter();
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.request<ApprovalRow[]>('/requests?awaitingMe=true&pageSize=50');
      setRows(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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
            icon="checkmark-done-outline"
            title="You're all caught up"
            message="Nothing is waiting on you right now."
          />
        )
      }
      renderItem={({ item }) => {
        const tone = palette[REQUEST_STATUS_TOKENS[item.status].tone];
        const who = personName(item.requester);
        const summary = item.items
          .map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.description}` : i.description))
          .join(', ');
        return (
          <Card
            onPress={() => router.push(`/request/${item.id}`)}
            style={{ marginBottom: spacing.md }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar name={who} size={40} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Text
                    style={{ color: c.text, fontWeight: '700', fontSize: 14, flexShrink: 1 }}
                    numberOfLines={1}
                  >
                    {item.requestNumber}
                  </Text>
                  <StatusPill
                    label={item.currentStep?.name ?? REQUEST_STATUS_TOKENS[item.status].label}
                    bg={tone.bg}
                    fg={tone.fg}
                  />
                </View>
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>{who}</Text>
              </View>
            </View>
            <Text style={{ color: c.text, fontSize: 14, marginTop: spacing.md }} numberOfLines={2}>
              {summary || item.businessReason}
            </Text>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: spacing.md,
                paddingTop: spacing.md,
                borderTopWidth: 1,
                borderTopColor: c.border,
              }}
            >
              {item.estimatedCost ? (
                <Text style={{ color: c.text, fontWeight: '700' }}>
                  {formatMoney(item.estimatedCost, item.currency)}
                </Text>
              ) : (
                <Text style={{ color: c.subtle, fontSize: 13 }}>No estimate</Text>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ color: c.brand, fontWeight: '600', fontSize: 13 }}>Review</Text>
                <Chevron />
              </View>
            </View>
          </Card>
        );
      }}
    />
  );
}
