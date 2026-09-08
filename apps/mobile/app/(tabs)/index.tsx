import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { formatInr, type AssetStatus, type AssetCondition } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { useTheme, statusColor, statusLabel } from '../../src/theme';
import {
  Card,
  Chevron,
  EmptyState,
  IconBadge,
  Screen,
  SectionTitle,
  StatCard,
  StatusPill,
  type IconName,
} from '../../src/components/ui';

interface AssetRow {
  id: string;
  assetTag: string;
  name: string;
  status: AssetStatus;
  condition: AssetCondition;
  serialNumber: string | null;
}

interface OfferRow {
  id: string;
  name: string;
  brand: string | null;
  status: string;
  landedCost: string;
  availableQuantity: number;
  availableUntil: string;
}

interface Tile {
  key: string;
  label: string;
  value: number;
  icon: string;
  tone: 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';
}

// Server (Lucide) icon names → Ionicons.
const TILE_ICON: Record<string, IconName> = {
  Boxes: 'cube-outline',
  ClipboardList: 'document-text-outline',
  UserCheck: 'checkmark-done-outline',
  Layers: 'layers-outline',
  ShieldAlert: 'shield-outline',
  Wrench: 'construct-outline',
  KeyRound: 'key-outline',
  CalendarClock: 'calendar-outline',
  PackageX: 'alert-circle-outline',
};
/**
 * Tile key -> mobile route. The keys are the ones dashboard.service.ts emits;
 * the API also sends an href, but it is the web's route and several have no
 * mobile equivalent, so the mapping is kept here.
 *
 * A key missing from this map renders a tile that cannot be tapped, and says
 * nothing about why - which is how "My assets" and "Licenses near capacity"
 * sat dead on the Home screen. Every key the service can emit is listed.
 */
const TILE_ROUTE: Record<string, string> = {
  'my-assets': '/my-equipment',
  'my-open-requests': '/(tabs)/requests',
  'awaiting-approval': '/(tabs)/approvals',
  'assets-total': '/(tabs)/assets',
  'warranty-expiring': '/(tabs)/assets',
  'licenses-expiring': '/licenses',
  'licenses-at-capacity': '/licenses',
  'open-maintenance': '/maintenance',
  // A supplier's tiles. These were absent, so every one of them rendered dead
  // on this screen - the very failure the note above describes.
  'vendor-live-offers': '/(tabs)/catalogue',
  'vendor-awaiting-review': '/(tabs)/catalogue',
  'vendor-needs-you': '/(tabs)/catalogue',
  'vendor-ending-soon': '/(tabs)/catalogue',
  'vendor-out-of-stock': '/(tabs)/catalogue',
};

/** Home: role-aware KPI tiles plus the equipment issued to the signed-in user. */
export default function HomeScreen() {
  const { api, user } = useSession();
  const router = useRouter();
  const { c, scheme, spacing } = useTheme();

  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [loading, setLoading] = useState(true);

  // A supplier has no equipment issued to it and cannot read /assets at all.
  const isVendor = !!user?.roles?.includes('VENDOR');

  const firstName = (user?.displayName ?? user?.email ?? '').split(/[\s@]/)[0] || 'there';

  const tileTint = (tone: Tile['tone']): string | undefined =>
    tone === 'warning' ? c.warning : tone === 'danger' ? c.danger : undefined;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Each call catches its own failure. They used to share one Promise.all
      // with no guard on the assets request, so for a supplier - who is refused
      // /assets outright - the rejection took the whole screen down with it and
      // not even the tiles rendered.
      const [mine, summary, mineOffers] = await Promise.all([
        isVendor
          ? Promise.resolve([])
          : api
              .request<AssetRow[]>(`/assets?assignedUserId=${user.id}&pageSize=100`)
              .catch(() => []),
        api.request<{ tiles: Tile[] }>('/dashboard').catch(() => ({ tiles: [] })),
        isVendor
          ? api.request<OfferRow[]>('/vendor-products?take=5').catch(() => [])
          : Promise.resolve([]),
      ]);
      setAssets(mine ?? []);
      setTiles(summary?.tiles ?? []);
      setOffers(mineOffers ?? []);
    } finally {
      setLoading(false);
    }
  }, [api, user, isVendor]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Text style={{ color: c.muted, fontSize: 14 }}>Welcome back,</Text>
      <Text style={{ color: c.text, fontSize: 24, fontWeight: '800', marginBottom: spacing.lg }}>
        {firstName}
      </Text>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: spacing.md,
          marginBottom: spacing.xl,
        }}
      >
        {tiles.map((tile) => {
          const route = TILE_ROUTE[tile.key];
          return (
            <View key={tile.key} style={{ width: '47%' }}>
              <StatCard
                icon={TILE_ICON[tile.icon] ?? 'ellipse-outline'}
                value={tile.value}
                label={tile.label}
                tint={tileTint(tile.tone)}
                onPress={route ? () => router.push(route as never) : undefined}
              />
            </View>
          );
        })}
      </View>

      {/* A supplier is never issued equipment, so showing it "My assets" and an
          empty state about kit it will never have is the whole screen wasted.
          It gets the thing it came here for: its own offers. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <SectionTitle>{isVendor ? 'Your offers' : 'My assets'}</SectionTitle>
        <Pressable
          onPress={() => router.push(isVendor ? '/(tabs)/catalogue' : '/my-equipment')}
          hitSlop={8}
        >
          <Text style={{ color: c.brand, fontSize: 13, fontWeight: '700' }}>See all</Text>
        </Pressable>
      </View>

      {isVendor ? (
        offers.length === 0 && !loading ? (
          <Card>
            <EmptyState
              icon="pricetag-outline"
              title="Nothing listed yet"
              message="Add what you sell, put a picture on it, and publish."
            />
          </Card>
        ) : (
          offers.map((item) => (
            <Card
              key={item.id}
              onPress={() => router.push(`/offer/${item.id}`)}
              style={{
                marginBottom: spacing.md,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
              }}
            >
              <IconBadge icon="pricetag-outline" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {formatInr(Number(item.landedCost))} · {item.availableQuantity} available
                </Text>
              </View>
              <Chevron />
            </Card>
          ))
        )
      ) : null}

      {isVendor ? null : assets.length === 0 && !loading ? (
        <Card>
          <EmptyState
            icon="cube-outline"
            title="No assets yet"
            message="Equipment issued to you will appear here."
          />
        </Card>
      ) : (
        assets.map((item) => {
          const tone = statusColor(item.status, scheme);
          return (
            <Card
              key={item.id}
              onPress={() => router.push(`/asset/${item.id}`)}
              style={{
                marginBottom: spacing.md,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
              }}
            >
              <IconBadge icon="hardware-chip-outline" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {item.assetTag}
                  {item.serialNumber ? ` · ${item.serialNumber}` : ''}
                </Text>
                <View style={{ marginTop: 8 }}>
                  <StatusPill label={statusLabel(item.status)} bg={tone.bg} fg={tone.fg} />
                </View>
              </View>
              <Chevron />
            </Card>
          );
        })
      )}
    </Screen>
  );
}
