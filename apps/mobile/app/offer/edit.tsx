import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { calculateLandedCost, formatInr, PROPOSED_SPECS_PER_OFFER } from '@techpioasset/domain';
import { ApiError } from '../../src/lib/api-client';
import { useSession } from '../../src/providers/session';
import { useOfferPolicy } from '../../src/lib/use-offer-policy';
import { useTheme } from '../../src/theme';
import { ChipPicker } from '../../src/components/chip-picker';
import { Button, Card, Field, Screen, SectionTitle } from '../../src/components/ui';

/**
 * Writing an offer on a phone (v2.45).
 *
 * This was left off mobile at first, on the reasoning that a price and a pair
 * of dates are a desk job. That was wrong for the people who actually hold this
 * account: a supplier's rep is out with the product, not at a desk, and until
 * this existed a vendor with only a phone could look at the catalogue and
 * change nothing in it.
 *
 * The running total is computed with the same domain function the server uses,
 * so the figure while typing is the figure that gets stored.
 */

interface Category {
  id: string;
  name: string;
  subcategories: { id: string; name: string }[];
}
interface Vendor {
  id: string;
  name: string;
}
interface SpecField {
  id: string;
  key: string;
  label: string;
  dataType: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'ENUM';
  unit: string | null;
  options: string[];
  isRequired: boolean;
}

interface Draft {
  vendorId: string;
  name: string;
  categoryId: string;
  subcategoryId: string;
  brand: string;
  model: string;
  vendorSku: string;
  description: string;
  unitPrice: string;
  gstPercent: string;
  discount: string;
  shippingCost: string;
  availableQuantity: string;
  minOrderQuantity: string;
  warrantyMonths: string;
  leadTimeDays: string;
  paymentTerms: string;
  availableFrom: string;
  availableUntil: string;
  specs: Record<string, string>;
  proposedSpecs: { label: string; value: string }[];
}

const isoDay = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const EMPTY: Draft = {
  vendorId: '',
  name: '',
  categoryId: '',
  subcategoryId: '',
  brand: '',
  model: '',
  vendorSku: '',
  description: '',
  unitPrice: '',
  gstPercent: '18',
  discount: '0',
  shippingCost: '0',
  availableQuantity: '0',
  minOrderQuantity: '1',
  warrantyMonths: '',
  leadTimeDays: '',
  paymentTerms: '',
  availableFrom: isoDay(0),
  availableUntil: isoDay(30),
  specs: {},
  proposedSpecs: [],
};

