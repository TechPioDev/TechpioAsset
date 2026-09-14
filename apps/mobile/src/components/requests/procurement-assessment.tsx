import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RequestAssessment } from '@techpioasset/contracts';
import { ApiError } from '../../lib/api-client';
import {
  EMPTY_ASSESSMENT_FORM,
  assessmentBody,
  assessmentPreview,
  invalidMoneyField,
  type AssessmentForm,
} from '../../lib/assessment';
import { formatMoney } from '../../lib/format';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { ChipPicker } from '../chip-picker';
import { Button, Card, Field } from '../ui';

/**
 * The commercial side of a request, on the phone (v2.56).
 *
 * The same form, payload and gate as the web ProcurementAssessment: the caller
 * renders it only for holders of `requests:assess`, never on their own request,
 * and the server refuses the endpoint to anyone else. The requester never sees
 * or sets this figure.
 *
 * The total is not an input. It is previewed here and computed again on the
 * server, which is the copy that counts.
 */
export function ProcurementAssessment({
  requestId,
  currency,
  onSaved,
}: {
  requestId: string;
  /** The request's currency, used when the assessment has none yet. INR-first. */
  currency: string | null;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const { c, spacing, radius } = useTheme();

  const [loaded, setLoaded] = useState<RequestAssessment | null | undefined>(undefined);
  const [purchaseRequired, setPurchaseRequired] = useState<boolean | null>(null);
  const [suitableAssetId, setSuitableAssetId] = useState('');
  const [form, setForm] = useState<AssessmentForm>(EMPTY_ASSESSMENT_FORM);
  const [available, setAvailable] = useState<{ id: string; name: string }[] | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.request<RequestAssessment | null>(`/requests/${requestId}/assessment`);
      setLoaded(data ?? null);
      if (data) {
        setPurchaseRequired(data.purchaseRequired);
        setSuitableAssetId(data.suitableAsset?.id ?? '');
        setForm({
          suggestedProduct: data.suggestedProduct ?? '',
          unitPrice: data.unitPrice ?? '',
          quantity: data.quantity != null ? String(data.quantity) : '1',
          taxAmount: data.taxAmount ?? '',
          shipping: data.shipping ?? '',
          discount: data.discount ?? '',
          // Deliberately NOT data.notes - a colleague's note must not look like
          // your unsaved draft. New notes are filed separately, under your name.
          notes: '',
        });
      }
    } catch {
      setLoaded(null);
    }
  }, [api, requestId]);

  useEffect(() => void load(), [load]);

  // Only what is genuinely on the shelf, and only once somebody says "from stock".
  useEffect(() => {
    if (purchaseRequired !== false || available !== null) return;
    void api
      .request<{ id: string; assetTag: string; name: string }[]>(
        '/assets?status=AVAILABLE&pageSize=100&sort=assetTag&order=asc',
      )
      .then((rows) => setAvailable((rows ?? []).map((a) => ({ id: a.id, name: `${a.assetTag} · ${a.name}` }))))
      .catch(() => setAvailable([]));
  }, [api, purchaseRequired, available]);

  if (loaded === undefined) return null;

  const money = loaded?.currency ?? currency ?? 'INR';
  const preview = assessmentPreview(form);
  const savedNote = loaded?.notes?.trim() || '';

  async function save() {
    if (purchaseRequired === null) return;
    if (purchaseRequired) {
      const bad = invalidMoneyField(form);
      if (bad) {
        Alert.alert(
          `Check the ${bad.toLowerCase()}`,
          'Enter a non-negative amount with at most two decimal places, without commas.',
        );
        return;
      }
    }
    setSaving(true);
    try {
      const saved = await api.request<RequestAssessment>(`/requests/${requestId}/assessment`, {
        method: 'PATCH',
        body: assessmentBody(purchaseRequired, form, suitableAssetId),
      });
      Alert.alert(
        'Saved',
        saved.purchaseRequired === false
          ? 'Recorded — filled from stock, so no finance approval is needed.'
          : 'Assessment saved.',
      );
      await load();
      // The assessment can change which steps apply, so the chain is re-read too.
      onSaved();
    } catch (error) {
      Alert.alert('Could not save', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const set = (key: keyof AssessmentForm) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const choice = (active: boolean, label: string, icon: 'cube-outline' | 'cart-outline', onPress: () => void) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 10,
        paddingHorizontal: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? c.brand : c.border,
        backgroundColor: active ? c.brand : 'transparent',
      }}
    >
      <Ionicons name={icon} size={15} color={active ? c.brandText : c.muted} />
      <Text style={{ color: active ? c.brandText : c.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );

  return (
    <Card style={{ marginBottom: spacing.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="calculator-outline" size={18} color={c.brand} />
        <Text style={{ color: c.text, fontWeight: '700' }}>Procurement assessment</Text>
      </View>
      <Text style={{ color: c.muted, fontSize: 12, marginTop: 4, marginBottom: spacing.md }}>
        The requester states what they need; the cost is recorded here. This figure is what decides
        whether finance approval is required — the requester never sees or sets it.
      </Text>

      <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600', marginBottom: 8 }}>
        Is this available in stock?
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {choice(purchaseRequired === false, 'Yes — fill from stock', 'cube-outline', () => setPurchaseRequired(false))}
        {choice(purchaseRequired === true, 'No — must be bought', 'cart-outline', () => setPurchaseRequired(true))}
      </View>

      {purchaseRequired !== null ? (
        <Text
          style={{
            color: purchaseRequired === false ? c.warning : c.muted,
            fontSize: 12,
            marginTop: spacing.sm,
          }}
        >
          {purchaseRequired === false
            ? 'This closes the request as fulfilled — nothing is bought, and Finance will not review it.'
            : 'This sends it on to be costed, and to Finance if it clears the threshold.'}
        </Text>
      ) : null}

      {purchaseRequired === false ? (
        <View style={{ marginTop: spacing.md }}>
          <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Which item?</Text>
          <Text style={{ color: c.subtle, fontSize: 12, marginBottom: 8 }}>
            {available === null
              ? 'Looking for available stock…'
              : available.length === 0
                ? 'Nothing is showing as available right now — you can still record the answer.'
                : 'Optional. Naming it lets the next person find what was promised.'}
          </Text>
          {available && available.length > 0 ? (
            <ChipPicker
              options={available}
              value={suitableAssetId}
              onChange={setSuitableAssetId}
              label="Which item"
              allowNone
            />
          ) : null}
        </View>
      ) : null}

      {purchaseRequired === true ? (
        <View style={{ marginTop: spacing.md }}>
          <Field
            label="Product / model"
            placeholder="Dell Latitude 7450"
            value={form.suggestedProduct}
            onChangeText={set('suggestedProduct')}
          />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Field label="Unit price" keyboardType="decimal-pad" value={form.unitPrice} onChangeText={set('unitPrice')} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Quantity" keyboardType="number-pad" value={form.quantity} onChangeText={set('quantity')} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Field label="Tax" keyboardType="decimal-pad" value={form.taxAmount} onChangeText={set('taxAmount')} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Shipping" keyboardType="decimal-pad" value={form.shipping} onChangeText={set('shipping')} />
            </View>
          </View>
          <Field label="Discount" keyboardType="decimal-pad" value={form.discount} onChangeText={set('discount')} />

          {preview !== null ? (
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                backgroundColor: c.background,
                borderRadius: radius.md,
                paddingHorizontal: 12,
                paddingVertical: 10,
                marginBottom: spacing.md,
              }}
            >
              <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600' }}>Total estimated purchase</Text>
              <Text style={{ color: c.text, fontSize: 16, fontWeight: '800' }}>
                {formatMoney(preview.toFixed(2), money)}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {purchaseRequired !== null ? (
        <View style={{ marginTop: spacing.md }}>
          {savedNote ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.background,
                borderRadius: radius.md,
                padding: 12,
                marginBottom: spacing.md,
              }}
            >
              <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600' }}>Note already recorded</Text>
              <Text style={{ color: c.text, fontSize: 14, marginTop: 4 }}>{savedNote}</Text>
              <Text style={{ color: c.subtle, fontSize: 12, marginTop: 4 }}>
                Kept as it was written. Anything you add below is filed separately, under your name.
              </Text>
            </View>
          ) : null}
          <Field
            label="Add a note"
            placeholder="Optional. Hidden from the requester."
            value={form.notes}
            onChangeText={set('notes')}
            multiline
          />
          <Button label="Save assessment" onPress={() => void save()} loading={saving} />
        </View>
      ) : null}

      {loaded?.assessedBy ? (
        <Text
          style={{
            color: c.subtle,
            fontSize: 12,
            marginTop: spacing.md,
            paddingTop: spacing.sm,
            borderTopWidth: 1,
            borderTopColor: c.border,
          }}
        >
          {loaded.totalCost
            ? `Assessed at ${formatMoney(loaded.totalCost, money)}`
            : 'Recorded as filled from stock'}{' '}
          by {loaded.assessedBy.name}
          {loaded.assessedAt ? ` on ${new Date(loaded.assessedAt).toLocaleDateString()}` : ''}.
        </Text>
      ) : null}
    </Card>
  );
}
