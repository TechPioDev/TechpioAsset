import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Card, EmptyState, IconBadge, ListSkeleton, PullRefresh } from '../src/components/ui';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  createdAt: string;
  actor: { email: string; profile: { displayName: string | null } | null } | null;
}

function pretty(action: string): string {
  const s = action.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function AuditScreen() {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.request<AuditRow[]>('/audit?pageSize=50')) ?? []);
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
      ListEmptyComponent={loading ? <ListSkeleton /> : <EmptyState icon="time-outline" title="No audit entries" />}
      renderItem={({ item }) => {
        const who = item.actor?.profile?.displayName ?? item.actor?.email ?? 'System';
        return (
          <Card style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <IconBadge icon="time-outline" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>
                {pretty(item.action)}
              </Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {item.entityType} · {who}
              </Text>
            </View>
            <Text style={{ color: c.subtle, fontSize: 11 }}>
              {new Date(item.createdAt).toLocaleDateString()}
            </Text>
          </Card>
        );
      }}
    />
  );
}
