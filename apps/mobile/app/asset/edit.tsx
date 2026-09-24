import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import {
  ASSET_CONDITIONS,
  ASSET_TYPES_BY_KEY,
  PERMISSIONS,
  type AssetCondition,
  type AssetStatus,
} from '@techpioasset/domain';
import { CONDITION_TOKENS } from '@techpioasset/ui-tokens';
import { ChipPicker } from '../../src/components/chip-picker';
import { FormLabel } from '../../src/components/assets/sheet';
import { PriceCard } from '../../src/components/assets/price-card';
import { Button, Card, DetailSkeleton, EmptyState, Field, Screen, SectionTitle } from '../../src/components/ui';
import { ApiError } from '../../src/lib/api-client';
import {
  buildUpdatePayload,
  editFormFromAsset,
  editableStatuses,
  mergeFresh,
  problemMessage,
  validateEditForm,
  type EditFormValues,
  type EditableAsset,
} from '../../src/lib/asset-admin';
import { useSession } from '../../src/providers/session';
import { statusLabel, useTheme } from '../../src/theme';
import { toast } from '../../src/components/toast';

/**
 * Edit an asset from the phone (web: assets/[id]/edit).
 *
 * Every field is hydrated from the record and the body is the web form's, so a
 * field nobody touched is sent back exactly as it was - an edit on the phone
 * must never quietly blank a warranty date the screen happened not to show.
 * The price is not part of the edit: it has its own write-once endpoint and is
 * shown below only to holders of the cost permission.
 */

interface Category {
  id: string;
  name: string;
  subcategories: { id: string; key: string; name: string }[];
}
interface Office {
  id: string;
  name: string;
}
interface AssetForEdit extends EditableAsset {
  id: string;
  purchaseCost?: string | null;
  currency?: string | null;
}

const IDENTITY = [
  { key: 'macAddress', label: 'MAC address', placeholder: 'A4:BB:6D:1E:22:9F' },
  { key: 'imei', label: 'IMEI', placeholder: '359874102345678' },
] as const;

