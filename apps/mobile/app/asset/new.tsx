import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { ASSET_TYPES_BY_KEY, PERMISSIONS, type AssetTypeDef } from '@techpioasset/domain';
import { ChipPicker } from '../../src/components/chip-picker';
import { buildCreateExtras, dateError, priceError, problemMessage } from '../../src/lib/asset-admin';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Button, Card, Field, Screen, SectionTitle } from '../../src/components/ui';

/**
 * Register an asset without going back to a desk.
 *
 * The form is driven by the type catalogue rather than being one long list of
 * every column: choosing "Mobile phone" asks for an IMEI, choosing "Laptop"
 * asks for a serial, and neither asks for the other's. That is the same
 * ASSET_TYPES_BY_KEY the web form uses, so the two cannot drift apart.
 *
 * Serial and IMEI can be scanned rather than typed. That is the whole reason
 * this belongs on a phone: the number is printed on the box in 6pt, and typing
 * sixteen digits off a sticker is how a fleet ends up with typos in the one
 * field that is supposed to be unique.
 */

interface Category {
  id: string;
  key: string;
  name: string;
  subcategories: { id: string; key: string; name: string }[];
}

const IDENTITY_LABEL = {
  serialNumber: 'Serial number',
  macAddress: 'MAC address',
  imei: 'IMEI',
} as const;

