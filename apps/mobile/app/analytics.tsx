import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { PERMISSIONS } from '@techpioasset/domain';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Card, EmptyState, PullRefresh, SectionTitle, StatCard, StatusPill } from '../src/components/ui';

/**
 * v2.6 A6 - the analytics summary. KPIs only; spend appears ONLY for
 * cost-visible callers (the API refuses regardless - this screen simply never
 * asks otherwise). Dimensions with no data say so, never an invented number.
 */

interface Overview {
  totals: {
    assets: number;
    activeUsers: number;
    openRequests: number;
    openWorkOrders: number;
    activeLicenses: number;
  };
  health: Record<string, number>;
  discoveryCoveragePct: number | null;
}

interface Spend {
  months: { month: string; assetSpend: number; maintenanceSpend: number }[];
}

interface Licenses {
  licenses: { id: string; name: string; utilizationPct: number | null }[];
  runway: Record<string, number>;
}

interface WorkOrders {
  openAging: Record<string, number>;
  slaBreachRatePct: number | null;
}

const GRADES = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'CRITICAL'] as const;
const GRADE_TONE: Record<string, 'success' | 'warning' | 'critical'> = {
  EXCELLENT: 'success',
  GOOD: 'success',
  FAIR: 'warning',
  POOR: 'critical',
  CRITICAL: 'critical',
};

export default function AnalyticsScreen() {
  const { api, user } = useSession();
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  const canSeeCost = !!user?.permissions.includes(PERMISSIONS.ASSETS_COST_READ);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [licenses, setLicenses] = useState<Licenses | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrders | null>(null);
  const [spendTotal, setSpendTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, l, w] = await Promise.all([
        api.request<Overview>('/analytics/overview'),
        api.request<Licenses>('/analytics/licenses'),
        api.request<WorkOrders>('/analytics/work-orders?months=6'),
      ]);
      setOverview(o);
      setLicenses(l);
      setWorkOrders(w);
      if (canSeeCost) {
        // Spend is fetched ONLY when the caller may see cost.
        const s = await api.request<Spend>('/analytics/spend?months=12');
        setSpendTotal(
          s.months.reduce((sum, m) => sum + m.assetSpend + m.maintenanceSpend, 0),
        );
      }
    } finally {
      setLoading(false);
    }
  }, [api, canSeeCost]);
  useEffect(() => void load(), [load]);

  if (!loading && !overview) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <EmptyState
          icon="stats-chart-outline"
          title="Analytics unavailable"
          message="Your role cannot read analytics, or the server is unreachable."
        />
      </View>
    );
  }

  const healthTotal = overview
    ? Object.values(overview.health).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
      refreshControl={<PullRefresh refreshing={loading} onRefresh={load} />}
    >
      {overview ? (
        <>
          <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md }}>
            <StatCard icon="cube-outline" value={overview.totals.assets} label="Assets" />
            <StatCard icon="people-outline" value={overview.totals.activeUsers} label="Active people" />
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md }}>
            <StatCard icon="clipboard-outline" value={overview.totals.openRequests} label="Open requests" />
            <StatCard icon="build-outline" value={overview.totals.openWorkOrders} label="Open work orders" />
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl }}>
            <StatCard
              icon="pulse-outline"
              value={overview.discoveryCoveragePct != null ? `${overview.discoveryCoveragePct}%` : '-'}
              label="Discovery coverage"
            />
            {canSeeCost && spendTotal != null ? (
              <StatCard
                icon="cash-outline"
                value={spendTotal.toLocaleString()}
                label="Spend, 12 months"
              />
            ) : (
              <StatCard icon="key-outline" value={overview.totals.activeLicenses} label="Active licenses" />
            )}
          </View>

          <SectionTitle>Fleet health</SectionTitle>
          <Card style={{ marginBottom: spacing.xl }}>
            {healthTotal === 0 ? (
              <Text style={{ color: c.muted, fontSize: 13 }}>
                No health scores yet - discovery has not reported any machines.
              </Text>
            ) : (
              GRADES.map((grade) => {
                const count = overview.health[grade] ?? 0;
                const tone = palette[GRADE_TONE[grade] ?? 'warning'];
                return (
                  <View
                    key={grade}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: 8 }}
                  >
                    <Text style={{ color: c.muted, fontSize: 12, width: 76 }}>
                      {grade.toLowerCase()}
                    </Text>
                    <View style={{ flex: 1, height: 8, borderRadius: 99, backgroundColor: c.border, overflow: 'hidden' }}>
                      <View
                        style={{
                          width: `${healthTotal ? Math.round((count / healthTotal) * 100) : 0}%`,
                          height: '100%',
                          backgroundColor: tone.fg,
                        }}
                      />
                    </View>
                    <Text style={{ color: c.text, fontSize: 12, fontVariant: ['tabular-nums'], width: 28, textAlign: 'right' }}>
                      {count}
                    </Text>
                  </View>
                );
              })
            )}
          </Card>
        </>
      ) : null}

      {workOrders ? (
        <>
          <SectionTitle>Work orders</SectionTitle>
          <Card style={{ marginBottom: spacing.xl }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <StatusPill
                label={
                  workOrders.slaBreachRatePct != null
                    ? `SLA breach ${workOrders.slaBreachRatePct}%`
                    : 'No SLAs in range'
                }
                bg={
                  (workOrders.slaBreachRatePct ?? 0) > 0 ? palette.critical.bg : palette.success.bg
                }
                fg={
                  (workOrders.slaBreachRatePct ?? 0) > 0 ? palette.critical.fg : palette.success.fg
                }
              />
            </View>
            <Text style={{ color: c.muted, fontSize: 12, marginTop: 10 }}>
              Open aging:{' '}
              {Object.entries(workOrders.openAging)
                .map(([bucket, count]) => `${bucket}d: ${count}`)
                .join('  ·  ')}
            </Text>
          </Card>
        </>
      ) : null}

      {licenses ? (
        <>
          <SectionTitle>License utilization</SectionTitle>
          <Card>
            {licenses.licenses.length === 0 ? (
              <Text style={{ color: c.muted, fontSize: 13 }}>No licenses on record.</Text>
            ) : (
              <>
                {licenses.licenses.slice(0, 6).map((l) => (
                  <View
                    key={l.id}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: 8 }}
                  >
                    <Text style={{ color: c.text, fontSize: 12, flex: 1 }} numberOfLines={1}>
                      {l.name}
                    </Text>
                    <View style={{ width: 90, height: 8, borderRadius: 99, backgroundColor: c.border, overflow: 'hidden' }}>
                      <View
                        style={{
                          width: `${l.utilizationPct ?? 0}%`,
                          height: '100%',
                          backgroundColor:
                            (l.utilizationPct ?? 0) >= 90 ? palette.critical.fg : c.brand,
                        }}
                      />
                    </View>
                    <Text style={{ color: c.muted, fontSize: 11, fontVariant: ['tabular-nums'], width: 34, textAlign: 'right' }}>
                      {l.utilizationPct != null ? `${l.utilizationPct}%` : '-'}
                    </Text>
                  </View>
                ))}
                <Text style={{ color: c.subtle, fontSize: 11, marginTop: 6 }}>
                  Expiry runway:{' '}
                  {Object.entries(licenses.runway)
                    .filter(([, count]) => count > 0)
                    .map(([bucket, count]) => `${bucket}: ${count}`)
                    .join('  ·  ') || 'nothing expiring'}
                </Text>
              </>
            )}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}