export default function EditAssetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useSession();
  const router = useRouter();
  const { c, spacing } = useTheme();

  const [asset, setAsset] = useState<AssetForEdit | null>(null);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [offices, setOffices] = useState<Office[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [values, setValues] = useState<EditFormValues | null>(null);
  /** The values as last loaded - what "untouched" is measured against. */
  const loaded = useRef<EditFormValues | null>(null);
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUpdate = user?.permissions.includes(PERMISSIONS.ASSETS_UPDATE) ?? false;

  const fetchAsset = useCallback(() => api.request<AssetForEdit>(`/assets/${id}`), [api, id]);

  useEffect(() => {
    void (async () => {
      try {
        const [a, cats, offs] = await Promise.all([
          fetchAsset(),
          api.request<Category[]>('/categories'),
          api.request<Office[]>('/offices'),
        ]);
        const form = editFormFromAsset(a);
        loaded.current = form;
        setAsset(a);
        setValues(form);
        setSpecs({ ...(a.specs ?? {}) });
        setCategories(cats ?? []);
        setOffices(offs ?? []);
      } catch (e) {
        setLoadError(problemMessage(e, 'Could not load the asset.'));
      }
    })();
  }, [api, fetchAsset]);

  /**
   * Bring a fresh copy in underneath the form without discarding edits - after
   * a conflict, or after the price is recorded (which moves the version on).
   */
  const refreshKeepingEdits = useCallback(async () => {
    const fresh = await fetchAsset();
    const freshValues = editFormFromAsset(fresh);
    setValues((current) =>
      current && loaded.current ? mergeFresh(current, loaded.current, freshValues) : freshValues,
    );
    loaded.current = freshValues;
    setAsset(fresh);
  }, [fetchAsset]);

  const set = <K extends keyof EditFormValues>(key: K, value: EditFormValues[K]) =>
    setValues((prev) => (prev ? { ...prev, [key]: value } : prev));

  const category = categories?.find((x) => x.id === values?.categoryId);
  const typeDef = useMemo(() => {
    const sub = category?.subcategories.find((s) => s.id === values?.subcategoryId);
    return sub ? ASSET_TYPES_BY_KEY[sub.key] : undefined;
  }, [category, values?.subcategoryId]);

  // Changing type keeps nothing from the old one, since the fields mean
  // different things; returning to the original type restores its details.
  const originalTypeId = asset?.subcategory?.id ?? '';
  const chooseType = (subcategoryId: string) => {
    set('subcategoryId', subcategoryId);
    setSpecs(subcategoryId === originalTypeId ? { ...(asset?.specs ?? {}) } : {});
  };

  if (loadError) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title="Could not load the asset" message={loadError} />
      </Screen>
    );
  }
  if (!asset || !values || !categories || !offices) {
    return (
      <DetailSkeleton />
    );
  }
  if (!canUpdate) {
    return (
      <Screen>
        <EmptyState
          icon="lock-closed-outline"
          title="Not available"
          message="You do not have permission to edit assets."
        />
      </Screen>
    );
  }

  async function save() {
    if (!values || !asset) return;
    const problem = validateEditForm(values);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.request(`/assets/${asset.id}`, {
        method: 'PATCH',
        body: buildUpdatePayload(values, specs, asset),
      });
      toast.say('Asset updated');
      router.back();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Pull the latest copy; edits are kept and the lock re-armed, so
        // "save again" genuinely works.
        try {
          await refreshKeepingEdits();
        } catch {
          // The message below still applies; the next save will say if not.
        }
        setError(
          'This asset changed since the form loaded. Its latest values have been brought in - your edits are kept. Review and save again.',
        );
      } else {
        setError(problemMessage(e, 'Could not save the asset.'));
      }
    } finally {
      setBusy(false);
    }
  }

  const statusOptions = editableStatuses(asset.status).map((s: AssetStatus) => ({
    id: s,
    name: statusLabel(s),
  }));
  const conditionOptions = ASSET_CONDITIONS.map((k: AssetCondition) => ({
    id: k,
    name: CONDITION_TOKENS[k].label,
  }));

  return (
    <Screen scroll fade>
      <Text style={{ color: c.muted, fontSize: 13, marginBottom: spacing.lg }}>
        {asset.assetTag} · {asset.name}
      </Text>

      <SectionTitle>Details</SectionTitle>
      <Field label="Asset name" value={values.name} onChangeText={(v) => set('name', v)} maxLength={200} />
      <Field
        label="Asset tag"
        value={values.assetTag}
        onChangeText={(v) => set('assetTag', v)}
        autoCapitalize="characters"
        maxLength={64}
      />

      <FormLabel>Category</FormLabel>
      <ChipPicker
        label="Category"
        options={categories}
        value={values.categoryId}
        onChange={(v) => {
          set('categoryId', v);
          chooseType('');
        }}
      />
      <View style={{ height: spacing.lg }} />

      {category && category.subcategories.length > 0 ? (
        <>
          <FormLabel>Type</FormLabel>
          <ChipPicker
            label="Type"
            options={category.subcategories}
            value={values.subcategoryId}
            onChange={chooseType}
            allowNone
          />
          <View style={{ height: spacing.lg }} />
        </>
      ) : null}

      <Field label="Brand" value={values.brand} onChangeText={(v) => set('brand', v)} maxLength={120} />
      <Field label="Model" value={values.model} onChangeText={(v) => set('model', v)} maxLength={120} />
      <Field
        label="Serial number"
        value={values.serialNumber}
        onChangeText={(v) => set('serialNumber', v)}
        autoCapitalize="characters"
        maxLength={120}
      />

      {/* Identity fields for this type. Unique per company, so a value already
          on another asset is refused with its tag named. */}
      {IDENTITY.filter(({ key }) => typeDef?.identity.includes(key)).map(({ key, label, placeholder }) => (
        <Field
          key={key}
          label={label}
          value={values[key]}
          onChangeText={(v) => set(key, v)}
          placeholder={placeholder}
          autoCapitalize="characters"
          keyboardType={key === 'imei' ? 'number-pad' : 'default'}
        />
      ))}

      {typeDef && typeDef.fields.length > 0 ? (
        <>
          <SectionTitle>{typeDef.name} details</SectionTitle>
          <Text style={{ color: c.muted, fontSize: 12, marginBottom: spacing.md }}>
            Clearing a box removes that detail from the asset.
          </Text>
          {typeDef.fields.map((f) =>
            f.kind === 'select' && f.options?.length ? (
              <View key={f.key} style={{ marginBottom: spacing.lg }}>
                <FormLabel>{f.label}</FormLabel>
                <ChipPicker
                  label={f.label}
                  options={f.options.map((o) => ({ id: o, name: o }))}
                  value={specs[f.key] ?? ''}
                  onChange={(v) => setSpecs((prev) => ({ ...prev, [f.key]: v }))}
                  allowNone
                  noneLabel="—"
                />
              </View>
            ) : (
              <Field
                key={f.key}
                label={f.unit ? `${f.label} (${f.unit})` : f.label}
                placeholder={f.placeholder}
                keyboardType={f.kind === 'number' ? 'decimal-pad' : 'default'}
                value={specs[f.key] ?? ''}
                onChangeText={(v) => setSpecs((prev) => ({ ...prev, [f.key]: v }))}
              />
            ),
          )}
        </>
      ) : null}

      <SectionTitle>Location and dates</SectionTitle>
      <FormLabel>Office</FormLabel>
      <ChipPicker
        label="Office"
        options={offices}
        value={values.officeId}
        onChange={(v) => set('officeId', v)}
      />
      <View style={{ height: spacing.lg }} />
      <Field
        label="Purchased on (YYYY-MM-DD)"
        value={values.purchaseDate}
        onChangeText={(v) => set('purchaseDate', v)}
        placeholder="2026-04-01"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      <Field
        label="Warranty ends (YYYY-MM-DD)"
        value={values.warrantyEndDate}
        onChangeText={(v) => set('warrantyEndDate', v)}
        placeholder="2029-04-01"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />

      <SectionTitle>State</SectionTitle>
      <FormLabel>Condition</FormLabel>
      <ChipPicker
        label="Condition"
        options={conditionOptions}
        value={values.condition}
        onChange={(v) => set('condition', v)}
      />
      <View style={{ height: spacing.lg }} />
      <FormLabel>Status</FormLabel>
      {/* Custody statuses are earned through Assign, not declared here. The
          current status always stays listed so an untouched form round-trips. */}
      <ChipPicker
        label="Status"
        options={statusOptions}
        value={values.status}
        onChange={(v) => set('status', v as AssetStatus)}
      />
      <View style={{ height: spacing.lg }} />
      <Field
        label="Notes"
        value={values.notes}
        onChangeText={(v) => set('notes', v)}
        multiline
        maxLength={4000}
      />

      {error ? (
        <Card style={{ marginBottom: spacing.md, borderColor: c.danger }}>
          <Text style={{ color: c.danger, fontSize: 13, lineHeight: 19 }}>{error}</Text>
        </Card>
      ) : null}

      <Button label="Save changes" icon="checkmark-outline" onPress={save} loading={busy} />
      <Button
        label="Cancel"
        variant="ghost"
        onPress={() => router.back()}
        disabled={busy}
        style={{ marginTop: spacing.sm, marginBottom: spacing.xl }}
      />

      {/* Separate from Save on purpose: the price has its own write-once
          endpoint, and this renders nothing without assets:cost:read. */}
      <PriceCard
        assetId={asset.id}
        purchaseCost={asset.purchaseCost}
        currency={asset.currency}
        onRecorded={() => void refreshKeepingEdits()}
      />
    </Screen>
  );
}
