import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from 'react-native';
import {
  PERMISSIONS,
  assetDetailTabs,
  assetSpecRows,
  custodyHistory,
  custodyOptions,
  hasDiscoveryTabs,
  issuedByName,
  warrantySource,
  type AssetCondition,
  type AssetDetailTabKey,
  type AssetStatus,
  type AvailabilityState,
  type LifecycleState,
  type OwnershipType,
} from '@techpioasset/domain';
import { CONDITION_TOKENS } from '@techpioasset/ui-tokens';
import { assetPills } from '../../src/asset-pills';
import { holderDisplayName, warrantyCheckNotice } from '../../src/lib/asset-detail';
import { useSession } from '../../src/providers/session';
import { HandoverSheet, type HandoverMode } from '../../src/components/handover-sheet';
import { ConditionPhotoSheet, type PhotoStage } from '../../src/components/condition-photo-sheet';
import { ConditionPhotoStrip } from '../../src/components/condition-photo-strip';
import { DisposalCard, type DisposalRecord } from '../../src/components/assets/disposal-card';
import { EquipmentKit } from '../../src/components/assets/equipment-kit';
import { InfoRow, TabStrip, ToneBadge } from '../../src/components/assets/detail-parts';
import {
  HardwareTab,
  HealthTab,
  OsTab,
  SoftwareTab,
  type HardwareProfileDto,
  type HealthDto,
  type OsInfoDto,
} from '../../src/components/assets/discovery-tabs';
import { LifecycleTab } from '../../src/components/assets/lifecycle-tab';
import { PriceCard } from '../../src/components/assets/price-card';
import { TransferCard, type OpenTransfer } from '../../src/components/assets/transfer-card';
import { useTheme } from '../../src/theme';
import { Button, Card, IconBadge, Screen, SectionTitle, StatusPill } from '../../src/components/ui';

interface Person {
  id?: string;
  email: string;
  profile: { firstName: string; lastName: string; employeeNumber?: string | null } | null;
}

/** The `GET /assets/:id` payload - the same one the web asset page reads. */
interface AssetDetail {
  id: string;
  assetTag: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  macAddress?: string | null;
  imei?: string | null;
  specs?: Record<string, string> | null;
  status: AssetStatus;
  condition: AssetCondition;
  // v2.1 Workstream A — nullable until backfilled / dual-written.
  lifecycleState: LifecycleState | null;
  availabilityState: AvailabilityState | null;
  ownershipType: OwnershipType | null;
  category?: { name: string } | null;
  subcategory?: { key: string; name: string } | null;
  office?: { id: string; name: string } | null;
  purchaseDate: string | null;
  warrantyStartDate?: string | null;
  warrantyEndDate: string | null;
  expectedReplacementDate?: string | null;
  notes?: string | null;
  /** Sent only to holders of assets:cost:read - the API omits it for everyone else. */
  purchaseCost?: string | null;
  currency?: string | null;
  /** The open office transfer, if the asset is on the road. */
  transfers?: OpenTransfer[];
  disposal?: DisposalRecord | null;
  /** v2.53 - the catalogue listing this unit came from, when it came through procurement. */
  vendorProduct?: { id: string; name: string } | null;
  assignedUser?: (Person & { id: string }) | null;
  /** The real total - `assignments` is capped at 20 by the API. */
  assignmentCount?: number;
  assignments: {
    id: string;
    assignedAt: string;
    returnedAt: string | null;
    acknowledgedAt: string | null;
    assignedBy?: { profile: { firstName: string; lastName: string } | null } | null;
    user: (Person & { id?: string }) | null;
    assetReturn: { conditionIn?: string | null; damageNotes: string | null } | null;
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
  // v2.5 H4 - null/zero until discovery has reported this machine.
  hardwareProfile?: HardwareProfileDto | null;
  osInfo?: OsInfoDto | null;
  health?: HealthDto | null;
  _count?: { installedSoftware: number };
}

/** The web's date style: "14 Sept 2026", a dash for nothing. */
function fmtDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Asset detail — the screen a QR scan opens (spec section 15).
 *
 * Laid out as the web asset page is: the same header pills, the same tabs
 * shown to the same people, and the same wording, most of it from the domain
 * package's asset-detail module that the web page renders too. A client
 * holding a phone next to a laptop should read the same asset twice, not two
 * slightly different ones.
 */
export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useSession();
  const router = useRouter();
  const { c, scheme, spacing } = useTheme();

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<AssetDetailTabKey>('overview');

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
  // The asset's own holder first, as the web does: imported records have one
  // with no handover behind it.
  const holderName = holderDisplayName(asset?.assignedUser, openAssignment?.user);
  const holderId = asset?.assignedUser?.id ?? null;
  const isHeld = Boolean(asset?.assignedUser || openAssignment);

