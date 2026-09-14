import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { MAX_PAGE_SIZE } from '@techpioasset/contracts';
import { PERMISSIONS, assetIdentifier } from '@techpioasset/domain';
import { problemMessage } from '../../lib/asset-admin';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { Button, Card, Chevron, Field, IconBadge, SectionTitle } from '../ui';
import { AssetSheet } from './sheet';

/**
 * "Extra Assets" on the phone (web: equipment-kit.tsx) - everything else the
 * same person holds, so a laptop's screen answers "what else did they get".
 *
 * Same two sources as the web: the register filtered by holder, and the stock
 * ledger for consumables. Each asset row opens that asset, where Edit and Take
 * back already live; the web's per-row menu is not repeated here.
 */

interface KitAsset {
  id: string;
  assetTag: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  macAddress: string | null;
  imei: string | null;
  assignmentDate: string | null;
  category: { name: string } | null;
  subcategory: { key: string; name: string } | null;
  assignments?: {
    assignedAt: string | null;
    assignedBy: { profile: { firstName: string; lastName: string } | null } | null;
  }[];
}

/** Shape returned by /stock/held-by/:userId - the item is flattened onto the row. */
interface HeldConsumable {
  inventoryItemId: string;
  quantity: number;
  sku: string;
  name: string;
  unit: string;
  subcategory: { key: string; name: string } | null;
}

