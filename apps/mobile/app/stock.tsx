import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { PERMISSIONS } from '@techpioasset/domain';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import {
  Button,
  Card,
  EmptyState,
  IconBadge,
  ListSkeleton,
  PullRefresh,
} from '../src/components/ui';
import { AddStockSheet, NewStockItemSheet } from '../src/components/stock-entry-sheets';
import { stockEmptyState, type AddStockForm } from '../src/lib/stock-entry';
import { StockCountSheet, type CountTarget } from '../src/components/stock-count-sheet';
import { cacheStock, cachedStock, savedLabel } from '../src/lib/offline-cache';
import { isNoConnection } from '../src/lib/sync-service';
import { SyncBanner } from '../src/components/sync-banner';
import { useTabletLayout } from '../src/lib/tablet-layout';

interface Level {
  id: string;
  quantity: string;
  reserved: string;
  inventoryItem: { id: string; sku: string; name: string; unit: string; minStock: string | null };
  stockLocation: { id: string; code: string; name: string };
}

/**
 * Stock by location — on hand, reserved and what is actually free. Anyone who
 * may adjust stock can also create an item and add quantity from here.
 */
export default function StockScreen() {
  const { api, user } = useSession();
  const { c, spacing } = useTheme();
  const [rows, setRows] = useState<Level[]>([]);
  const [itemCount, setItemCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [addPreset, setAddPreset] = useState<Partial<AddStockForm> | null>(null);
  // v2.82 - counting a shelf, and whether the list came from the phone.
  const [counting, setCounting] = useState<CountTarget | null>(null);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  // v2.83 - the store-room tablet shows two stock lines side by side.
  const { tablet } = useTabletLayout();

  const canAdjust = user?.permissions.includes(PERMISSIONS.INVENTORY_ADJUST) ?? false;
  const canSetPrice = user?.permissions.includes(PERMISSIONS.ASSETS_COST_READ) ?? false;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // v2.10 S2: /stock/levels is paginated now, so the payload is enveloped.
      const [page, items] = await Promise.all([
        api.request<Level[] | { data: Level[] }>('/stock/levels?pageSize=50'),
        // Only to tell "no items yet" from "items but no stock" in the empty state.
        canAdjust ? api.request<{ id: string }[]>('/stock/items') : Promise.resolve(null),
      ]);
      // v2.82 - the client already unwraps the envelope, so this is the list
      // itself. Reading `.data` off it left the screen on "No stock recorded"
      // however much stock there was.
      const list = Array.isArray(page) ? page : (page?.data ?? []);
      setRows(list);
      setItemCount(items?.length ?? 0);
      setOfflineSince(null);
      void cacheStock(list);
    } catch (error) {
      if (!isNoConnection(error)) throw error;
      const cached = await cachedStock<Level[]>();
      setRows(cached?.value ?? []);
      setOfflineSince(cached?.savedAt ?? new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }, [api, canAdjust]);
  useEffect(() => void load(), [load]);

  const locations = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.stockLocation.id, r.stockLocation.name);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [rows]);

  const visible = locationId ? rows.filter((r) => r.stockLocation.id === locationId) : rows;
  const empty = stockEmptyState({ canAdjust, itemCount });

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
        {offlineSince ? (
          <Text style={{ color: c.warning, fontSize: 12, marginBottom: spacing.sm }}>
            No connection - stock as of {savedLabel(offlineSince)}. Counts you record are sent
            later.
          </Text>
        ) : null}
        <SyncBanner />
      </View>
      {canAdjust ? (
        <View
          style={{
            flexDirection: 'row',
            gap: spacing.sm,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
          }}
        >
          <Button
            label="New item"
            icon="add-circle-outline"
            variant="secondary"
            onPress={() => setNewItemOpen(true)}
            style={{ flex: 1, paddingVertical: 10 }}
          />
          <Button
            label="Add stock"
            icon="add-outline"
            onPress={() => setAddPreset({})}
            style={{ flex: 1, paddingVertical: 10 }}
          />
        </View>
      ) : null}

      {locations.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: 8 }}
        >
          {[{ id: null as string | null, name: 'All locations' }, ...locations].map((l) => {
            const active = locationId === l.id;
            return (
              <Pressable
                key={l.id ?? 'all'}
                onPress={() => setLocationId(l.id)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: active ? c.brand : c.card,
                  borderWidth: 1,
                  borderColor: active ? c.brand : c.border,
                }}
              >
                <Text style={{ color: active ? '#fff' : c.muted, fontSize: 13, fontWeight: '600' }}>
                  {l.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <FlatList
        key={tablet ? 'grid' : 'list'}
        numColumns={tablet ? 2 : 1}
        {...(tablet ? { columnWrapperStyle: { gap: spacing.md } } : {})}
        style={{ flex: 1 }}
        data={visible}
        keyExtractor={(r) => r.id}
        refreshControl={<PullRefresh refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 }}
        ListEmptyComponent={
          loading ? (
            <ListSkeleton />
          ) : (
            <View>
              <EmptyState icon="layers-outline" title={empty.title} message={empty.message} />
              {empty.action === 'new-item' ? (
                <Button
                  label="Create the first item"
                  icon="add-circle-outline"
                  onPress={() => setNewItemOpen(true)}
                />
              ) : empty.action === 'add-stock' ? (
                <Button label="Add stock" icon="add-outline" onPress={() => setAddPreset({})} />
              ) : null}
            </View>
          )
        }
        renderItem={({ item }) => {
          const qty = Number(item.quantity);
          const reserved = Number(item.reserved);
          const free = Math.max(0, qty - reserved);
          const low =
            item.inventoryItem.minStock !== null && qty <= Number(item.inventoryItem.minStock);
          return (
            <Card
              style={{
                marginBottom: spacing.md,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                ...(tablet ? { flex: 1 } : {}),
              }}
            >
              <IconBadge icon="layers-outline" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                  {item.inventoryItem.name}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {item.inventoryItem.sku} · {item.stockLocation.name}
                </Text>
                <Text
                  style={{
                    color: low ? c.danger : c.muted,
                    fontSize: 12,
                    marginTop: 4,
                    fontWeight: low ? '700' : '400',
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {qty} on hand · {reserved} reserved · {free} free
                  {low ? ' · LOW' : ''}
                </Text>
              </View>
              {canAdjust ? (
                <Pressable
                  onPress={() =>
                    setCounting({
                      inventoryItemId: item.inventoryItem.id,
                      stockLocationId: item.stockLocation.id,
                      itemName: item.inventoryItem.name,
                      locationName: item.stockLocation.name,
                      unit: item.inventoryItem.unit,
                      systemQuantity: qty,
                    })
                  }
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Count ${item.inventoryItem.name} at ${item.stockLocation.name}`}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: c.border,
                  }}
                >
                  <Text style={{ color: c.text, fontSize: 13, fontWeight: '700' }}>Count</Text>
                </Pressable>
              ) : null}
              {canAdjust && !offlineSince ? (
                <Pressable
                  onPress={() =>
                    setAddPreset({
                      itemId: item.inventoryItem.id,
                      locationId: item.stockLocation.id,
                    })
                  }
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Add stock of ${item.inventoryItem.name} at ${item.stockLocation.name}`}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: c.brand,
                  }}
                >
                  <Text style={{ color: c.brand, fontSize: 13, fontWeight: '700' }}>+ Add</Text>
                </Pressable>
              ) : null}
            </Card>
          );
        }}
      />

      <StockCountSheet
        target={counting}
        onClose={() => setCounting(null)}
        onDone={(message) => {
          setCounting(null);
          void load();
          Alert.alert('Count recorded', message);
        }}
      />
      <NewStockItemSheet
        visible={newItemOpen}
        canSetPrice={canSetPrice}
        onClose={() => setNewItemOpen(false)}
        onCreated={(created) => {
          setNewItemOpen(false);
          setItemCount((n) => n + 1);
          // Straight on to the next thing anyone does with a new item.
          setAddPreset({ itemId: created.id });
        }}
      />
      <AddStockSheet
        visible={addPreset !== null}
        preset={addPreset ?? undefined}
        onClose={() => setAddPreset(null)}
        onAdded={() => {
          setAddPreset(null);
          void load();
          Alert.alert('Stock added', 'Recorded in the ledger.');
        }}
      />
    </View>
  );
}
