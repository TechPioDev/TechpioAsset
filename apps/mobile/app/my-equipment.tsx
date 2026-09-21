import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { MAX_PAGE_SIZE } from '@techpioasset/contracts';
import type { AssetStatus } from '@techpioasset/domain';
import { useSession } from '../src/providers/session';
import { statusColor, statusLabel, useTheme } from '../src/theme';
import {
  Card,
  Chevron,
  EmptyState,
  IconBadge,
  ListSkeleton,
  PullRefresh,
  Screen,
  SectionTitle,
  StatusPill,
} from '../src/components/ui';

/**
 * Everything issued to the signed-in person, in one place.
 *
 * Home lists the serialised assets, but the mouse, headset and cables are stock
 * rather than assets and were invisible to the person holding them - the one
 * who most needs to know what is in their name at offboarding. They are shown
 * here beside the equipment, counted rather than serialised, which is how they
 * are actually tracked.
 *
 * Anything awaiting confirmation is called out first: an unacknowledged
 * assignment is a question addressed to this person, and it should not be
 * something they have to go looking for.
 */

interface MyAsset {
  id: string;
  assetTag: string;
  name: string;
  status: AssetStatus;
  serialNumber: string | null;
  brand: string | null;
  model: string | null;
  subcategory: { name: string } | null;
  assignments?: { returnedAt: string | null; acknowledgedAt: string | null }[];
}

/** Shape returned by /stock/held-by/:userId - the item is flattened onto the row. */
interface HeldConsumable {
  inventoryItemId: string;
  name: string;
  sku: string;
  unit: string | null;
  quantity: number;
}

export default function MyEquipmentScreen() {
  const { api, user } = useSession();
  const { c, scheme, spacing } = useTheme();
  const router = useRouter();

  const [assets, setAssets] = useState<MyAsset[]>([]);
  const [consumables, setConsumables] = useState<HeldConsumable[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [a, s] = await Promise.all([
        api
          .request<MyAsset[]>(`/assets?assignedUserId=${user.id}&pageSize=${MAX_PAGE_SIZE}`)
          .catch(() => []),
        // Own holdings need no inventory permission (v2.23); an employee has
        // one, so a failure here means something else and should not blank the page.
        api.request<HeldConsumable[]>(`/stock/held-by/${user.id}`).catch(() => []),
      ]);
      setAssets(a ?? []);
      setConsumables(s ?? []);
    } finally {
      setLoading(false);
    }
  }, [api, user]);

  useEffect(() => void load(), [load]);

  const awaiting = assets.filter((a) =>
    a.assignments?.some((x) => x.returnedAt === null && x.acknowledgedAt === null),
  );

  return (
    <Screen scroll refreshControl={<PullRefresh refreshing={loading} onRefresh={load} />}>
      {awaiting.length > 0 ? (
        <Card style={{ marginBottom: spacing.xl, borderColor: c.brand, borderWidth: 1 }}>
          <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }}>
            {awaiting.length === 1
              ? 'One item is waiting for you to confirm'
              : `${awaiting.length} items are waiting for you to confirm`}
          </Text>
          <Text style={{ color: c.muted, fontSize: 13, marginTop: 4, lineHeight: 19 }}>
            Open it and tap Confirm receipt so IT knows it reached you.
          </Text>
        </Card>
      ) : null}

      <SectionTitle>
        {`Equipment${assets.length ? ` (${assets.length}${assets.length === MAX_PAGE_SIZE ? '+' : ''})` : ''}`}
      </SectionTitle>
      {/* 0.3.29 - placeholder rows for the first load, in place of a blank. */}
      {assets.length === 0 && loading ? <ListSkeleton rows={3} /> : null}
      {assets.length === 0 && !loading ? (
        <Card style={{ marginBottom: spacing.xl }}>
          <EmptyState
            icon="cube-outline"
            title="Nothing issued to you"
            message="Equipment assigned to you will appear here."
          />
        </Card>
      ) : (
        <View style={{ marginBottom: spacing.xl }}>
          {assets.map((a) => {
            const tone = statusColor(a.status, scheme);
            const unconfirmed = a.assignments?.some(
              (x) => x.returnedAt === null && x.acknowledgedAt === null,
            );
            return (
              <Card
                key={a.id}
                onPress={() => router.push(`/asset/${a.id}`)}
                style={{
                  marginBottom: spacing.md,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                }}
              >
                <IconBadge icon="hardware-chip-outline" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                    {[
                      a.subcategory?.name,
                      [a.brand, a.model].filter(Boolean).join(' '),
                      a.serialNumber ? `SN ${a.serialNumber}` : a.assetTag,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                    <StatusPill label={statusLabel(a.status)} bg={tone.bg} fg={tone.fg} />
                    {unconfirmed ? (
                      <StatusPill label="Confirm receipt" bg={c.brandSoft} fg={c.brand} />
                    ) : null}
                  </View>
                </View>
                <Chevron />
              </Card>
            );
          })}
        </View>
      )}

      <SectionTitle>Consumables</SectionTitle>
      {consumables.length === 0 ? (
        <Card style={{ marginBottom: spacing.xl }}>
          <Text style={{ color: c.muted, fontSize: 14 }}>
            Nothing issued from stock — cables, mice and headsets would show here.
          </Text>
        </Card>
      ) : (
        <Card style={{ padding: 0, marginBottom: spacing.xl }}>
          {consumables.map((s, i) => (
            <View
              key={s.inventoryItemId}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 13,
                borderBottomWidth: i === consumables.length - 1 ? 0 : 1,
                borderBottomColor: c.border,
              }}
            >
              <Text style={{ color: c.text, fontSize: 14, flex: 1 }} numberOfLines={1}>
                {s.name}
              </Text>
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>
                {s.quantity}
                {s.unit ? ` ${s.unit}` : ''}
              </Text>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
