import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { PERMISSIONS } from '@techpioasset/domain';
import { priceError, problemMessage } from '../../lib/asset-admin';
import { formatMoney } from '../../lib/format';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { Button, Card, Field, SectionTitle } from '../ui';

/**
 * Purchase price (web: the asset page's Financials tab).
 *
 * "Only authorized roles such as: Office Admin, Finance, Super Admin should be
 * able to enter or modify purchase cost." Rendered only for assets:cost:read -
 * the permission the web checks and the API enforces - and for anyone else the
 * API never sends the figure at all. Recorded once through its own endpoint,
 * then locked; a general edit never carries a price.
 */
export function PriceCard({
  assetId,
  purchaseCost,
  currency,
  onRecorded,
}: {
  assetId: string;
  purchaseCost: string | null | undefined;
  currency: string | null | undefined;
  onRecorded: () => void;
}) {
  const { api, user } = useSession();
  const { c, spacing } = useTheme();
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user?.permissions.includes(PERMISSIONS.ASSETS_COST_READ)) return null;

  function submit() {
    const amount = price.trim();
    const problem = amount ? priceError(amount) : 'Enter the price first';
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    Alert.alert('Record this price?', 'It locks after saving and cannot be edited.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Record price', onPress: () => void record(amount) },
    ]);
  }

  async function record(amount: string) {
    setBusy(true);
    try {
      await api.request(`/assets/${assetId}/price`, { method: 'PATCH', body: { purchaseCost: amount } });
      setPrice('');
      onRecorded();
      Alert.alert('Price recorded and locked');
    } catch (e) {
      setError(problemMessage(e, 'Could not record the price.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionTitle>Price</SectionTitle>
      <Card style={{ marginBottom: spacing.xl }}>
        {purchaseCost != null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
            <Text style={{ color: c.text, fontSize: 22, fontWeight: '800' }}>
              {formatMoney(String(purchaseCost), currency ?? 'INR')}
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 999,
                backgroundColor: c.background,
              }}
            >
              <Ionicons name="lock-closed" size={12} color={c.muted} />
              <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600' }}>Locked</Text>
            </View>
          </View>
        ) : (
          <>
            <Field
              label="Purchase price"
              value={price}
              onChangeText={setPrice}
              placeholder="45000.00"
              keyboardType="decimal-pad"
            />
            {error ? <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>{error}</Text> : null}
            <Button label="Record price" icon="pricetag-outline" variant="secondary" onPress={submit} loading={busy} />
            <Text style={{ color: c.muted, fontSize: 12, marginTop: spacing.sm }}>
              Recorded once — it locks after saving and cannot be edited.
            </Text>
          </>
        )}
      </Card>
    </>
  );
}
