import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { MAX_PAGE_SIZE } from '@techpioasset/contracts';
import { REQUEST_STATUS_TOKENS } from '@techpioasset/ui-tokens';
import type { AssetStatus, RequestStatus } from '@techpioasset/domain';
import { useSession } from '../src/providers/session';
import { useTheme, statusLabel } from '../src/theme';
import { Card, PullRefresh, Screen, SectionTitle, StatCard } from '../src/components/ui';

interface Overview {
  assetsByStatus: Record<string, number>;
  totals: { assets: number };
}

/**
 * Asset figures come from /analytics/overview, which counts in the database.
 *
 * They used to be tallied from a page of rows the screen fetched itself, asking
 * for 500 of them - past the 100 the contract allows, so the request 422'd, the
 * .catch swallowed it, and every number on the page read zero. Counting rows
 * would have been wrong even when it worked: with 1,634 assets, a page of them
 * labelled "Total assets" is a sample presented as a total.
 *
 * Requests have no aggregate endpoint, so that breakdown is still counted from
 * rows - and says so, rather than implying it covers everything.
 */
export default function ReportsScreen() {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [requests, setRequests] = useState<{ status: RequestStatus }[]>([]);
  const [requestTotal, setRequestTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, r] = await Promise.all([
        api.request<Overview>('/analytics/overview').catch(() => null),
        api
          .request<{ status: RequestStatus }[]>(`/requests?pageSize=${MAX_PAGE_SIZE}`)
          .catch(() => []),
      ]);
      setOverview(o);
      setRequests(r ?? []);
      setRequestTotal((r ?? []).length);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  const tally = <T extends string>(rows: { status: T }[]) => {
    const m = new Map<T, number>();
    for (const row of rows) m.set(row.status, (m.get(row.status) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const assetRows = Object.entries(overview?.assetsByStatus ?? {}).sort((a, b) => b[1] - a[1]) as [
    AssetStatus,
    number,
  ][];

  return (
    <Screen scroll refreshControl={<PullRefresh refreshing={loading} onRefresh={load} />}>
      <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl }}>
        <StatCard icon="cube-outline" value={overview?.totals.assets ?? 0} label="Total assets" />
        <StatCard
          icon="document-text-outline"
          value={requestTotal ?? 0}
          label={`Recent requests${requestTotal === MAX_PAGE_SIZE ? ` (latest ${MAX_PAGE_SIZE})` : ''}`}
        />
      </View>

      <SectionTitle>Assets by status</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        {assetRows.map(([status, n], i) => (
          <BreakdownRow
            key={status}
            label={statusLabel(status)}
            count={n}
            last={i === assetRows.length - 1}
          />
        ))}
        {assetRows.length === 0 ? <Empty /> : null}
      </Card>

      <SectionTitle>
        {requestTotal === MAX_PAGE_SIZE
          ? `Requests by status (latest ${MAX_PAGE_SIZE})`
          : 'Requests by status'}
      </SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        {tally(requests).map(([status, n], i, arr) => (
          <BreakdownRow
            key={status}
            label={REQUEST_STATUS_TOKENS[status]?.label ?? status}
            count={n}
            last={i === arr.length - 1}
          />
        ))}
        {requests.length === 0 ? <Empty /> : null}
      </Card>

      <Text style={{ color: c.subtle, fontSize: 12, textAlign: 'center', lineHeight: 18 }}>
        Full CSV and Excel reports can be exported from the web app.
      </Text>
    </Screen>
  );
}

function BreakdownRow({ label, count, last }: { label: string; count: number; last: boolean }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 13,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.border,
      }}
    >
      <Text style={{ color: c.text, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>{count}</Text>
    </View>
  );
}

function Empty() {
  const { c } = useTheme();
  return <Text style={{ color: c.subtle, fontSize: 13, padding: 16 }}>No data yet.</Text>;
}