/** A short, editable suggestion so nobody types a tag one-handed. */
function suggestTag(typeName: string): string {
  const prefix = typeName.replace(/[^a-zA-Z]/g, '').slice(0, 6).toUpperCase() || 'ASSET';
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${suffix}`;
}

function Chips<T extends { id?: string; key?: string; name: string }>({
  items,
  selected,
  onSelect,
}: {
  items: T[];
  selected: string | null;
  onSelect: (item: T) => void;
}) {
  const { c, spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.lg }}>
      {items.map((item) => {
        const id = item.id ?? item.key ?? item.name;
        const active = selected === id;
        return (
          <Pressable
            key={id}
            onPress={() => onSelect(item)}
            style={{
              paddingVertical: 9,
              paddingHorizontal: 14,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? c.brand : c.border,
              backgroundColor: active ? `${c.brand}14` : c.card,
            }}
          >
            <Text style={{ color: active ? c.brand : c.text, fontSize: 13, fontWeight: '600' }}>
              {item.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function NewAssetScreen() {
  const { api, user } = useSession();
  const { c, spacing } = useTheme();
  const router = useRouter();

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [assetTag, setAssetTag] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [identity, setIdentity] = useState<Record<string, string>>({});
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanningFor, setScanningFor] = useState<string | null>(null);
  const [offices, setOffices] = useState<{ id: string; name: string }[]>([]);
  const [officeId, setOfficeId] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [warrantyEndDate, setWarrantyEndDate] = useState('');
  const [purchaseCost, setPurchaseCost] = useState('');

  // Price is a Finance / Super Admin field - the permission the web form checks
  // and the API enforces. Everyone else never sees the box; Finance prices it later.
  const canSetPrice = user?.permissions.includes(PERMISSIONS.ASSETS_COST_READ) ?? false;

  useEffect(() => {
    void (async () => {
      try {
        setCategories((await api.request<Category[]>('/categories')) ?? []);
      } catch {
        setError('Could not load categories. Pull back and try again.');
      }
    })();
    // Offices are optional on the form, so a failure here only hides the picker.
    void api
      .request<{ id: string; name: string }[]>('/offices')
      .then((rows) => setOffices(rows ?? []))
      .catch(() => setOffices([]));
  }, [api]);

  const category = categories.find((x) => x.id === categoryId) ?? null;
  const subcategory = category?.subcategories.find((s) => s.id === subcategoryId) ?? null;
  const typeDef: AssetTypeDef | undefined = subcategory
    ? ASSET_TYPES_BY_KEY[subcategory.key]
    : undefined;

  // Fields belong to the type, so anything typed under a previous one is not
  // carried across - it would be saved against a field the new type never asks for.
  const chooseType = useCallback((s: { id: string; name: string }) => {
    setSubcategoryId(s.id);
    setIdentity({});
    setSpecs({});
    setAssetTag((current) => current || suggestTag(s.name));
    setName((current) => current || s.name);
  }, []);

  const canSubmit = useMemo(
    () => Boolean(categoryId && name.trim() && assetTag.trim()) && !busy,
    [categoryId, name, assetTag, busy],
  );

  async function submit() {
    const problem =
      dateError(purchaseDate, 'Purchased on') ??
      dateError(warrantyEndDate, 'Warranty ends') ??
      (canSetPrice ? priceError(purchaseCost) : null);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const created = await api.request<{ id: string }>('/assets', {
        method: 'POST',
        body: {
          assetTag: assetTag.trim(),
          name: name.trim(),
          categoryId,
          subcategoryId: subcategoryId ?? undefined,
          trackingType: typeDef?.tracking ?? 'INDIVIDUAL',
          brand: brand.trim() || undefined,
          model: model.trim() || undefined,
          serialNumber: identity.serialNumber?.trim() || undefined,
          macAddress: identity.macAddress?.trim() || undefined,
          imei: identity.imei?.trim() || undefined,
          specs: Object.keys(specs).length ? specs : undefined,
          ...buildCreateExtras({ officeId, purchaseDate, warrantyEndDate, purchaseCost }, canSetPrice),
        },
      });
      // Straight to the asset, where it can be handed to someone immediately.
      router.replace(`/asset/${created.id}`);
    } catch (e) {
      setError(problemMessage(e, 'Could not save that. Check the fields and try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <SectionTitle>Category</SectionTitle>
      <Chips
        items={categories}
        selected={categoryId}
        onSelect={(cat) => {
          setCategoryId(cat.id);
          setSubcategoryId(null);
          setIdentity({});
          setSpecs({});
        }}
      />

      {category ? (
        <>
          <SectionTitle>Type</SectionTitle>
          {category.subcategories.length === 0 ? (
            <Card style={{ marginBottom: spacing.lg }}>
              <Text style={{ color: c.muted, fontSize: 13 }}>
                This category has no types yet. It can still be saved without one.
              </Text>
            </Card>
          ) : (
            <Chips items={category.subcategories} selected={subcategoryId} onSelect={chooseType} />
          )}
        </>
      ) : null}

      {typeDef?.tracking === 'QUANTITY' ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19 }}>
            {typeDef.name} is normally counted as stock rather than registered one by one. Saving
            this creates a single tracked item.
          </Text>
        </Card>
      ) : null}

      <SectionTitle>Details</SectionTitle>
      <Field label="Name" placeholder="e.g. Dell Latitude 7450" value={name} onChangeText={setName} />
      <Field
        label="Asset tag"
        placeholder="e.g. AST-0201"
        autoCapitalize="characters"
        value={assetTag}
        onChangeText={setAssetTag}
      />

      {typeDef?.brands.length ? (
        <>
          <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Brand</Text>
          <Chips
            items={typeDef.brands.map((b) => ({ name: b }))}
            selected={brand}
            onSelect={(b) => setBrand(b.name === brand ? '' : b.name)}
          />
        </>
      ) : null}
      <Field label={typeDef?.brands.length ? 'Brand (or type your own)' : 'Brand'} value={brand} onChangeText={setBrand} />
      <Field label="Model" value={model} onChangeText={setModel} />

      {typeDef?.identity.map((key) => (
        <View key={key}>
          <Field
            label={IDENTITY_LABEL[key]}
            value={identity[key] ?? ''}
            onChangeText={(v) => setIdentity((prev) => ({ ...prev, [key]: v }))}
            autoCapitalize="characters"
            keyboardType={key === 'imei' ? 'number-pad' : 'default'}
            placeholder={key === 'macAddress' ? 'AA:BB:CC:DD:EE:FF' : undefined}
          />
          {key !== 'macAddress' ? (
            <Pressable
              onPress={() => setScanningFor(key)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                marginTop: -spacing.sm,
                marginBottom: spacing.md,
              }}
            >
              <Ionicons name="scan-outline" size={16} color={c.brand} />
              <Text style={{ color: c.brand, fontSize: 13, fontWeight: '600' }}>
                Scan it instead
              </Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      {typeDef?.fields.length ? (
        <>
          <SectionTitle>{typeDef.name} details</SectionTitle>
          {typeDef.fields.map((f) =>
            f.kind === 'select' && f.options?.length ? (
              <View key={f.key}>
                <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
                  {f.label}
                </Text>
                <Chips
                  items={f.options.map((o) => ({ name: o }))}
                  selected={specs[f.key] ?? null}
                  onSelect={(o) =>
                    setSpecs((prev) => ({ ...prev, [f.key]: prev[f.key] === o.name ? '' : o.name }))
                  }
                />
              </View>
            ) : (
              <Field
                key={f.key}
                label={f.unit ? `${f.label} (${f.unit})` : f.label}
                placeholder={f.placeholder}
                keyboardType={f.kind === 'number' ? 'numeric' : 'default'}
                value={specs[f.key] ?? ''}
                onChangeText={(v) => setSpecs((prev) => ({ ...prev, [f.key]: v }))}
              />
            ),
          )}
        </>
      ) : null}

      <SectionTitle>Location and purchase</SectionTitle>
      {offices.length ? (
        <>
          <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Office</Text>
          <ChipPicker
            label="Office"
            options={offices}
            value={officeId}
            onChange={setOfficeId}
            allowNone
          />
          <View style={{ height: spacing.lg }} />
        </>
      ) : null}
      <Field
        label="Purchased on (YYYY-MM-DD)"
        placeholder="2026-04-01"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        value={purchaseDate}
        onChangeText={setPurchaseDate}
      />
      <Field
        label="Warranty ends (YYYY-MM-DD)"
        placeholder="2029-04-01"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        value={warrantyEndDate}
        onChangeText={setWarrantyEndDate}
      />
      {canSetPrice ? (
        <>
          <Field
            label="Purchase price"
            placeholder="45000.00"
            keyboardType="decimal-pad"
            value={purchaseCost}
            onChangeText={setPurchaseCost}
          />
          <Text style={{ color: c.muted, fontSize: 12, marginTop: -spacing.sm, marginBottom: spacing.md }}>
            The price is recorded once and locks after saving.
          </Text>
        </>
      ) : null}

      {error ? (
        <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>{error}</Text>
      ) : null}

      <Button label="Register asset" icon="add-circle-outline" onPress={submit} loading={busy} disabled={!canSubmit} />
      <View style={{ height: spacing.xxl }} />

      <ScanModal
        field={scanningFor}
        onClose={() => setScanningFor(null)}
        onScanned={(value) => {
          if (scanningFor) setIdentity((prev) => ({ ...prev, [scanningFor]: value }));
          setScanningFor(null);
        }}
      />
    </Screen>
  );
}

/** Camera capture for a printed serial or IMEI barcode. */
function ScanModal({
  field,
  onClose,
  onScanned,
}: {
  field: string | null;
  onClose: () => void;
  onScanned: (value: string) => void;
}) {
  const { c, spacing } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const visible = field !== null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            padding: spacing.lg,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
          }}
        >
          <Text style={{ color: c.text, fontSize: 17, fontWeight: '800', flex: 1 }}>
            Scan {field === 'imei' ? 'IMEI' : 'serial number'}
          </Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={c.muted} />
          </Pressable>
        </View>

        {Platform.OS === 'web' ? (
          <View style={{ padding: spacing.xl }}>
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '700', marginBottom: 6 }}>
              Scanning needs the device camera
            </Text>
            <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>
              Open the app on a phone to scan the barcode, or type the number in.
            </Text>
          </View>
        ) : !permission?.granted ? (
          <View style={{ padding: spacing.xl }}>
            <Text style={{ color: c.muted, fontSize: 14, marginBottom: spacing.lg, lineHeight: 20 }}>
              The camera is needed to read the barcode printed on the device or its box.
            </Text>
            <Button label="Allow camera" onPress={() => void requestPermission()} />
          </View>
        ) : (
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'ean13', 'code39'] }}
            onBarcodeScanned={({ data }) => onScanned(data)}
          />
        )}
      </View>
    </Modal>
  );
}
