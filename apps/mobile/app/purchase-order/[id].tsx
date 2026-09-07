import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';
import { PERMISSIONS } from '@techpioasset/domain';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { ApiError } from '../../src/lib/api-client';
import { buildReceiveLines, canSubmitReceipt } from '../../src/lib/receive';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Button, Card, Chevron, IconBadge, Screen, SectionTitle, StatusPill } from '../../src/components/ui';
import { PO_TONE, poLabel } from '../purchase-orders';

interface PoLine {
  id: string;
  lineNumber: number;
  description: string;
  quantity: string;
  receivedQuantity: string;
}
interface Category {
  id: string;
  name: string;
}
interface PoDetail {
  id: string;
  poNumber: string;
  status: string;
  currency: string;
  total: string;
  vendor: { name: string } | null;
  lines: PoLine[];
  receipts: { id: string; grnNumber: string; receivedAt: string }[];
}

/**
 * Receive goods against a PO from the loading dock. Mobile keeps intake simple:
 * lines are received as assets (STOCK put-away with location, item and lot
 * pickers stays a web flow). Over-receipt is refused with the API's honest
 * numbers - no override on mobile either.
 *
 * v2.9 C5: receiving now creates the assets, so the dock has to say what
 * category they are, and can read serials off the boxes while standing there -
 * which is the one place the serial is guaranteed to be in front of somebody.
 */
