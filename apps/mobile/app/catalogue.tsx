import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { formatInr, type OfferLifecycle } from '@techpioasset/domain';
import { OFFER_LIFECYCLE_TOKENS, TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Card, Chevron, EmptyState, IconBadge, StatusPill } from '../src/components/ui';

/**
 * The catalogue on a phone (v2.42).
 *
 * The same list a supplier and a buyer both see - who sees which rows is the
 * API's scope filter, not this screen. Kept to browsing and choosing: entering
 * an offer means typing a price, a specification and dates, which is a desk
 * job, and a phone would only make it error-prone.
 */

export interface OfferRow {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  landedCost: string;
  effectiveStatus: OfferLifecycle;
  availableQuantity: number;
  availableUntil: string;
  vendor: { id: string; name: string } | null;
  primaryImageId: string | null;
}

const DAY = 86_400_000;
/** "9d left" — nobody should have to subtract dates in their head on a dock. */
export function offerExpiry(iso: string): string {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / DAY);
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  return `${days}d left`;
}

export default function CatalogueScreen() {
  const { api, user } = useSession();
  const router = useRouter();
  const { c, scheme, spacing, radius } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [rows, setRows] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [liveOnly, setLiveOnly] = useState(false);

  const isVendor = !!user?.roles?.includes('VENDOR');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = liveOnly ? '?liveOnly=true&take=100' : '?take=100';
      setRows((await api.request<OfferRow[]>(`/vendor-products${query}`)) ?? []);
    } finally {
      setLoading(false);
    }
  }, [api, liveOnly]);
  useEffect(() => void load(), [load]);

  // Filtered on the device: the list is already bounded, and a round trip per
  // keystroke is the last thing a phone on site needs.
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.name, r.brand, r.model, r.vendor?.name].some((v) => v?.toLowerCase().includes(needle)),
    );
  }, [rows, search]);

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.background }}
      data={visible}
      keyExtractor={(r) => r.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 }}
      ListHeaderComponent={
        <View style={{ marginBottom: spacing.md }}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search name, brand or supplier"
            placeholderTextColor={c.subtle}
            style={{
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: c.surface,
              color: c.text,
              borderRadius: radius.md,
              paddingHorizontal: 14,
              paddingVertical: 12,
              fontSize: 15,
            }}
          />
          <Pressable
            onPress={() => setLiveOnly((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: liveOnly }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                borderWidth: 1,
                borderColor: liveOnly ? c.brand : c.border,
                backgroundColor: liveOnly ? c.brand : 'transparent',
              }}
            />
            <Text style={{ color: c.muted, fontSize: 13 }}>Only what can be bought today</Text>
          </Pressable>
        </View>
      }
      ListEmptyComponent={
        loading ? null : (
          <EmptyState
            icon="pricetags-outline"
            title={search ? 'Nothing matches that' : isVendor ? 'No offers yet' : 'Nothing in the catalogue'}
            message={
              search
                ? 'Try a shorter search.'
                : isVendor
                  ? 'Offers you add on the web appear here.'
                  : 'Once suppliers publish offers, they appear here.'
            }
          />
        )
      }
      renderItem={({ item }) => {
        const token = OFFER_LIFECYCLE_TOKENS[item.effectiveStatus];
        const tone = palette[token.tone];
        return (
          <Card
            onPress={() => router.push(`/offer/${item.id}`)}
            style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
          >
            <IconBadge icon="pricetag-outline" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {[item.brand, item.model, isVendor ? null : item.vendor?.name].filter(Boolean).join(' · ') ||
                  'No brand recorded'}
              </Text>
              <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <StatusPill label={token.label} bg={tone.bg} fg={tone.fg} />
                <Text
                  style={{
                    color: c.text,
                    fontSize: 13,
                    fontWeight: '700',
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {formatInr(Number(item.landedCost))}
                </Text>
              </View>
              <Text style={{ color: c.subtle, fontSize: 11, marginTop: 4 }}>
                {item.availableQuantity} available · {offerExpiry(item.availableUntil)}
              </Text>
            </View>
            <Chevron />
          </Card>
        );
      }}
    />
  );
}