const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export default function OfferEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = Boolean(id);
  const router = useRouter();
  const { api, user } = useSession();
  const { c, spacing } = useTheme();

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [categories, setCategories] = useState<Category[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [fields, setFields] = useState<SpecField[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { publishesAtOnce } = useOfferPolicy();

  const isVendorUser = !!user?.roles?.includes('VENDOR');
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  useEffect(() => {
    void (async () => {
      try {
        const [cats, vends] = await Promise.all([
          api.request<Category[]>('/categories'),
          // A supplier never picks a vendor: the offer is always its own.
          isVendorUser ? Promise.resolve([]) : api.request<Vendor[]>('/vendors'),
        ]);
        setCategories(cats ?? []);
        setVendors(vends ?? []);

        if (id) {
          const existing = await api.request<Record<string, unknown>>(`/vendor-products/${id}`);
          setDraft({
            ...EMPTY,
            vendorId: String(existing.vendorId ?? ''),
            name: String(existing.name ?? ''),
            categoryId: String(existing.categoryId ?? ''),
            subcategoryId: String(existing.subcategoryId ?? ''),
            brand: String(existing.brand ?? ''),
            model: String(existing.model ?? ''),
            vendorSku: String(existing.vendorSku ?? ''),
            description: String(existing.description ?? ''),
            unitPrice: String(existing.unitPrice ?? ''),
            gstPercent: String(existing.gstPercent ?? '18'),
            discount: String(existing.discount ?? '0'),
            shippingCost: String(existing.shippingCost ?? '0'),
            availableQuantity: String(existing.availableQuantity ?? '0'),
            minOrderQuantity: String(existing.minOrderQuantity ?? '1'),
            warrantyMonths: existing.warrantyMonths == null ? '' : String(existing.warrantyMonths),
            leadTimeDays: existing.leadTimeDays == null ? '' : String(existing.leadTimeDays),
            paymentTerms: String(existing.paymentTerms ?? ''),
            availableFrom: String(existing.availableFrom ?? '').slice(0, 10) || isoDay(0),
            availableUntil: String(existing.availableUntil ?? '').slice(0, 10) || isoDay(30),
            specs: (existing.specs as Record<string, string>) ?? {},
            proposedSpecs: (
              (existing.proposedSpecs as { label: string; value: string }[]) ?? []
            ).map((p) => ({ label: p.label, value: p.value })),
          });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [api, id, isVendorUser]);

  // The questions follow the type, so a mouse is never asked its RAM.
  const loadFields = useCallback(async () => {
    if (!draft.categoryId) return setFields([]);
    const query =
      `/spec-templates?categoryId=${draft.categoryId}` +
      (draft.subcategoryId ? `&subcategoryId=${draft.subcategoryId}` : '');
    setFields((await api.request<SpecField[]>(query)) ?? []);
  }, [api, draft.categoryId, draft.subcategoryId]);
  useEffect(() => void loadFields(), [loadFields]);

  const breakdown = useMemo(
    () =>
      calculateLandedCost({
        unitPrice: num(draft.unitPrice),
        gstPercent: num(draft.gstPercent),
        discount: num(draft.discount),
        shippingCost: num(draft.shippingCost),
        installationCost: 0,
        otherCharges: 0,
      }),
    [draft.unitPrice, draft.gstPercent, draft.discount, draft.shippingCost],
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }

  const category = categories.find((cat) => cat.id === draft.categoryId);
  const datesWrong = new Date(draft.availableUntil) <= new Date(draft.availableFrom);
  const discountTooBig = num(draft.discount) > num(draft.unitPrice);
  const missing =
    !draft.name.trim() ||
    !draft.categoryId ||
    (!isVendorUser && !draft.vendorId) ||
    !draft.unitPrice;

  async function save() {
    setBusy(true);
    try {
      const body = {
        ...(!isVendorUser && draft.vendorId ? { vendorId: draft.vendorId } : {}),
        name: draft.name.trim(),
        categoryId: draft.categoryId,
        ...(draft.subcategoryId ? { subcategoryId: draft.subcategoryId } : {}),
        ...(draft.brand.trim() ? { brand: draft.brand.trim() } : {}),
        ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
        ...(draft.vendorSku.trim() ? { vendorSku: draft.vendorSku.trim() } : {}),
        ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
        unitPrice: num(draft.unitPrice),
        gstPercent: num(draft.gstPercent),
        discount: num(draft.discount),
        shippingCost: num(draft.shippingCost),
        installationCost: 0,
        otherCharges: 0,
        availableQuantity: num(draft.availableQuantity),
        minOrderQuantity: num(draft.minOrderQuantity) || 1,
        ...(draft.warrantyMonths.trim() ? { warrantyMonths: num(draft.warrantyMonths) } : {}),
        ...(draft.leadTimeDays.trim() ? { leadTimeDays: num(draft.leadTimeDays) } : {}),
        ...(draft.paymentTerms.trim() ? { paymentTerms: draft.paymentTerms.trim() } : {}),
        availableFrom: new Date(`${draft.availableFrom}T00:00:00.000Z`).toISOString(),
        availableUntil: new Date(`${draft.availableUntil}T23:59:59.000Z`).toISOString(),
        ...(Object.keys(draft.specs).length
          ? {
              specs: Object.fromEntries(
                Object.entries(draft.specs).filter(([, v]) => v.trim() !== ''),
              ),
            }
          : {}),
        proposedSpecs: draft.proposedSpecs
          .filter((p) => p.label.trim() && p.value.trim())
          .map((p) => ({ label: p.label.trim(), value: p.value.trim() })),
      };

      const saved = editing
        ? await api.request<{ id: string }>(`/vendor-products/${id}`, { method: 'PATCH', body })
        : await api.request<{ id: string }>('/vendor-products', { method: 'POST', body });

      router.replace(`/offer/${editing ? id : saved.id}`);
    } catch (error) {
      // The server names the actual rule - an end date before the start, a
      // discount above the price - better than anything generic here.
      Alert.alert(
        editing ? 'Could not save the changes' : 'Could not save the offer',
        error instanceof ApiError ? error.message : 'Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const text = (key: keyof Draft, label: string, extra?: Record<string, unknown>) => (
    <Field
      label={label}
      value={String(draft[key] ?? '')}
      onChangeText={(v: string) => set(key, v as Draft[typeof key])}
      {...extra}
    />
  );

  return (
    <Screen scroll>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '800' }}>
        {editing ? 'Edit offer' : 'New offer'}
      </Text>
      <Text style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>
        {editing
          ? publishesAtOnce
            ? 'Changes go live as soon as you save.'
            : 'Changing the price or specification of an approved offer sends it back for review.'
          : publishesAtOnce
            ? 'Saved as a draft. Add a picture and the required specifications, then publish it.'
            : 'Saved as a draft. It needs a picture before it can go for review.'}
      </Text>

      {!isVendorUser ? (
        <>
          <SectionTitle>Supplier</SectionTitle>
          <Card>
            <ChipPicker
              label="Supplier"
              options={vendors}
              value={draft.vendorId}
              onChange={(v) => set('vendorId', v)}
            />
          </Card>
        </>
      ) : null}

      <SectionTitle>What you are offering</SectionTitle>
      <Card>
        {text('name', 'Product name')}
        {text('brand', 'Brand')}
        {text('model', 'Model')}
        {/* The supplier's own number for the thing. Unique among that
            supplier's listings; the server says which one holds it if not. */}
        {text('vendorSku', 'Your SKU (optional)', { autoCapitalize: 'characters' })}
        <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
          Category
        </Text>
        <ChipPicker
          label="Category"
          options={categories}
          value={draft.categoryId}
          onChange={(v) => setDraft((d) => ({ ...d, categoryId: v, subcategoryId: '' }))}
        />
        {category?.subcategories?.length ? (
          <View style={{ marginTop: spacing.md }}>
            <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', marginBottom: 2 }}>
              Type
            </Text>
            <Text style={{ color: c.subtle, fontSize: 11, marginBottom: 6 }}>
              Decides which specifications you are asked for.
            </Text>
            <ChipPicker
              label="Type"
              options={category.subcategories}
              value={draft.subcategoryId}
              onChange={(v) => set('subcategoryId', v)}
              allowNone
            />
          </View>
        ) : null}
        <View style={{ marginTop: spacing.md }}>
          {text('description', 'Description', { multiline: true })}
        </View>
      </Card>

      {fields.length ? (
        <>
          <SectionTitle>Specification</SectionTitle>
          <Card>
            <Text style={{ color: c.muted, fontSize: 12, marginBottom: spacing.md }}>
              Anything left blank counts as “not stated”, which fails a comparison rather than
              passing quietly.
            </Text>
            {fields.map((field) =>
              field.dataType === 'BOOLEAN' || field.dataType === 'ENUM' ? (
                <View key={field.id} style={{ marginBottom: spacing.md }}>
                  <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
                    {field.label}
                    {field.isRequired ? ' *' : ''}
                  </Text>
                  <ChipPicker
                    label={field.label}
                    options={(field.dataType === 'BOOLEAN' ? ['Yes', 'No'] : field.options).map(
                      (o) => ({ id: o, name: o }),
                    )}
                    value={draft.specs[field.key] ?? ''}
                    onChange={(v) => set('specs', { ...draft.specs, [field.key]: v })}
                    allowNone
                    noneLabel="Not stated"
                  />
                </View>
              ) : (
                <Field
                  key={field.id}
                  label={`${field.label}${field.unit ? ` (${field.unit})` : ''}${field.isRequired ? ' *' : ''}`}
                  value={draft.specs[field.key] ?? ''}
                  onChangeText={(v: string) => set('specs', { ...draft.specs, [field.key]: v })}
                  keyboardType={field.dataType === 'NUMBER' ? 'decimal-pad' : 'default'}
                />
              ),
            )}
          </Card>
        </>
      ) : null}

      <SectionTitle>Anything else worth knowing?</SectionTitle>
      <Card>
        <Text style={{ color: c.muted, fontSize: 12, marginBottom: spacing.md }}>
          For anything the questions above do not cover. Recorded and shown, but not compared.
        </Text>
        {draft.proposedSpecs.map((row, i) => (
          <View key={i} style={{ marginBottom: spacing.md }}>
            <Field
              label="What it is"
              value={row.label}
              placeholder="NPU performance"
              onChangeText={(v: string) =>
                set(
                  'proposedSpecs',
                  draft.proposedSpecs.map((r, idx) => (idx === i ? { ...r, label: v } : r)),
                )
              }
            />
            <Field
              label="Value"
              value={row.value}
              placeholder="45 TOPS"
              onChangeText={(v: string) =>
                set(
                  'proposedSpecs',
                  draft.proposedSpecs.map((r, idx) => (idx === i ? { ...r, value: v } : r)),
                )
              }
            />
            <Button
              label="Remove"
              variant="ghost"
              onPress={() =>
                set(
                  'proposedSpecs',
                  draft.proposedSpecs.filter((_, idx) => idx !== i),
                )
              }
            />
          </View>
        ))}
        <Button
          label="Add a specification"
          variant="secondary"
          icon="add-outline"
          disabled={draft.proposedSpecs.length >= PROPOSED_SPECS_PER_OFFER}
          onPress={() => set('proposedSpecs', [...draft.proposedSpecs, { label: '', value: '' }])}
        />
      </Card>

      <SectionTitle>Price</SectionTitle>
      <Card>
        {text('unitPrice', 'Unit price (₹)', { keyboardType: 'decimal-pad' })}
        {text('discount', 'Discount (₹)', { keyboardType: 'decimal-pad' })}
        {text('shippingCost', 'Shipping (₹)', { keyboardType: 'decimal-pad' })}
        {text('gstPercent', 'GST %', { keyboardType: 'decimal-pad' })}
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: c.border,
            paddingTop: spacing.md,
            marginTop: 4,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: c.muted, fontSize: 13 }}>Taxable value</Text>
            <Text style={{ color: c.text, fontSize: 13, fontVariant: ['tabular-nums'] }}>
              {formatInr(breakdown.taxableValue)}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
            <Text style={{ color: c.muted, fontSize: 13 }}>GST</Text>
            <Text style={{ color: c.text, fontSize: 13, fontVariant: ['tabular-nums'] }}>
              {formatInr(breakdown.gstAmount)}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>Landed cost</Text>
            <Text
              style={{
                color: c.text,
                fontSize: 15,
                fontWeight: '700',
                fontVariant: ['tabular-nums'],
              }}
            >
              {formatInr(breakdown.landedCost)}
            </Text>
          </View>
        </View>
        {discountTooBig ? (
          <Text style={{ color: c.danger, fontSize: 12, marginTop: spacing.sm }}>
            The discount is more than the unit price.
          </Text>
        ) : null}
      </Card>

      <SectionTitle>Availability</SectionTitle>
      <Card>
        {text('availableQuantity', 'How many you can supply', { keyboardType: 'number-pad' })}
        {text('minOrderQuantity', 'Minimum order', { keyboardType: 'number-pad' })}
        {text('availableFrom', 'Available from (YYYY-MM-DD)')}
        {text('availableUntil', 'Price held until (YYYY-MM-DD)')}
        {datesWrong ? (
          <Text style={{ color: c.danger, fontSize: 12, marginBottom: spacing.sm }}>
            The end date must be after the start date.
          </Text>
        ) : (
          <Text style={{ color: c.subtle, fontSize: 11, marginBottom: spacing.sm }}>
            An offer with no end date is a price nobody has promised, so this is required.
          </Text>
        )}
        {text('warrantyMonths', 'Warranty (months)', { keyboardType: 'number-pad' })}
        {text('leadTimeDays', 'Lead time (days)', { keyboardType: 'number-pad' })}
        {text('paymentTerms', 'Payment terms')}
      </Card>

      <Button
        label={editing ? 'Save changes' : 'Save draft'}
        icon="checkmark-outline"
        loading={busy}
        disabled={missing || datesWrong || discountTooBig}
        onPress={() => void save()}
        style={{ marginTop: spacing.md }}
      />
      <Button
        label="Cancel"
        variant="ghost"
        onPress={() => router.back()}
        style={{ marginTop: 6 }}
      />
    </Screen>
  );
}
