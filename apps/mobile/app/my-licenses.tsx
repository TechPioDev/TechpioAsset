import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Card, EmptyState, IconBadge, ListSkeleton, PullRefresh } from '../src/components/ui';
import { expiryText } from './licenses';

interface MySeat {
  id: string;
  assignedAt: string;
  license: {
    id: string;
    name: string;
    edition: string | null;
    expiryDate: string | null;
    status: string;
  };
}

/** The software seats issued to the signed-in user. No permission needed. */
export default function MyLicensesScreen() {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [rows, setRows] = useState<MySeat[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.request<MySeat[]>('/licenses/mine')) ?? []);
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
            icon="key-outline"
            title="No licences assigned"
            message="Software seats issued to you appear here."
          />
        )
      }
      renderItem={({ item }) => (
        <Card style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <IconBadge icon="key-outline" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
              {item.license.name}
            </Text>
            <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
              {[
                item.license.edition,
                expiryText(item.license.expiryDate),
                `yours since ${new Date(item.assignedAt).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </Card>
      )}
    />
  );
}
