import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT, type Tone } from '@techpioasset/ui-tokens';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Card, Chevron, EmptyState, IconBadge, ListSkeleton, PullRefresh, StatusPill } from '../src/components/ui';

export interface LicenseRow {
  id: string;
  name: string;
  edition: string | null;
  unitOfAssignment: 'USER' | 'DEVICE';
  status: 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'RETIRED';
  expiryDate: string | null;
  seatsPurchased: number;
  seatsReserved: number;
  seatsAvailable: number;
  vendor: { name: string } | null;
}

export const LICENSE_TONE: Record<LicenseRow['status'], Tone> = {
  ACTIVE: 'success',
  EXPIRING: 'warning',
  EXPIRED: 'critical',
  RETIRED: 'neutral',
};

export const LICENSE_LABEL: Record<LicenseRow['status'], string> = {
  ACTIVE: 'Active',
  EXPIRING: 'Expiring',
  EXPIRED: 'Expired',
  RETIRED: 'Retired',
};

const DAY = 86_400_000;
export function expiryText(expiryDate: string | null): string {
  if (!expiryDate) return 'Perpetual';
  const days = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / DAY);
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days <= 90) return `${days}d left`;
  return new Date(expiryDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Licences with their live seat counts (licenses:read — menu-gated, API-enforced). */
export default function LicensesScreen() {
  const { api } = useSession();
  const router = useRouter();
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [rows, setRows] = useState<LicenseRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.request<LicenseRow[]>('/licenses?pageSize=100')) ?? []);
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
            title="No licenses yet"
            message="Licences registered on the web appear here with their live seat counts."
          />
        )
      }
      renderItem={({ item }) => {
        const tone = palette[LICENSE_TONE[item.status]];
        const full = item.seatsPurchased > 0 && item.seatsReserved >= item.seatsPurchased;
        return (
          <Card
            onPress={() => router.push(`/license/${item.id}`)}
            style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
          >
            <IconBadge icon="key-outline" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {[item.edition, item.vendor?.name, expiryText(item.expiryDate)].filter(Boolean).join(' · ')}
              </Text>
              <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <StatusPill label={LICENSE_LABEL[item.status]} bg={tone.bg} fg={tone.fg} />
                <Text
                  style={{
                    color: full ? tone.fg : c.muted,
                    fontSize: 12,
                    fontWeight: '700',
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {item.seatsReserved}/{item.seatsPurchased} seats{full ? ' · Full' : ''}
                </Text>
              </View>
            </View>
            <Chevron />
          </Card>
        );
      }}
    />
  );
}
