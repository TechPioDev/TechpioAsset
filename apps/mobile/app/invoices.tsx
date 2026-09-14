import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { formatMoney } from '../src/lib/format';
import { Card, Chevron, EmptyState, IconBadge, StatusPill } from '../src/components/ui';

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  currency: string;
  total: string | null;
  paymentStatus: string;
  verificationStatus: string;
  vendor: { name: string } | null;
}

export default function InvoicesScreen() {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.request<InvoiceRow[]>('/invoices?pageSize=50')) ?? []);
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
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 }}
      ListEmptyComponent={
        loading ? null : (
          <EmptyState
            icon="document-attach-outline"
            title="No invoices yet"
            message="Upload one with Capture bill, or add invoices on the web."
          />
        )
      }
      renderItem={({ item }) => (
        <Card
          onPress={() => router.push(`/invoice/${item.id}`)}
          style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
        >
          <IconBadge icon="document-attach-outline" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
              {item.invoiceNumber}
            </Text>
            <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
              {item.vendor?.name ?? 'Unknown vendor'}
              {item.invoiceDate ? ` · ${new Date(item.invoiceDate).toLocaleDateString()}` : ''}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            {item.total ? (
              <Text style={{ color: c.text, fontWeight: '700' }}>{formatMoney(item.total, item.currency)}</Text>
            ) : null}
            <StatusPill label={item.paymentStatus} bg={c.brandSoft} fg={c.brand} />
          </View>
          <Chevron />
        </Card>
      )}
    />
  );
}