const fmtDateTime = (iso: string | null) =>
  iso
    ? `${new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${new Date(
        iso,
      ).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : null;

export function EquipmentKit({
  holderId,
  holderName,
  excludeAssetId,
}: {
  holderId: string;
  holderName: string | null;
  excludeAssetId: string;
}) {
  const { api, user } = useSession();
  const router = useRouter();
  const { c, spacing } = useTheme();
  const [assets, setAssets] = useState<KitAsset[] | null>(null);
  const [stock, setStock] = useState<HeldConsumable[]>([]);
  const [adding, setAdding] = useState(false);
  const mayAdd = user?.permissions.includes(PERMISSIONS.ASSETS_ASSIGN) ?? false;

  const load = useCallback(async () => {
    const [rows, held] = await Promise.all([
      api.request<KitAsset[]>(`/assets?assignedUserId=${holderId}&pageSize=${MAX_PAGE_SIZE}`).catch(() => []),
      api.request<HeldConsumable[]>(`/stock/held-by/${holderId}`).catch(() => []),
    ]);
    setAssets((rows ?? []).filter((a) => a.id !== excludeAssetId));
    setStock(held ?? []);
  }, [api, holderId, excludeAssetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = (assets?.length ?? 0) + stock.length;

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
        <SectionTitle style={{ marginBottom: 0 }}>Extra assets</SectionTitle>
        {assets ? (
          <Text style={{ color: c.muted, fontSize: 12 }}>
            · {total} {total === 1 ? 'item' : 'items'}
          </Text>
        ) : null}
      </View>
      <Card style={{ padding: 0, marginBottom: spacing.md }}>
        {assets === null ? (
          <ActivityIndicator color={c.brand} style={{ marginVertical: spacing.lg }} />
        ) : total === 0 ? (
          <Text style={{ color: c.muted, fontSize: 14, padding: 16 }}>
            {holderName ?? 'This person'} holds no other equipment.
          </Text>
        ) : (
          <>
            {assets.map((a, i) => {
              const ident = assetIdentifier(a);
              const at = a.assignments?.[0]?.assignedAt ?? a.assignmentDate;
              const by = a.assignments?.[0]?.assignedBy?.profile;
              return (
                <Pressable
                  key={a.id}
                  onPress={() => router.push(`/asset/${a.id}`)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderBottomWidth: i === assets.length - 1 && stock.length === 0 ? 0 : 1,
                    borderBottomColor: c.border,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <IconBadge icon="cube-outline" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>
                      {a.subcategory?.name ?? a.category?.name ?? 'Asset'}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>
                      {[a.name, [a.brand, a.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
                    </Text>
                    <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }}>
                      {ident ? `${ident.label} ${ident.value}` : 'No identifier'}
                      {at ? ` · issued ${fmtDateTime(at)}` : ''}
                      {by ? ` by ${by.firstName} ${by.lastName}` : ''}
                    </Text>
                  </View>
                  <Chevron />
                </Pressable>
              );
            })}
            {stock.map((s, i) => (
              <View
                key={s.inventoryItemId}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderBottomWidth: i === stock.length - 1 ? 0 : 1,
                  borderBottomColor: c.border,
                }}
              >
                <IconBadge icon="layers-outline" tint={c.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>
                    {s.subcategory?.name ?? 'Consumable'}
                  </Text>
                  <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>
                    {s.name} · {s.sku}
                  </Text>
                  <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }}>Stock item · not serialised</Text>
                </View>
                <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>×{s.quantity}</Text>
              </View>
            ))}
          </>
        )}
      </Card>
      {mayAdd ? (
        <Button
          label="Add extra asset"
          icon="add-outline"
          variant="secondary"
          onPress={() => setAdding(true)}
          style={{ marginBottom: spacing.xl }}
        />
      ) : (
        <View style={{ height: spacing.md }} />
      )}

      {mayAdd ? (
        <AddExtraAssetSheet
          visible={adding}
          holderId={holderId}
          holderName={holderName}
          onClose={() => setAdding(false)}
          onIssued={() => {
            setAdding(false);
            void load();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Hand an available asset to the same person. A picker over the real register,
 * like the web's dialog - the row that appears in the kit is the asset itself,
 * with its serial and history intact.
 */
function AddExtraAssetSheet({
  visible,
  holderId,
  holderName,
  onClose,
  onIssued,
}: {
  visible: boolean;
  holderId: string;
  holderName: string | null;
  onClose: () => void;
  onIssued: () => void;
}) {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<KitAsset[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setRows(null);
    // A short pause so typing a serial is one request, not one per keystroke.
    const t = setTimeout(() => {
      void api
        .request<KitAsset[]>(`/assets?status=AVAILABLE&pageSize=25${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`)
        .then((r) => alive && setRows(r ?? []))
        .catch(() => alive && setRows([]));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [api, q, visible]);

  function confirm(a: KitAsset) {
    Alert.alert(`Issue ${a.name}?`, `It goes to ${holderName ?? 'the holder'} and keeps its own serial and history.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Issue', onPress: () => void issue(a) },
    ]);
  }

  async function issue(a: KitAsset) {
    setBusy(true);
    try {
      await api.request(`/assets/${a.id}/assign`, { method: 'POST', body: { userId: holderId } });
      onIssued();
      Alert.alert(`Issued to ${holderName ?? 'the holder'}`);
    } catch (e) {
      Alert.alert('Could not issue that asset', problemMessage(e, 'Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AssetSheet
      visible={visible}
      title="Issue another asset"
      subtitle={holderName ?? undefined}
      onClose={() => (busy ? undefined : onClose())}
    >
      <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19, marginBottom: spacing.md }}>
        Pick from equipment that is currently available. It keeps its own serial and history.
      </Text>
      <Field
        value={q}
        onChangeText={setQ}
        placeholder="Search by name, tag or serial…"
        autoCorrect={false}
        autoCapitalize="none"
      />
      {rows === null || busy ? (
        <ActivityIndicator color={c.brand} style={{ marginVertical: spacing.lg }} />
      ) : rows.length === 0 ? (
        <Text style={{ color: c.muted, fontSize: 14, textAlign: 'center', marginVertical: spacing.lg }}>
          Nothing available to issue{q.trim() ? ' for that search' : ''}.
        </Text>
      ) : (
        rows.map((a) => (
          <Pressable
            key={a.id}
            onPress={() => confirm(a)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: c.border,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <IconBadge icon="cube-outline" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                {a.name}
              </Text>
              <Text style={{ color: c.muted, fontSize: 12 }} numberOfLines={1}>
                {a.assetTag}
                {a.serialNumber ? ` · SN ${a.serialNumber}` : ''}
              </Text>
            </View>
          </Pressable>
        ))
      )}
    </AssetSheet>
  );
}
