import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { type ComponentProps, useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import type {
  AssetCondition,
  AssetStatus,
  LifecycleState,
  AvailabilityState,
  OwnershipType,
} from '@techpioasset/domain';
import { PERMISSIONS } from '@techpioasset/domain';
import { assetPills } from '../../src/asset-pills';
import { useSession } from '../../src/providers/session';
import { HandoverSheet, type HandoverMode } from '../../src/components/handover-sheet';
import { ConditionPhotoSheet, type PhotoStage } from '../../src/components/condition-photo-sheet';
import { ConditionPhotoStrip } from '../../src/components/condition-photo-strip';
import { DisposalCard, type DisposalRecord } from '../../src/components/assets/disposal-card';
import { PriceCard } from '../../src/components/assets/price-card';
import { TransferCard, type OpenTransfer } from '../../src/components/assets/transfer-card';
import { useTheme } from '../../src/theme';
import { Button, Card, IconBadge, Screen, SectionTitle, StatusPill } from '../../src/components/ui';

interface AssetDetail {
  id: string;
  assetTag: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  status: AssetStatus;
  condition: AssetCondition;
  // v2.1 Workstream A — nullable until backfilled / dual-written.
  lifecycleState: LifecycleState | null;
  availabilityState: AvailabilityState | null;
  ownershipType: OwnershipType | null;
  office?: { id: string; name: string } | null;
  purchaseDate?: string | null;
  warrantyEndDate?: string | null;
  notes?: string | null;
  /** Sent only to holders of assets:cost:read - the API omits it for everyone else. */
  purchaseCost?: string | null;
  currency?: string | null;
  /** The open office transfer, if the asset is on the road. */
  transfers?: OpenTransfer[];
  disposal?: DisposalRecord | null;
  /** v2.53 - the catalogue listing this unit came from, when it came through procurement. */
  vendorProduct?: { id: string; name: string } | null;
  assignments: {
    id: string;
    assignedAt: string;
    returnedAt: string | null;
    acknowledgedAt: string | null;
    user: { email: string; profile: { firstName: string; lastName: string } | null } | null;
    assetReturn: { damageNotes: string | null } | null;
  }[];
  conditionLogs: {
    id: string;
    recordedAt: string;
    previousStatus: AssetStatus | null;
    newStatus: AssetStatus | null;
    previousCondition: AssetCondition | null;
    newCondition: AssetCondition | null;
    reason: string | null;
  }[];
}

type MobileAssetTab = 'info' | 'history';

/** Asset detail — the screen a QR scan opens (spec section 15). */
export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useSession();
  const router = useRouter();
  const { c, scheme, spacing } = useTheme();

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<MobileAssetTab>('info');

  const load = useCallback(async () => {
    const data = await api.request<AssetDetail>(`/assets/${id}`);
    setAsset(data);
  }, [api, id]);

  // Reloaded on focus, not just mount, so coming back from Edit shows the save.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openAssignment = asset?.assignments.find((a) => a.returnedAt === null);
  const holderName = openAssignment?.user
    ? [openAssignment.user.profile?.firstName, openAssignment.user.profile?.lastName]
        .filter(Boolean)
        .join(' ') || openAssignment.user.email
    : null;

  // The API enforces these regardless; this only decides what is worth showing.
  const can = (permission: string) => user?.permissions.includes(permission) ?? false;
  const mayAssign = can(PERMISSIONS.ASSETS_ASSIGN);
  const mayReturn = can(PERMISSIONS.ASSETS_RETURN);
  const mayEdit = can(PERMISSIONS.ASSETS_UPDATE);
  const [handover, setHandover] = useState<HandoverMode | null>(null);
  /**
   * Set the moment a handover or return completes, which opens the camera.
   *
   * This is the reason to do this on a phone at all: the equipment is on the
   * desk, in front of both people, right now. Asking someone to photograph it
   * later means photographing it from memory, or not at all.
   */
  const [photoStage, setPhotoStage] = useState<PhotoStage | null>(null);
  /** Bumped after a photo is saved, so the strip below reloads. */
  const [photoVersion, setPhotoVersion] = useState(0);

  async function confirmReceipt() {
    if (!openAssignment) return;
    setBusy(true);
    try {
      await api.request(`/assets/assignments/${openAssignment.id}/acknowledge`, { method: 'POST' });
      await load();
      Alert.alert('Receipt confirmed', 'Thanks — this asset is now marked as in use.');
    } finally {
      setBusy(false);
    }
  }

  async function reportDamage() {
    if (!asset) return;
    setBusy(true);
    try {
      await api.request(`/assets/${asset.id}/status`, {
        method: 'POST',
        body: { status: 'DAMAGED', reason: 'Reported damaged from mobile' },
      });
      await load();
      Alert.alert('Reported', 'IT has been notified this asset is damaged.');
    } catch {
      Alert.alert('Could not report', 'You may not have permission to change this asset.');
    } finally {
      setBusy(false);
    }
  }

  if (!asset) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }

  const historyEvents = buildHistory(asset);

  return (
    <Screen scroll>
      <Card style={{ marginBottom: spacing.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <IconBadge icon="hardware-chip-outline" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '800' }}>{asset.name}</Text>
            <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>{asset.assetTag}</Text>
          </View>
          {mayEdit ? (
            <Pressable
              onPress={() => router.push(`/asset/edit?id=${asset.id}`)}
              accessibilityRole="button"
              accessibilityLabel="Edit asset"
              hitSlop={8}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: c.border,
              }}
            >
              <Ionicons name="create-outline" size={15} color={c.brand} />
              <Text style={{ color: c.brand, fontSize: 13, fontWeight: '700' }}>Edit</Text>
            </Pressable>
          ) : null}
        </View>
        <View
          style={{ marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}
        >
          {assetPills(asset, scheme, { includeOwnership: true }).map((p) => (
            <StatusPill key={p.label} label={p.label} bg={p.bg} fg={p.fg} />
          ))}
        </View>
      </Card>

      <View
        style={{
          flexDirection: 'row',
          backgroundColor: c.card,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: c.border,
          padding: 4,
          marginBottom: spacing.xl,
        }}
      >
        <TabButton label="Info" active={tab === 'info'} onPress={() => setTab('info')} />
        <TabButton
          label={`History${historyEvents.length ? ` (${historyEvents.length})` : ''}`}
          active={tab === 'history'}
          onPress={() => setTab('history')}
        />
      </View>

      {tab === 'info' ? (
        <>
          <SectionTitle>Details</SectionTitle>
          <Card style={{ padding: 0, marginBottom: spacing.xl }}>
            {asset.serialNumber ? <DetailRow label="Serial" value={asset.serialNumber} /> : null}
            {asset.brand || asset.model ? (
              <DetailRow label="Model" value={[asset.brand, asset.model].filter(Boolean).join(' ')} />
            ) : null}
            {/* v2.53 - what this unit is according to the supplier who sold it.
                A link only for someone who can open the catalogue: an employee
                looking at their own laptop would otherwise tap through to a
                screen that refuses them. */}
            {asset.vendorProduct ? (
              <DetailRow
                label="Supplied as"
                value={asset.vendorProduct.name}
                {...(user?.permissions.includes(PERMISSIONS.VENDOR_PRODUCTS_READ)
                  ? { onPress: () => router.push(`/offer/${asset.vendorProduct!.id}`) }
                  : {})}
              />
            ) : null}
            {asset.office ? <DetailRow label="Office" value={asset.office.name} /> : null}
            {asset.purchaseDate ? <DetailRow label="Purchased" value={fmt(asset.purchaseDate)} /> : null}
            {asset.warrantyEndDate ? (
              <DetailRow label="Warranty ends" value={fmt(asset.warrantyEndDate)} />
            ) : null}
            <DetailRow label="Condition" value={asset.condition} last />
          </Card>

          {asset.notes ? (
            <Card style={{ marginTop: -spacing.md, marginBottom: spacing.xl }}>
              <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19 }}>{asset.notes}</Text>
            </Card>
          ) : null}

          {/* Renders nothing without assets:cost:read. */}
          <PriceCard
            assetId={asset.id}
            purchaseCost={asset.purchaseCost}
            currency={asset.currency}
            onRecorded={() => void load()}
          />

          <TransferCard
            assetId={asset.id}
            assetName={asset.name}
            status={asset.status}
            officeId={asset.office?.id ?? null}
            holderId={openAssignment?.id ?? null}
            openTransfer={asset.transfers?.[0] ?? null}
            onChanged={() => void load()}
          />

          {/* Offered for as long as the asset is out, not just before receipt
              is confirmed: a mouse or a monitor gets damaged months later, and
              the person holding it is the only one looking at it. Confirming
              locks removal, not addition. */}
          {openAssignment ? (
            <>
              <Button
                label="Add a photo of it"
                icon="camera-outline"
                variant="secondary"
                onPress={() => setPhotoStage('HANDOVER')}
                style={{ marginBottom: spacing.sm }}
              />
              <Text style={{ color: c.muted, fontSize: 12, marginBottom: spacing.md }}>
                {openAssignment.acknowledgedAt
                  ? 'Photograph any marks or damage. Once added, removing it needs IT.'
                  : 'Optional. Photograph any marks now — confirming receipt locks what you add.'}
              </Text>
            </>
          ) : null}

          {openAssignment && !openAssignment.acknowledgedAt ? (
            <Button
              label="Confirm receipt"
              icon="checkmark-circle-outline"
              onPress={confirmReceipt}
              loading={busy}
              style={{ marginBottom: spacing.md }}
            />
          ) : null}

          {/* Handing kit over is the job you do standing next to it, so the
              action lives here rather than only on the web. Which of the three
              is offered depends on whether the asset has a holder right now. */}
          {openAssignment ? (
            <>
              {mayReturn ? (
                <Button
                  label="Take back"
                  icon="arrow-undo-outline"
                  variant="secondary"
                  onPress={() => setHandover('return')}
                  disabled={busy}
                  style={{ marginBottom: spacing.md }}
                />
              ) : null}
              {mayAssign && mayReturn ? (
                <Button
                  label="Hand to someone else"
                  icon="swap-horizontal-outline"
                  variant="secondary"
                  onPress={() => setHandover('reassign')}
                  disabled={busy}
                  style={{ marginBottom: spacing.md }}
                />
              ) : null}
            </>
          ) : mayAssign ? (
            <Button
              label="Assign to someone"
              icon="person-add-outline"
              onPress={() => setHandover('assign')}
              disabled={busy}
              style={{ marginBottom: spacing.md }}
            />
          ) : null}

          <Button
            label="Report damage"
            icon="warning-outline"
            variant="danger"
            onPress={reportDamage}
            disabled={busy}
          />

          {/* End of life: the record once it exists, or the action for
              assets:dispose holders when the state machine allows it. */}
          <View style={{ height: spacing.lg }} />
          <DisposalCard
            assetId={asset.id}
            assetName={asset.name}
            status={asset.status}
            disposal={asset.disposal ?? null}
            onChanged={() => void load()}
          />

          <HandoverSheet
            visible={handover !== null}
            mode={handover ?? 'assign'}
            assetId={asset.id}
            assetName={asset.name}
            holderName={holderName}
            onClose={() => setHandover(null)}
            onDone={() => {
              void load();
              // Reassign closes one custody event and opens another; the photo
              // that matters at that moment is the new holder's handover.
              setPhotoStage(handover === 'return' ? 'RETURN' : 'HANDOVER');
            }}
          />

          <ConditionPhotoSheet
            visible={photoStage !== null}
            assetId={asset.id}
            assetName={asset.name}
            stage={photoStage ?? 'HANDOVER'}
            onClose={() => setPhotoStage(null)}
            onUploaded={() => {
              void load();
              setPhotoVersion((n) => n + 1);
            }}
          />
        </>
      ) : (
        <>
          <ConditionPhotoStrip assetId={asset.id} refreshKey={photoVersion} />

          <SectionTitle>Timeline</SectionTitle>
          {historyEvents.length === 0 ? (
            <Card>
              <Text style={{ color: c.muted, fontSize: 14 }}>
                No assignment or status history yet.
              </Text>
            </Card>
          ) : (
            <Card style={{ padding: 0 }}>
              {historyEvents.map((ev, i) => (
                <View
                  key={ev.id}
                  style={{
                    flexDirection: 'row',
                    gap: spacing.md,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderBottomWidth: i === historyEvents.length - 1 ? 0 : 1,
                    borderBottomColor: c.border,
                  }}
                >
                  <Ionicons name={ev.icon} size={18} color={c.muted} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>{ev.title}</Text>
                    {ev.subtitle ? (
                      <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>{ev.subtitle}</Text>
                    ) : null}
                    <Text style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>{ev.at}</Text>
                  </View>
                </View>
              ))}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: 9,
        borderRadius: 9,
        alignItems: 'center',
        backgroundColor: active ? c.brand : 'transparent',
      }}
    >
      <Text style={{ color: active ? '#fff' : c.muted, fontWeight: '700', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

type HistoryIcon = ComponentProps<typeof Ionicons>['name'];
interface HistoryEvent {
  id: string;
  ts: number;
  at: string;
  icon: HistoryIcon;
  title: string;
  subtitle: string | null;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Merge assignment and condition-log records into one date-descending timeline. */
function buildHistory(asset: AssetDetail): HistoryEvent[] {
  const events: HistoryEvent[] = [];

  for (const a of asset.assignments) {
    const who = a.user
      ? a.user.profile
        ? `${a.user.profile.firstName} ${a.user.profile.lastName}`.trim() || a.user.email
        : a.user.email
      : 'a teammate';
    events.push({
      id: `asg-${a.id}`,
      ts: new Date(a.assignedAt).getTime(),
      at: fmt(a.assignedAt),
      icon: 'person-outline',
      title: `Assigned to ${who}`,
      subtitle: a.acknowledgedAt ? 'Receipt confirmed' : 'Awaiting receipt',
    });
    if (a.returnedAt) {
      events.push({
        id: `ret-${a.id}`,
        ts: new Date(a.returnedAt).getTime(),
        at: fmt(a.returnedAt),
        icon: 'arrow-undo-outline',
        title: `Returned by ${who}`,
        subtitle: a.assetReturn?.damageNotes ? `Damage: ${a.assetReturn.damageNotes}` : null,
      });
    }
  }

  for (const log of asset.conditionLogs) {
    const parts: string[] = [];
    if (log.newStatus && log.newStatus !== log.previousStatus) {
      parts.push(`Status → ${log.newStatus}`);
    }
    if (log.newCondition && log.newCondition !== log.previousCondition) {
      parts.push(`Condition → ${log.newCondition}`);
    }
    events.push({
      id: `log-${log.id}`,
      ts: new Date(log.recordedAt).getTime(),
      at: fmt(log.recordedAt),
      icon: 'sync-outline',
      title: parts.join(' · ') || 'Status updated',
      subtitle: log.reason,
    });
  }

  return events.sort((a, b) => b.ts - a.ts);
}

function DetailRow({
  label,
  value,
  last = false,
  onPress,
}: {
  label: string;
  value: string;
  last?: boolean;
  /** When set, the value reads as a link and the row opens something. */
  onPress?: () => void;
}) {
  const { c } = useTheme();
  const body = (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.border,
      }}
    >
      <Text style={{ color: c.muted, fontSize: 14 }}>{label}</Text>
      <Text
        numberOfLines={1}
        style={{ color: onPress ? c.brand : c.text, fontWeight: '600', fontSize: 14, flexShrink: 1 }}
      >
        {value}
      </Text>
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="link">
      {body}
    </Pressable>
  ) : (
    body
  );
}
