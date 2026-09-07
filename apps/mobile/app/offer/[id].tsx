import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { PERMISSIONS, formatInr, type OfferLifecycle } from '@techpioasset/domain';
import { OFFER_LIFECYCLE_TOKENS, TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { ApiError } from '../../src/lib/api-client';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Button, Card, Field, Screen, SectionTitle, StatusPill } from '../../src/components/ui';
import { offerExpiry } from '../catalogue';

/**
 * One offer, on a phone (v2.42).
 *
 * Two jobs it is worth doing away from a desk: checking what a supplier is
 * actually offering, and choosing it. Editing is not one of them - an offer is
 * a price, a specification and a pair of dates, and typing those on a phone
 * invites the kind of mistake that reaches an invoice.
 *
 * The price is itemised rather than stated as a total. A landed cost nobody can
 * take apart is a number to distrust, and that is doubly true on a small screen
 * where there is no room to go looking for the workings.
 */

interface OfferDetail {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  status: string;
  effectiveStatus: OfferLifecycle;
  unitPrice: string;
  gstPercent: string;
  discount: string;
  shippingCost: string;
  installationCost: string;
  otherCharges: string;
  landedCost: string;
  availableQuantity: number;
  minOrderQuantity: number;
  availableUntil: string;
  leadTimeDays: number | null;
  warrantyMonths: number | null;
  paymentTerms: string | null;
  specs: Record<string, string> | null;
  categoryId: string;
  vendor: { id: string; name: string } | null;
}

interface SpecField {
  key: string;
  label: string;
  unit: string | null;
}

