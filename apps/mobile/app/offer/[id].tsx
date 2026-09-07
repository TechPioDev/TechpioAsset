import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { PERMISSIONS, formatInr, type OfferLifecycle } from '@techpioasset/domain';
import { OFFER_LIFECYCLE_TOKENS, TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { ApiError } from '../../src/lib/api-client';
import { OfferPhotoSheet } from '../../src/components/offer-photo-sheet';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Button, Card, Field, Screen, SectionTitle, StatusPill } from '../../src/components/ui';
import { offerExpiry } from '../(tabs)/catalogue';

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
  images: { id: string; isPrimary: boolean }[];
  proposedSpecs: { id: string; label: string; value: string }[];
  specs: Record<string, string> | null;
  categoryId: string;
  subcategoryId: string | null;
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
  const router = useRouter();
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [fields, setFields] = useState<SpecField[]>([]);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState('1');
  const [choosing, setChoosing] = useState(false);
  const [acting, setActing] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);

  const isVendor = !!user?.roles?.includes('VENDOR');
  const canManage = !!user?.permissions.includes(PERMISSIONS.VENDOR_PRODUCTS_MANAGE);
  const canReview = !!user?.permissions.includes(PERMISSIONS.VENDOR_PRODUCTS_REVIEW) && !isVendor;
  const canSelect = canManage && !isVendor;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await api.request<OfferDetail>(`/vendor-products/${id}`);
      setOffer(detail);
      setQuantity(String(detail?.minOrderQuantity ?? 1));
      if (detail?.categoryId) {
        // Labels and units come from the template, so a spec reads "RAM 16 GB"
        // rather than "ram_gb 16". The subcategory is passed because that is
        // where the questions that actually describe a laptop live.
        const query =
          `/spec-templates?categoryId=${detail.categoryId}` +
          (detail.subcategoryId ? `&subcategoryId=${detail.subcategoryId}` : '');
        setFields((await api.request<SpecField[]>(query)) ?? []);
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
  const editable = ['DRAFT', 'REJECTED', 'PAUSED'].includes(offer.status);

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

  /** One shape for every simple action: do it, say what happened, reload. */
  async function act(
    path: string,
    body: Record<string, unknown> | undefined,
    done: string,
    failed: string,
  ) {
    setActing(true);
    try {
      await api.request(path, { method: 'POST', ...(body ? { body } : {}) });
      await load();
      Alert.alert(done);
    } catch (error) {
      // The server names the actual rule - no picture yet, a required
      // specification still blank - better than anything generic here.
      Alert.alert(failed, error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setActing(false);
    }
  }

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


      {canManage ? (
        <>
          <SectionTitle>Manage this offer</SectionTitle>
          <Card>
            <Text style={{ color: c.muted, fontSize: 12, marginBottom: spacing.md }}>
              {offer.images.length === 0
                ? 'This offer has no picture yet, so it cannot go for review.'
                : `${offer.images.length} picture${offer.images.length === 1 ? '' : 's'}.`}
            </Text>
            <Button
              label="Add a picture"
              icon="camera-outline"
              variant={offer.images.length === 0 ? 'primary' : 'secondary'}
              onPress={() => setPhotoOpen(true)}
            />
            {editable ? (
              <Button
                label="Edit details"
                icon="create-outline"
                variant="secondary"
                onPress={() => router.push(`/offer/edit?id=${offer.id}`)}
                style={{ marginTop: 6 }}
              />
            ) : null}
            {offer.status === 'DRAFT' || offer.status === 'REJECTED' ? (
              <Button
                label="Send for review"
                icon="send-outline"
                loading={acting}
                disabled={offer.images.length === 0}
                onPress={() =>
                  void act(
                    `/vendor-products/${offer.id}/submit`,
                    undefined,
                    'Sent for review',
                    'Could not send it for review',
                  )
                }
                style={{ marginTop: 6 }}
              />
            ) : null}
            <Button
              label="Withdraw this offer"
              variant="danger"
              icon="close-outline"
              loading={acting}
              onPress={() =>
                Alert.alert(
                  'Withdraw this offer?',
                  'It stays readable, so past purchases still make sense.',
                  [
                    { text: 'Keep it', style: 'cancel' },
                    {
                      text: 'Withdraw',
                      style: 'destructive',
                      onPress: () => {
                        void (async () => {
                          setActing(true);
                          try {
                            await api.request(`/vendor-products/${offer.id}`, { method: 'DELETE' });
                            router.replace('/catalogue');
                          } catch (error) {
                            Alert.alert(
                              'Could not withdraw it',
                              error instanceof ApiError ? error.message : 'Please try again.',
                            );
                          } finally {
                            setActing(false);
                          }
                        })();
                      },
                    },
                  ],
                )
              }
              style={{ marginTop: 6 }}
            />
          </Card>
        </>
      ) : null}

      {canReview && offer.status === 'PENDING_REVIEW' ? (
        <>
          <SectionTitle>Review</SectionTitle>
          <Card>
            <Text style={{ color: c.muted, fontSize: 12, marginBottom: spacing.md }}>
              Approving publishes it to buyers. A rejection must say why, or the supplier cannot act
              on it.
            </Text>
            <Button
              label="Approve"
              icon="checkmark-done-outline"
              loading={acting}
              onPress={() =>
                void act(
                  `/vendor-products/${offer.id}/review`,
                  { decision: 'APPROVED' },
                  'Approved',
                  'Could not record the decision',
                )
              }
            />
            <Button
              label="Ask for a correction"
              variant="secondary"
              loading={acting}
              onPress={() =>
                Alert.prompt?.(
                  'What needs changing?',
                  'The supplier sees this.',
                  (reason?: string) => {
                    if (!reason?.trim()) return;
                    void act(
                      `/vendor-products/${offer.id}/review`,
                      { decision: 'CORRECTION_REQUESTED', comments: reason.trim() },
                      'Sent back to the supplier',
                      'Could not record the decision',
                    );
                  },
                )
              }
              style={{ marginTop: 6 }}
            />
          </Card>
        </>
      ) : null}

      {offer.proposedSpecs?.length ? (
        <>
          <SectionTitle>Also stated by the supplier</SectionTitle>
          <Card>
            <Text style={{ color: c.muted, fontSize: 12, marginBottom: spacing.sm }}>
              Not asked of everybody in this category, so not compared.
            </Text>
            {offer.proposedSpecs.map((spec) => row(spec.label, spec.value))}
          </Card>
        </>
      ) : null}

      <OfferPhotoSheet
        visible={photoOpen}
        productId={offer.id}
        imageCount={offer.images?.length ?? 0}
        onClose={() => setPhotoOpen(false)}
        onUploaded={() => void load()}
      />

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
