import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import {
  addStockError,
  buildAddStockPayload,
  buildNewItemPayload,
  emptyAddStockForm,
  emptyNewItemForm,
  newItemError,
  normalizeSku,
  sortStockCategories,
  type AddStockForm,
  type NewItemForm,
} from '../lib/stock-entry';
import { useSession } from '../providers/session';
import { useTheme } from '../theme';
import { AssetSheet, FormLabel } from './assets/sheet';
import { ChipPicker } from './chip-picker';
import { Button, Field } from './ui';

/**
 * The two stock-entry sheets on the phone (web: inventory/page.tsx).
 *
 * New item describes something the company stocks; Add stock is the audited
 * positive adjustment that puts units on a shelf. Same shell as the asset
 * sheets, same chip pickers as receiving.
 */

interface Category {
  id: string;
  name: string;
  defaultTrackingType?: string;
}

export function NewStockItemSheet({
  visible,
  canSetPrice,
  onClose,
  onCreated,
}: {
  visible: boolean;
  canSetPrice: boolean;
  onClose: () => void;
  onCreated: (item: { id: string; name: string }) => void;
}) {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [form, setForm] = useState<NewItemForm>(emptyNewItemForm);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<NewItemForm>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (!visible) return;
    setForm(emptyNewItemForm());
    setError(null);
    void (async () => {
      try {
        setCategories(sortStockCategories((await api.request<Category[]>('/categories')) ?? []));
      } catch {
        setCategories([]);
        setError('Could not load categories.');
      }
    })();
  }, [visible, api]);

  async function submit() {
    const problem = newItemError(form, canSetPrice);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const item = await api.request<{ id: string; name: string }>('/stock/items', {
        method: 'POST',
        body: buildNewItemPayload(form, canSetPrice),
      });
      onCreated(item);
    } catch (e) {
      // A taken SKU comes back naming the item that holds it.
      setError(e instanceof Error && e.message ? e.message : 'Could not create the item');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AssetSheet
      visible={visible}
      title="New stock item"
      subtitle="Add the quantity on the shelf next"
      onClose={() => (busy ? undefined : onClose())}
    >
      <Field label="Name" value={form.name} onChangeText={(name) => set({ name })} placeholder="HDMI cable 2m" maxLength={200} />
      <Field
        label="SKU"
        value={form.sku}
        onChangeText={(sku) => set({ sku: normalizeSku(sku) })}
        placeholder="CAB-HDMI-2M"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={60}
      />
      <Field label="Unit" value={form.unit} onChangeText={(unit) => set({ unit })} placeholder="pcs, box, metre" maxLength={20} />
      <FormLabel>Category</FormLabel>
      {categories === null ? (
        <ActivityIndicator color={c.brand} style={{ marginVertical: spacing.lg }} />
      ) : (
        <ChipPicker label="Category" options={categories} value={form.categoryId} onChange={(categoryId) => set({ categoryId })} />
      )}
      <View style={{ height: spacing.lg }} />
      <Field
        label="Low-stock level (optional)"
        value={form.minStock}
        onChangeText={(minStock) => set({ minStock })}
        placeholder="Alert when a location drops to this"
        keyboardType="number-pad"
      />
      {canSetPrice ? (
        <Field
          label="Unit cost, INR (optional)"
          value={form.unitCost}
          onChangeText={(unitCost) => set({ unitCost })}
          placeholder="0.00"
          keyboardType="decimal-pad"
        />
      ) : null}
      {error ? <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>{error}</Text> : null}
      <Button label="Create item" icon="add-circle-outline" onPress={submit} loading={busy} />
    </AssetSheet>
  );
}

export function AddStockSheet({
  visible,
  preset,
  onClose,
  onAdded,
}: {
  visible: boolean;
  preset?: Partial<AddStockForm>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [form, setForm] = useState<AddStockForm>(() => emptyAddStockForm(preset));
  const [items, setItems] = useState<{ id: string; name: string }[] | null>(null);
  const [locations, setLocations] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<AddStockForm>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (!visible) return;
    setForm(emptyAddStockForm(preset));
    setError(null);
    void (async () => {
      try {
        const [itemRows, locationRows] = await Promise.all([
          api.request<{ id: string; sku: string; name: string }[]>('/stock/items'),
          api.request<{ id: string; name: string; code: string; isActive: boolean }[]>('/stock/locations'),
        ]);
        setItems((itemRows ?? []).map((i) => ({ id: i.id, name: `${i.name} · ${i.sku}` })));
        setLocations((locationRows ?? []).filter((l) => l.isActive).map((l) => ({ id: l.id, name: l.name })));
      } catch {
        setItems([]);
        setLocations([]);
        setError('Could not load items and locations.');
      }
    })();
    // preset is read once per opening; the parent sets it before showing the sheet.
  }, [visible, api]);

  async function submit() {
    const problem = addStockError(form);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.request('/stock/adjust', { method: 'POST', body: buildAddStockPayload(form) });
      onAdded();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not add stock');
    } finally {
      setBusy(false);
    }
  }

  const loading = items === null || locations === null;

  return (
    <AssetSheet
      visible={visible}
      title="Add stock"
      subtitle="Recorded in the ledger with your reason"
      onClose={() => (busy ? undefined : onClose())}
    >
      {loading ? (
        <ActivityIndicator color={c.brand} style={{ marginVertical: spacing.lg }} />
      ) : (
        <>
          <FormLabel>Item</FormLabel>
          {items.length === 0 ? (
            <Text style={{ color: c.subtle, fontSize: 13 }}>No stock items yet - create one first.</Text>
          ) : (
            <ChipPicker label="Item" options={items} value={form.itemId} onChange={(itemId) => set({ itemId })} />
          )}
          <View style={{ height: spacing.lg }} />
          <FormLabel>Location</FormLabel>
          {locations.length === 0 ? (
            <Text style={{ color: c.subtle, fontSize: 13 }}>
              No stock locations yet - an Inventory Manager can add one on the web.
            </Text>
          ) : (
            <ChipPicker
              label="Location"
              options={locations}
              value={form.locationId}
              onChange={(locationId) => set({ locationId })}
            />
          )}
          <View style={{ height: spacing.lg }} />
          <Field
            label="Quantity to add"
            value={form.quantity}
            onChangeText={(quantity) => set({ quantity })}
            keyboardType="number-pad"
          />
          <Field
            label="Reason"
            value={form.reason}
            onChangeText={(reason) => set({ reason })}
            placeholder="Opening stock count, bought locally…"
            maxLength={500}
          />
        </>
      )}
      {error ? <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>{error}</Text> : null}
      <Button
        label="Add stock"
        icon="add-outline"
        onPress={submit}
        loading={busy}
        disabled={loading || !items?.length || !locations?.length}
      />
    </AssetSheet>
  );
}