export default function OfferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useSession();
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [fields, setFields] = useState<SpecField[]>([]);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState('1');
  const [choosing, setChoosing] = useState(false);

  const isVendor = !!user?.roles?.includes('VENDOR');
  const canSelect = !!user?.permissions.includes(PERMISSIONS.VENDOR_PRODUCTS_MANAGE) && !isVendor;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await api.request<OfferDetail>(`/vendor-products/${id}`);
      setOffer(detail);
      setQuantity(String(detail?.minOrderQuantity ?? 1));
      if (detail?.categoryId) {
        // Labels and units come from the category's template, so a spec reads
        // "RAM 16 GB" rather than "ram_gb 16".
        setFields((await api.request<SpecField[]>(`/spec-templates?categoryId=${detail.categoryId}`)) ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [api, id]);
  useEffect(() => void load(), [load]);

  if (loading && !offer) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }
  if (!offer) {
    return (
      <Screen>
        <Text style={{ color: c.muted }}>This offer could not be loaded.</Text>
      </Screen>
    );
  }

  const token = OFFER_LIFECYCLE_TOKENS[offer.effectiveStatus];
  const tone = palette[token.tone];
  const buyable = ['ACTIVE', 'EXPIRING_SOON'].includes(offer.effectiveStatus);

  const goods = Number(offer.unitPrice) - Number(offer.discount);
  const taxable = goods + Number(offer.shippingCost) + Number(offer.installationCost);
  const gst = (taxable * Number(offer.gstPercent)) / 100;
  const qty = Math.max(1, Number(quantity) || 1);

  const labelFor = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
  const unitFor = (key: string) => fields.find((f) => f.key === key)?.unit ?? '';

  const row = (label: string, value: string, strong = false) => (
    <View
      key={label}
      style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 12 }}
    >
      <Text style={{ color: strong ? c.text : c.muted, fontSize: 13, fontWeight: strong ? '700' : '400' }}>
        {label}
      </Text>
      <Text
        style={{
          color: c.text,
          fontSize: 13,
          fontWeight: strong ? '700' : '600',
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
    </View>
  );

  const choose = async () => {
    setChoosing(true);
    try {
      await api.request(`/vendor-products/${offer.id}/select`, {
        method: 'POST',
        body: { quantity: qty },
      });
      Alert.alert(
        'Offer chosen',
        'The price and specification have been recorded as they stand today, so a later change by the supplier cannot rewrite the decision.',
      );
      await load();
    } catch (error) {
      // The server's message names the actual reason - expired, out of stock,
      // under the minimum order - and is more use than anything generic here.
      Alert.alert(
        'Could not choose this offer',
        error instanceof ApiError ? error.message : 'Please try again.',
      );
    } finally {
      setChoosing(false);
    }
  };

  return (
    <Screen scroll>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '800' }}>{offer.name}</Text>
      <Text style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>
        {[offer.brand, offer.model, isVendor ? null : offer.vendor?.name].filter(Boolean).join(' · ')}
      </Text>
      <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
        <StatusPill label={token.label} bg={tone.bg} fg={tone.fg} />
      </View>

      {offer.description ? (
        <Text style={{ color: c.muted, fontSize: 13, marginTop: spacing.md, lineHeight: 19 }}>
          {offer.description}
        </Text>
      ) : null}

      <SectionTitle>What makes up the price</SectionTitle>
      <Card>
        {row('Unit price', formatInr(Number(offer.unitPrice)))}
        {Number(offer.discount) > 0 ? row('Less discount', `-${formatInr(Number(offer.discount))}`) : null}
        {Number(offer.shippingCost) > 0 ? row('Shipping', formatInr(Number(offer.shippingCost))) : null}
        {Number(offer.installationCost) > 0
          ? row('Installation', formatInr(Number(offer.installationCost)))
          : null}
        {row('Taxable value', formatInr(taxable))}
        {row(`GST at ${Number(offer.gstPercent)}%`, formatInr(gst))}
        {Number(offer.otherCharges) > 0 ? row('Other charges', formatInr(Number(offer.otherCharges))) : null}
        <View style={{ height: 1, backgroundColor: c.border, marginVertical: 6 }} />
        {row('Landed cost per unit', formatInr(Number(offer.landedCost)), true)}
      </Card>

      <SectionTitle>Terms</SectionTitle>
      <Card>
        {row('Available', `${offer.availableQuantity}`)}
        {row('Minimum order', `${offer.minOrderQuantity}`)}
        {row('Price held until', offerExpiry(offer.availableUntil))}
        {offer.leadTimeDays !== null ? row('Lead time', `${offer.leadTimeDays} days`) : null}
        {offer.warrantyMonths !== null ? row('Warranty', `${offer.warrantyMonths} months`) : null}
        {offer.paymentTerms ? row('Payment terms', offer.paymentTerms) : null}
      </Card>

      {offer.specs && Object.keys(offer.specs).length > 0 ? (
        <>
          <SectionTitle>Specification</SectionTitle>
          <Card>
            {Object.entries(offer.specs).map(([key, value]) =>
              row(labelFor(key), `${value}${unitFor(key) ? ` ${unitFor(key)}` : ''}`),
            )}
          </Card>
        </>
      ) : null}

      {canSelect ? (
        <>
          <SectionTitle>Choose this offer</SectionTitle>
          <Card>
            {buyable ? (
              <>
                <Field
                  label="How many"
                  value={quantity}
                  onChangeText={setQuantity}
                  keyboardType="number-pad"
                />
                <Text style={{ color: c.text, fontSize: 15, fontWeight: '700', marginBottom: spacing.md }}>
                  Total {formatInr(Number(offer.landedCost) * qty)}
                </Text>
                <Button
                  label="Choose this offer"
                  icon="cart-outline"
                  loading={choosing}
                  onPress={choose}
                />
                <Text style={{ color: c.subtle, fontSize: 11, marginTop: spacing.sm, lineHeight: 16 }}>
                  The price and specification are recorded as they stand today.
                </Text>
              </>
            ) : (
              <Text style={{ color: c.muted, fontSize: 13 }}>
                This offer cannot be chosen while it is {token.label.toLowerCase()}.
              </Text>
            )}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