  // The API enforces these regardless; this only decides what is worth showing.
  const can = (permission: string) => user?.permissions.includes(permission) ?? false;
  const mayAssign = can(PERMISSIONS.ASSETS_ASSIGN);
  const mayReturn = can(PERMISSIONS.ASSETS_RETURN);
  const mayEdit = can(PERMISSIONS.ASSETS_UPDATE);
  const canSeeCost = can(PERMISSIONS.ASSETS_COST_READ);
  // Either custody right is enough to photograph a handover (web: condition-photos.tsx).
  const canCapture = mayAssign || mayReturn;
  const isMine = Boolean(user && holderId === user.id);

  const [handover, setHandover] = useState<HandoverMode | null>(null);
  /**
   * Set the moment a handover or return completes, which opens the camera.
   *
   * This is the reason to do this on a phone at all: the equipment is on the
   * desk, in front of both people, right now. Asking someone to photograph it
   * later means photographing it from memory, or not at all.
   */
  const [photoStage, setPhotoStage] = useState<PhotoStage | null>(null);
  /** Bumped after a photo is saved, so the photo section reloads. */
  const [photoVersion, setPhotoVersion] = useState(0);

  async function confirmReceipt() {
    if (!openAssignment) return;
    setBusy(true);
    try {
      await api.request(`/assets/assignments/${openAssignment.id}/acknowledge`, { method: 'POST' });
      await load();
      setPhotoVersion((n) => n + 1);
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

  const softwareCount = asset._count?.installedSoftware ?? 0;
  const tabs = assetDetailTabs({ showDiscovery: hasDiscoveryTabs(asset), softwareCount, canSeeCost });
  // Moving from a laptop to a headset with "Hardware" open would leave the
  // screen on a tab that no longer exists; fall back rather than show nothing.
  const activeTab = tabs.some((t) => t.key === tab) ? tab : 'overview';

  // Offered to whoever the API lets report it - a fleet manager, or the person
  // holding the device - and not once it already is (web: same rule).
  const mayReportDamage = asset.status !== 'DAMAGED' && (mayEdit || isMine);
  const offer = custodyOptions({ canAssign: mayAssign, canReturn: mayReturn, status: asset.status, isHeld });
  const spec = assetSpecRows(asset.subcategory?.key, asset.specs);
  const issuedBy = issuedByName(asset.assignments);
  const warranty = warrantySource(
    asset.serialNumber,
    asset.hardwareProfile?.manufacturer,
    asset.brand,
    asset.model,
    asset.name,
  );
  const conditionToken = CONDITION_TOKENS[asset.condition];

  function checkWarranty() {
    if (!warranty) return;
    const open = () => void Linking.openURL(warranty.url);
    const notice = warrantyCheckNotice(warranty, asset?.serialNumber);
    if (!notice) {
      open();
      return;
    }
    Alert.alert(`Check with ${warranty.label}`, notice, [
      { text: 'Cancel', style: 'cancel' },
      { text: `Open ${warranty.label}`, onPress: open },
    ]);
  }

  return (
    <Screen scroll>
      <Card style={{ marginBottom: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <IconBadge icon="hardware-chip-outline" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '800' }}>{asset.name}</Text>
            <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>
              {asset.assetTag}
              {asset.serialNumber ? ` · SN ${asset.serialNumber}` : ''}
            </Text>
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
        {mayReportDamage ? (
          <Button
            label="Report damage"
            icon="warning-outline"
            variant="danger"
            onPress={reportDamage}
            disabled={busy}
            style={{ marginTop: spacing.md, paddingVertical: 10 }}
          />
        ) : null}
      </Card>

      <TabStrip tabs={tabs} active={activeTab} onChange={setTab} />

      {activeTab === 'overview' ? (
        <>
          <Card style={{ padding: 0, marginBottom: spacing.xl }}>
            <InfoRow label="Category" value={asset.category?.name} />
            <InfoRow label="Type" value={asset.subcategory?.name} />
            <InfoRow label="Office" value={asset.office?.name} />
            <InfoRow label="Brand" value={asset.brand} />
            <InfoRow label="Model" value={asset.model} />
            {/* Shown only when the asset carries one, as on the web. */}
            {asset.imei ? <InfoRow label="IMEI" value={asset.imei} /> : null}
            {asset.macAddress ? <InfoRow label="MAC address" value={asset.macAddress} /> : null}
            <InfoRow label="Condition" value={<ToneBadge tone={conditionToken.tone} label={conditionToken.label} />} />
            <InfoRow label="Purchased on" value={fmtDate(asset.purchaseDate)} />
            {/* v2.53 - what this unit is according to the supplier who sold it.
                A link only for someone who can open the catalogue: an employee
                looking at their own laptop would otherwise tap through to a
                screen that refuses them. */}
            {asset.vendorProduct ? (
              <InfoRow
                label="Supplied as"
                value={asset.vendorProduct.name}
                {...(can(PERMISSIONS.VENDOR_PRODUCTS_READ)
                  ? { onPress: () => router.push(`/offer/${asset.vendorProduct!.id}`) }
                  : {})}
              />
            ) : null}
            <InfoRow
              label="Warranty ends"
              value={
                <>
                  <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>
                    {fmtDate(asset.warrantyEndDate)}
                  </Text>
                  {/* The maker's official lookup, detected from what the asset
                      already knows - same source list as the web. */}
                  {warranty ? (
                    <Pressable
                      onPress={checkWarranty}
                      accessibilityRole="link"
                      hitSlop={6}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                    >
                      <Ionicons name="shield-checkmark-outline" size={13} color={c.brand} />
                      <Text style={{ color: c.brand, fontSize: 13, fontWeight: '600' }}>
                        Check with {warranty.label}
                      </Text>
                      <Ionicons name="open-outline" size={13} color={c.brand} />
                    </Pressable>
                  ) : null}
                </>
              }
            />
            <InfoRow
              label="Assigned to"
              last
              value={
                holderName ? (
                  <>
                    <Text style={{ color: c.text, fontWeight: '600', fontSize: 14, textAlign: 'right' }}>
                      {holderName}
                      {asset.assignedUser?.profile?.employeeNumber ? (
                        <Text style={{ color: c.subtle, fontSize: 12, fontWeight: '400' }}>
                          {' '}
                          · {asset.assignedUser.profile.employeeNumber}
                        </Text>
                      ) : null}
                    </Text>
                    {issuedBy ? (
                      <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }}>issued by {issuedBy}</Text>
                    ) : null}
                  </>
                ) : (
                  'Unassigned'
                )
              }
            />
          </Card>

          {asset.notes ? (
            <Card style={{ marginTop: -spacing.md, marginBottom: spacing.xl }}>
              <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19 }}>{asset.notes}</Text>
            </Card>
          ) : null}

          {/* v2.20 - whatever the type declared, labelled from the same
              catalogue the form used. Nothing recorded, nothing shown. */}
          {spec.rows.length > 0 ? (
            <>
              <SectionTitle>{spec.title}</SectionTitle>
              <Card style={{ padding: 0, marginBottom: spacing.xl }}>
                {spec.rows.map(([label, value], i) => (
                  <InfoRow key={label} label={label} value={value} last={i === spec.rows.length - 1} />
                ))}
              </Card>
            </>
          ) : null}

          {/* Custody: the web panel's moves, gated by the same rule, plus the
              holder's side of it - confirming receipt - which is the phone's. */}
          {offer.show || (openAssignment && isMine) ? (
            <>
              <SectionTitle>Custody</SectionTitle>
              <Card style={{ marginBottom: spacing.xl }}>
                <Text style={{ color: c.muted, fontSize: 13, marginBottom: spacing.md }}>
                  {isHeld ? `Currently with ${holderName ?? 'someone'}.` : 'Not assigned to anyone right now.'}
                </Text>

                {openAssignment && isMine && !openAssignment.acknowledgedAt ? (
                  <Button
                    label="Confirm receipt"
                    icon="checkmark-circle-outline"
                    onPress={confirmReceipt}
                    loading={busy}
                    style={{ marginBottom: spacing.md }}
                  />
                ) : null}

                {/* Offered for as long as the asset is out, not just before
                    receipt is confirmed: a mouse or a monitor gets damaged
                    months later, and the person holding it is the only one
                    looking at it. Confirming locks removal, not addition.
                    Custody staff get the same camera from the photo section. */}
                {openAssignment && isMine && !canCapture ? (
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

                {offer.assign ? (
                  <Button
                    label="Assign"
                    icon="person-add-outline"
                    onPress={() => setHandover('assign')}
                    disabled={busy}
                    style={{ marginBottom: spacing.sm }}
                  />
                ) : null}
                {offer.handOver ? (
                  <Button
                    label="Hand over"
                    icon="swap-horizontal-outline"
                    variant="secondary"
                    onPress={() => setHandover('reassign')}
                    disabled={busy}
                    style={{ marginBottom: spacing.sm }}
                  />
                ) : null}
                {offer.recordReturn ? (
                  <Button
                    label="Record return"
                    icon="arrow-undo-outline"
                    variant="secondary"
                    onPress={() => setHandover('return')}
                    disabled={busy}
                  />
                ) : null}
              </Card>
            </>
          ) : null}

          {/* v2.32 - condition evidence, before and after, as a timeline per
              custody event. Shown whether or not the asset is out now. */}
          <ConditionPhotoStrip
            assetId={asset.id}
            refreshKey={photoVersion}
            canCapture={canCapture}
            holderName={holderName}
            onAdd={setPhotoStage}
          />
          <View style={{ height: spacing.sm }} />

          {/* v2.21 - what else this person was given. Only with a holder: with
              nobody holding it there is no kit to speak of. */}
          {holderId ? (
            <EquipmentKit holderId={holderId} holderName={holderName} excludeAssetId={asset.id} />
          ) : null}

          <TransferCard
            assetId={asset.id}
            assetName={asset.name}
            status={asset.status}
            officeId={asset.office?.id ?? null}
            holderId={holderId}
            openTransfer={asset.transfers?.[0] ?? null}
            onChanged={() => void load()}
          />

          {/* End of life: the record once it exists, or the action for
              assets:dispose holders when the state machine allows it. */}
          <DisposalCard
            assetId={asset.id}
            assetName={asset.name}
            status={asset.status}
            disposal={asset.disposal ?? null}
            onChanged={() => void load()}
          />
        </>
      ) : null}

      {activeTab === 'lifecycle' ? <LifecycleTab data={asset} formatDate={fmtDate} /> : null}
      {activeTab === 'hardware' ? <HardwareTab hw={asset.hardwareProfile ?? null} /> : null}
      {activeTab === 'os' ? <OsTab os={asset.osInfo ?? null} /> : null}
      {activeTab === 'software' ? <SoftwareTab assetId={asset.id} total={softwareCount} /> : null}
      {activeTab === 'health' ? (
        <HealthTab
          assetId={asset.id}
          health={asset.health ?? null}
          canRecompute={mayEdit}
          onRecomputed={() => void load()}
        />
      ) : null}

      {activeTab === 'history' ? <HistoryTab asset={asset} /> : null}

      {/* Price — assets:cost:read only (PriceCard checks again); recorded once, then locked. */}
      {activeTab === 'financials' && canSeeCost ? (
        <PriceCard
          assetId={asset.id}
          purchaseCost={asset.purchaseCost}
          currency={asset.currency}
          onRecorded={() => void load()}
        />
      ) : null}

      {/* Mounted whatever the tab, so a handover finished from the custody
          card can still open the camera straight after. */}
      <HandoverSheet
        visible={handover !== null}
        mode={handover ?? 'assign'}
        assetId={asset.id}
        assetName={asset.name}
        holderName={holderName}
        onClose={() => setHandover(null)}
        onDone={() => {
          void load();
          setPhotoVersion((n) => n + 1);
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
    </Screen>
  );
}

/** "Custody & condition history" - the web tab's lines, from the same domain function. */
function HistoryTab({ asset }: { asset: AssetDetail }) {
  const { c } = useTheme();
  const entries = custodyHistory(asset, fmtDate);
  const warn = c.warning;

  return (
    <>
      <SectionTitle>{'Custody & condition history'}</SectionTitle>
      {entries.length === 0 ? (
        <Card>
          <Text style={{ color: c.muted, fontSize: 14 }}>No history yet.</Text>
        </Card>
      ) : (
        <Card style={{ padding: 0 }}>
          {entries.map((entry, i) => {
            // The phone also says whether an open handover was confirmed: the
            // holder confirms it here, so this is where they check.
            const open =
              entry.kind === 'assignment'
                ? asset.assignments.find((a) => `a-${a.id}` === entry.key && !a.returnedAt)
                : undefined;
            return (
              <View
                key={entry.key}
                style={{
                  flexDirection: 'row',
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderBottomWidth: i === entries.length - 1 ? 0 : 1,
                  borderBottomColor: c.border,
                }}
              >
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    marginTop: 6,
                    backgroundColor: entry.kind === 'assignment' ? c.brand : c.subtle,
                  }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>{entry.title}</Text>
                  <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }}>
                    {entry.date}
                    {entry.suffix}
                    {open ? (open.acknowledgedAt ? ' · receipt confirmed' : ' · awaiting receipt') : ''}
                  </Text>
                  {entry.note ? (
                    <Text
                      style={{
                        color: entry.noteTone === 'warning' ? warn : c.muted,
                        fontSize: 12,
                        marginTop: 2,
                      }}
                    >
                      {entry.note}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </Card>
      )}
    </>
  );
}