export default function PurchaseOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useSession();
  const router = useRouter();
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [po, setPo] = useState<PoDetail | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('');
  /** Serials keyed by line, indexed by unit. Blanks are units nobody read. */
  const [serials, setSerials] = useState<Record<string, string[]>>({});

  const canReceive = !!user?.permissions.includes(PERMISSIONS.PROCUREMENT_RECEIVE);

  const load = useCallback(async () => {
    setPo(await api.request<PoDetail>(`/procurement/orders/${id}`));
  }, [api, id]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!canReceive) return;
    void api
      .request<Category[]>('/categories')
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [api, canReceive]);

  async function receive() {
    if (!po) return;
    const lines = buildReceiveLines({ quantities: qty, categoryId, serials });
    if (!canSubmitReceipt(lines, categoryId)) return;

    setBusy(true);
    try {
      await api.request(`/procurement/orders/${po.id}/receive`, {
        method: 'POST',
        body: { lines },
      });
      const created = lines.reduce((sum, l) => sum + l.quantity, 0);
      setQty({});
      setSerials({});
      await load();
      Alert.alert(
        'Goods received',
        `${created} asset(s) created from this delivery. Complete their details when you are back at a desk.`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // The over-receipt guard speaking - honest outstanding numbers.
        Alert.alert('Over-receipt refused', error.message);
      } else {
        Alert.alert('Could not receive', error instanceof Error ? error.message : 'Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!po) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }

  const tone = palette[PO_TONE[po.status] ?? 'neutral'];
  const receivable = canReceive && (po.status === 'ISSUED' || po.status === 'PARTIALLY_RECEIVED');
  const anyQty = Object.values(qty).some((v) => Number(v) > 0);
  // The API refuses ASSET intake without a category, so the button does too -
  // better to be unable to press it than to be told off after carrying the box.
  const canSubmit = canSubmitReceipt(
    buildReceiveLines({ quantities: qty, categoryId, serials }),
    categoryId,
  );

  return (
    <Screen scroll>
      <Card style={{ marginBottom: spacing.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <IconBadge icon="cube-outline" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '800' }}>{po.poNumber}</Text>
            <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>
              {[po.vendor?.name, `${Number(po.total).toLocaleString()} ${po.currency}`]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </View>
        <View style={{ marginTop: spacing.md }}>
          <StatusPill label={poLabel(po.status)} bg={tone.bg} fg={tone.fg} />
        </View>
      </Card>

      <SectionTitle>Lines</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        {po.lines.map((line, i) => {
          const ordered = Number(line.quantity);
          const received = Number(line.receivedQuantity);
          const remaining = Math.max(0, ordered - received);
          const pct = ordered ? Math.min(1, received / ordered) : 0;
          return (
            <View
              key={line.id}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderBottomWidth: i === po.lines.length - 1 ? 0 : 1,
                borderBottomColor: c.border,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
                    {line.description}
                  </Text>
                  <Text
                    style={{
                      color: remaining === 0 ? c.muted : c.text,
                      fontSize: 12,
                      marginTop: 2,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {received}/{ordered} received{remaining > 0 ? ` · ${remaining} outstanding` : ' · complete'}
                  </Text>
                  <View
                    style={{
                      marginTop: 6,
                      height: 5,
                      borderRadius: 99,
                      backgroundColor: c.border,
                      overflow: 'hidden',
                    }}
                  >
                    <View
                      style={{
                        width: `${Math.round(pct * 100)}%`,
                        height: '100%',
                        backgroundColor: pct >= 1 ? palette.success.fg : c.brand,
                      }}
                    />
                  </View>
                </View>
                {receivable && remaining > 0 ? (
                  <TextInput
                    value={qty[line.id] ?? ''}
                    onChangeText={(value) => setQty((prev) => ({ ...prev, [line.id]: value }))}
                    placeholder="0"
                    placeholderTextColor={c.muted}
                    keyboardType="number-pad"
                    accessibilityLabel={`Receive quantity for line ${line.lineNumber}`}
                    style={{
                      color: c.text,
                      borderWidth: 1,
                      borderColor: c.border,
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      minWidth: 64,
                      textAlign: 'center',
                      fontSize: 15,
                    }}
                  />
                ) : null}
              </View>
            </View>
          );
        })}
      </Card>

      {receivable ? (
        <>
          <SectionTitle>Asset category</SectionTitle>
          <Card style={{ marginBottom: spacing.xl }}>
            <Text style={{ color: c.muted, fontSize: 12, marginBottom: spacing.md }}>
              Everything received here becomes an asset, and every asset is filed under a category.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {categories.map((cat) => {
                const chosen = cat.id === categoryId;
                return (
                  <Pressable
                    key={cat.id}
                    onPress={() => setCategoryId(cat.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: chosen }}
                    accessibilityLabel={`Category ${cat.name}`}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: chosen ? c.brand : c.border,
                      backgroundColor: chosen ? c.brand : 'transparent',
                    }}
                  >
                    <Text style={{ color: chosen ? '#fff' : c.text, fontSize: 13, fontWeight: '600' }}>
                      {cat.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          {anyQty ? (
            <>
              <SectionTitle>Serial numbers</SectionTitle>
              <Card style={{ marginBottom: spacing.xl }}>
                <Text style={{ color: c.muted, fontSize: 12, marginBottom: spacing.md }}>
                  Optional, but you are standing next to the boxes. A unit left blank still becomes an
                  asset, just without a serial.
                </Text>
                {po.lines
                  .filter((line) => Number(qty[line.id] ?? 0) > 0)
                  .map((line) => (
                    <View key={line.id} style={{ marginBottom: spacing.md }}>
                      <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
                        {line.description}
                      </Text>
                      {Array.from({ length: Math.min(Number(qty[line.id] ?? 0), 10) }, (_, unit) => (
                        <TextInput
                          key={unit}
                          value={serials[line.id]?.[unit] ?? ''}
                          onChangeText={(value) =>
                            setSerials((prev) => {
                              const next = [...(prev[line.id] ?? [])];
                              next[unit] = value;
                              return { ...prev, [line.id]: next };
                            })
                          }
                          placeholder={`Unit ${unit + 1} serial`}
                          placeholderTextColor={c.muted}
                          autoCapitalize="characters"
                          autoCorrect={false}
                          accessibilityLabel={`Serial number for unit ${unit + 1} of ${line.description}`}
                          style={{
                            color: c.text,
                            borderWidth: 1,
                            borderColor: c.border,
                            borderRadius: 10,
                            paddingHorizontal: 12,
                            paddingVertical: 10,
                            marginBottom: 6,
                            fontSize: 15,
                          }}
                        />
                      ))}
                    </View>
                  ))}
              </Card>
            </>
          ) : null}

          <Button
            label="Receive goods"
            icon="checkmark-done-outline"
            onPress={() => void receive()}
            loading={busy}
            disabled={!canSubmit}
          />
        </>
      ) : null}

      {po.receipts.length > 0 ? (
        <>
          <SectionTitle>Receipts</SectionTitle>
          <Card style={{ padding: 0 }}>
            {/* Tappable: a receipt is where the quality check lives, and the
                person who can judge the goods is standing next to them. */}
            {po.receipts.map((r, i) => (
              <Pressable
                key={r.id}
                onPress={() => router.push(`/receipt/${r.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Inspect receipt ${r.grnNumber}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  opacity: pressed ? 0.7 : 1,
                  borderBottomWidth: i === po.receipts.length - 1 ? 0 : 1,
                  borderBottomColor: c.border,
                })}
              >
                <Text style={{ color: c.text, fontWeight: '600', fontSize: 13 }}>{r.grnNumber}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: c.muted, fontSize: 12 }}>
                    {new Date(r.receivedAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </Text>
                  <Chevron />
                </View>
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
