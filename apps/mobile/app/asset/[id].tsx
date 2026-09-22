import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import {
  PERMISSIONS,
  assetDetailNav,
  assetIdentifier,
  assetSlides,
  assetSpecRows,
  conditionSentence,
  custodyHistory,
  custodyOptions,
  deviceHealthTiles,
  deviceLifecycle,
  hasDiscoveryTabs,
  headerMeta,
  HEALTH_GRADE_TONE,
  issuedByName,
  latestAgentReport,
  noteSummary,
  quickSpecs,
  relativeAge,
  reportFreshness,
  resolveAssetImageSource,
  warrantySource,
  lastVerifiedLabel,
  type AssetCondition,
  type AssetDetailNavKey,
  type AssetStatus,
  type AvailabilityState,
  type HealthTile,
  type LifecycleState,
  type OwnershipType,
} from '@techpioasset/domain';
import { CONDITION_TOKENS, TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { assetPills } from '../../src/asset-pills';
import { DISPOSABLE_FROM, transferView } from '../../src/lib/asset-admin';
import { holderDisplayName, warrantyCheckNotice } from '../../src/lib/asset-detail';
import { assetScreenAction } from '../../src/lib/scan-actions';
import {
  agentPill,
  keyInformationSummary,
  assetNavIcon,
  healthScoreTile,
  lastSyncLine,
  moreActions,
  warrantyStanding,
  type MoreActionKey,
} from '../../src/lib/asset-overview';
import { primaryPhotoId, unitPhotos, usesLegacyPhotoRoutes } from '../../src/lib/asset-photos';
import { useSession } from '../../src/providers/session';
import { cacheAsset, cachedAsset, savedLabel } from '../../src/lib/offline-cache';
import { isNoConnection } from '../../src/lib/sync-service';
import { SyncBanner } from '../../src/components/sync-banner';
import { AuthImage } from '../../src/components/auth-image';
import { HandoverSheet, type HandoverMode } from '../../src/components/handover-sheet';
import { ConditionPhotoSheet, type PhotoStage } from '../../src/components/condition-photo-sheet';
import {
  ConditionPhotoStrip,
  useConditionPhotoGroups,
} from '../../src/components/condition-photo-strip';
import { AssetImageCard, DeviceIcon } from '../../src/components/assets/asset-image-card';
import { AssetNotes } from '../../src/components/assets/asset-notes';
import { DisposalCard, type DisposalRecord } from '../../src/components/assets/disposal-card';
import { EquipmentKit } from '../../src/components/assets/equipment-kit';
import {
  CardLink,
  CardTitle,
  InfoRow,
  TabStrip,
  ToneBadge,
} from '../../src/components/assets/detail-parts';
import {
  HardwareTab,
  HealthTab,
  OsTab,
  SoftwareTab,
  type HardwareProfileDto,
  type HealthDto,
  type OsInfoDto,
} from '../../src/components/assets/discovery-tabs';
import { HealthTileGrid } from '../../src/components/assets/health-tiles';
import { LifecycleTab, TimelineEvent } from '../../src/components/assets/lifecycle-tab';
import { MoreActionsSheet } from '../../src/components/assets/more-actions-sheet';
import { PriceCard } from '../../src/components/assets/price-card';
import { TransferCard, type OpenTransfer } from '../../src/components/assets/transfer-card';
import { useTheme } from '../../src/theme';
import { Button, Card, Screen, SectionTitle, StatusPill } from '../../src/components/ui';

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
  description?: string | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  macAddress?: string | null;
  imei?: string | null;
  specs?: Record<string, string> | null;
  /** What the QR label encodes (as a scan address); null only on records that predate labels. */
  qrToken?: string | null;
  status: AssetStatus;
  condition: AssetCondition;
  // v2.1 Workstream A — nullable until backfilled / dual-written.
  lifecycleState: LifecycleState | null;
  availabilityState: AvailabilityState | null;
  ownershipType: OwnershipType | null;
  /** The optimistic-lock version; every PATCH carries it. */
  version: number;
  category?: { name: string } | null;
  subcategory?: { key: string; name: string } | null;
  office?: { id: string; name: string } | null;
  department?: { id: string; name: string } | null;
  purchaseDate: string | null;
  warrantyStartDate?: string | null;
  warrantyEndDate: string | null;
  expectedReplacementDate?: string | null;
  notes?: string | null;
  /**
   * v2.61 - the unit's own uploaded picture, if any. v2.66 - the asset's
   * PRIMARY picture, which somebody may have chosen from any photograph on it:
   * `entityType` is 'AssetPhoto' for a photo of the unit, 'AssetAssignment' or
   * 'AssetReturn' for a handover or return photo. Absent from an older API.
   */
  photo?: { id: string; mimeType: string; createdAt: string; entityType?: string | null } | null;
  /**
   * v2.65 - every photograph of the unit (up to five), the cover first. Absent
   * from an API that predates it, where `photo` is then the whole list.
   */
  photos?: { id: string; mimeType: string; sizeBytes?: number | null; createdAt: string }[];
  /** 0.3.31 - the most recent physical verification; absent from an older API. */
  lastVerification?: { verifiedAt: string; by: string | null } | null;
  /** Sent only to holders of assets:cost:read - the API omits it for everyone else. */
  purchaseCost?: string | null;
  currency?: string | null;
  /** The open office transfer, if the asset is on the road. */
  transfers?: OpenTransfer[];
  disposal?: DisposalRecord | null;
  /** v2.53 - the catalogue listing this unit came from, when it came through procurement. */
  vendorProduct?: {
    id: string;
    name: string;
    warrantyMonths?: number | null;
    /** v2.61 - the listing's lead picture, which the image card shows first. */
    primaryImageId?: string | null;
  } | null;
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

/** The overview panels the "More actions" sheet can bring into view. */
type Anchor = 'custody' | 'transfer' | 'disposal';

/**
 * Asset detail — the screen a QR scan opens (spec section 15).
 *
 * Laid out as the redesigned web asset page is (v2.61 → phone v2.62): the
 * same header, the same sections in the same order, the same picture rule and
 * health tiles, and the same "More actions" doors, most of it from the domain
 * package's asset-detail and asset-overview modules that the web page renders
 * too. A client holding a phone next to a laptop should read the same asset
 * twice, not two slightly different ones.
 */
export default function AssetDetailScreen() {
  const { id, action } = useLocalSearchParams<{ id: string; action?: string }>();
  return <AssetDetailView id={id} action={action} />;
}

/**
 * The asset page itself (v2.83): a screen of its own on a phone, and the
 * right-hand pane beside the asset list on a tablet.
 */
export function AssetDetailView({ id, action: actionParam }: { id: string; action?: string }) {
  // 0.3.31 - the scanner's sheet sends somebody here to DO something
  // (?action=reassign): the flow they asked for opens once the asset is
  // loaded, and only once - a reload after saving must not reopen it.
  const askedAction = assetScreenAction(actionParam);
  const actionHandled = useRef(false);
  const { api, user } = useSession();
  const router = useRouter();
  const { c, scheme, spacing, radius } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<AssetDetailNavKey>('overview');
  const [actionsOpen, setActionsOpen] = useState(false);

  // Bringing an overview panel into view from the sheet: the panels report
  // where they landed, and a jump waits for the one it wants when the
  // overview has to mount first.
  const scrollRef = useRef<ScrollView>(null);
  const anchors = useRef<Partial<Record<Anchor, number>>>({});
  const [pendingJump, setPendingJump] = useState<Anchor | null>(null);

  // v2.82 - when this copy came from the phone rather than the server.
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const data = await api.request<AssetDetail>(`/assets/${id}`);
      setAsset(data);
      setOfflineSince(null);
      void cacheAsset(id, data);
    } catch (error) {
      // No signal: the copy from the last time it was opened, so a handover
      // can still be recorded. The server's own refusals are not hidden.
      if (!isNoConnection(error)) throw error;
      const cached = await cachedAsset<AssetDetail>(id);
      if (!cached) throw error;
      setAsset(cached.value);
      setOfflineSince(cached.savedAt);
    }
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
  const canOpenCatalogue = can(PERMISSIONS.VENDOR_PRODUCTS_READ);
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
  // v2.63 - loaded once here, not inside the Condition photos section: the
  // lead picture box shows the same photographs as a slideshow, and one
  // request serves both (web: the two cards share one query).
  const { groups: photoGroups, reload: reloadPhotos } = useConditionPhotoGroups(id, photoVersion);
  /** The header thumbnail's path, once it has failed to load: the glyph takes over. */
  const [failedThumb, setFailedThumb] = useState<string | null>(null);

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
  const confirmReceiptRef = useRef(confirmReceipt);
  confirmReceiptRef.current = confirmReceipt;

  // The effect above must call the current reportDamage without listing it as
  // an input (it is re-created every render).
  const reportDamageRef = useRef<() => Promise<void>>(async () => undefined);

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
  reportDamageRef.current = reportDamage;

  // Only what this screen would offer anyway: the param is a shortcut to a
  // button that is already here, never a way round one that is not.
  const assetStatus = asset?.status ?? null;
  useEffect(() => {
    if (!askedAction || actionHandled.current || !assetStatus) return;
    actionHandled.current = true;
    const custody = custodyOptions({
      canAssign: mayAssign,
      canReturn: mayReturn,
      status: assetStatus,
      isHeld,
    });
    const allowed =
      (askedAction === 'assign' && custody.show && custody.assign) ||
      (askedAction === 'reassign' && custody.show && custody.handOver) ||
      (askedAction === 'return' && custody.show && custody.recordReturn);
    if (allowed) {
      setHandover(askedAction as HandoverMode);
    } else if (askedAction === 'damage' && assetStatus !== 'DAMAGED' && (mayEdit || isMine)) {
      Alert.alert(
        'Report this asset as damaged?',
        'IT is notified and its status changes to Damaged.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Report damage',
            style: 'destructive',
            onPress: () => void reportDamageRef.current(),
          },
        ],
      );
    } else if (askedAction === 'confirm-receipt') {
      // v2.78 - from the handover push. A receipt is evidence the device
      // reached this person, so it is asked once, with the tag in view, and
      // only the holder can give it (the server refuses anyone else too).
      if (openAssignment && isMine && !openAssignment.acknowledgedAt) {
        Alert.alert(
          `Confirm you have ${asset?.name ?? 'this asset'}?`,
          `${asset?.assetTag ?? ''} — only confirm if it is with you. If it is not, tell IT instead.`,
          [
            { text: 'Not yet', style: 'cancel' },
            { text: 'Confirm receipt', onPress: () => void confirmReceiptRef.current() },
          ],
        );
      } else if (openAssignment && isMine) {
        Alert.alert('Already confirmed', 'You have already confirmed you received this asset.');
      } else {
        Alert.alert('Nothing to confirm', 'This asset is not assigned to you any more.');
      }
    }
  }, [
    askedAction,
    assetStatus,
    mayAssign,
    mayReturn,
    isHeld,
    mayEdit,
    isMine,
    openAssignment,
    asset?.name,
    asset?.assetTag,
  ]);

  if (!asset) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }

  const softwareCount = asset._count?.installedSoftware ?? 0;
  const showDiscovery = hasDiscoveryTabs(asset);
  const nav = assetDetailNav({ showDiscovery, softwareCount, canSeeCost });
  const tabs = nav.map((item) => ({ ...item, icon: assetNavIcon(item.key) }));
  // Moving from a laptop to a headset with "Hardware" open would leave the
  // screen on a tab that no longer exists; fall back rather than show nothing.
  const activeTab: AssetDetailNavKey = tabs.some((t) => t.key === tab) ? tab : 'overview';

  // Offered to whoever the API lets report it - a fleet manager, or the person
  // holding the device - and not once it already is (web: same rule).
  const mayReportDamage = asset.status !== 'DAMAGED' && (mayEdit || isMine);
  const offer = custodyOptions({
    canAssign: mayAssign,
    canReturn: mayReturn,
    status: asset.status,
    isHeld,
  });

  const transfer = transferView({
    canTransfer: can(PERMISSIONS.ASSETS_TRANSFER),
    status: asset.status,
    holderId,
    hasOpenTransfer: Boolean(asset.transfers?.[0]),
  });
  const canDispose =
    !asset.disposal && can(PERMISSIONS.ASSETS_DISPOSE) && DISPOSABLE_FROM.includes(asset.status);
  const actionGroups = moreActions({
    hasHolder: Boolean(asset.assignedUser),
    canUpdate: mayEdit,
    hasQrToken: Boolean(asset.qrToken),
    custody: offer,
    transfer,
    canDispose,
    canSeeCost,
    hasPrice: asset.purchaseCost != null,
  });

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
  const identifier = assetIdentifier(asset);
  const meta = headerMeta({
    brand: asset.brand,
    model: asset.model,
    typeName: asset.subcategory?.name,
    holderName,
  });
  const lastReport = latestAgentReport(asset.hardwareProfile, asset.osInfo);
  const agent = lastReport ? agentPill(reportFreshness(lastReport.at), lastReport.at) : null;
  const imageSource = resolveAssetImageSource(asset);
  // v2.65 - all the photos of the unit, for the lead box's slideshow and its
  // photo strip; read once here so the header thumbnail agrees with both.
  // v2.66 - the server's list is taken as sent even when EMPTY: the primary
  // picture may be a handover photo, which is not a photo of the unit and is
  // already among the condition photos. Only an API too old to send a list
  // falls back to `photo` (unitPhotos, lib/asset-photos.ts).
  const ownPhotos = unitPhotos(asset);
  // v2.66 - the picture somebody chose to lead the asset, of whichever kind;
  // the strip's "Primary" mark and both viewers' badges follow this id.
  const primaryId = primaryPhotoId(asset);
  // Choosing it is an edit to the record (assets:update), and needs the v2.66
  // route; a server too old to list `photos` certainly has not got it.
  const maySetPrimary = mayEdit && !usesLegacyPhotoRoutes(asset);
  // A handover photo removed from the Condition photos section may have been
  // the primary; the server then clears the choice, so the asset is re-read as
  // well or the lead box would go on asking for a picture that is gone.
  const reloadConditionPhotos = async () => {
    await reloadPhotos();
    if (primaryId && !ownPhotos.some((p) => p.id === primaryId)) void load();
  };
  const tiles: HealthTile[] = [
    ...(asset.health
      ? [healthScoreTile(asset.health, HEALTH_GRADE_TONE[asset.health.grade] as HealthTile['tone'])]
      : []),
    ...deviceHealthTiles(asset.hardwareProfile, asset.osInfo),
  ];
  const specs = quickSpecs({
    hw: asset.hardwareProfile,
    os: asset.osInfo,
    specs: asset.specs,
    assetTag: asset.assetTag,
  });
  const { events } = deviceLifecycle(asset, fmtDate);
  const standing = warrantyStanding(asset.warrantyEndDate);
  const summary = noteSummary(asset.notes);
  // The header thumbnail is the lead box's cover (v2.64) - the first of the
  // domain's slides, so an asset with only handover photos shows one of them
  // here too. The device glyph stands in when there is no picture, or when
  // this one cannot be loaded.
  const thumbPath =
    assetSlides({
      assetId: asset.id,
      source: imageSource,
      ownPhoto: ownPhotos[0] ?? null,
      ownPhotos,
      catalogue: asset.vendorProduct?.primaryImageId
        ? { productId: asset.vendorProduct.id, imageId: asset.vendorProduct.primaryImageId }
        : null,
      groups: photoGroups ?? [],
    })[0]?.path ?? null;
  const thumb = thumbPath && thumbPath !== failedThumb ? api.imageSource(thumbPath) : null;

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

  const scrollToAnchor = (key: Anchor) => {
    const y = anchors.current[key];
    if (y == null) return false;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.sm), animated: true });
    return true;
  };
  const anchorLayout = (key: Anchor) => (e: LayoutChangeEvent) => {
    anchors.current[key] = e.nativeEvent.layout.y;
    if (pendingJump === key) {
      scrollToAnchor(key);
      setPendingJump(null);
    }
  };
  /** Switch to the overview and bring one of its panels into view. */
  function jumpTo(key: Anchor) {
    if (activeTab === 'overview' && scrollToAnchor(key)) return;
    setTab('overview');
    setPendingJump(key);
  }

  function runAction(key: MoreActionKey) {
    if (!asset) return;
    switch (key) {
      case 'receipt':
        router.push(`/asset/receipt?id=${asset.id}`);
        return;
      case 'edit':
        router.push(`/asset/edit?id=${asset.id}`);
        return;
      case 'qr':
        setTab('lifecycle');
        return;
      case 'price':
        setTab('financials');
        return;
      default:
        jumpTo(key);
    }
  }

  const openListing =
    asset.vendorProduct && canOpenCatalogue
      ? () => router.push(`/offer/${asset.vendorProduct!.id}`)
      : undefined;

  return (
    <Screen scroll scrollRef={scrollRef}>
      {offlineSince ? (
        <Card style={{ marginBottom: spacing.md, borderColor: c.warning, borderWidth: 1 }}>
          <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }}>No connection</Text>
          <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
            Showing this asset as of {savedLabel(offlineSince)}. A handover or return you record is
            saved on the phone and sent when you are back online.
          </Text>
        </Card>
      ) : null}
      <SyncBanner />
      {/* Header: who this device is, in one glance. */}
      <Card style={{ marginBottom: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
          {thumb ? (
            <AuthImage
              uri={thumb.uri}
              headers={thumb.headers}
              style={{ width: 48, height: 48, borderRadius: 12 }}
              accessibilityLabel={asset.name}
              onError={() => setFailedThumb(thumbPath)}
            />
          ) : (
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                backgroundColor: c.brandSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <DeviceIcon typeKey={asset.subcategory?.key} size={24} color={c.brand} />
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '800' }}>
              {asset.name}
              {identifier ? (
                <Text style={{ color: c.muted, fontWeight: '400', fontSize: 15 }}>
                  {' '}
                  · {identifier.label} {identifier.value}
                </Text>
              ) : null}
            </Text>
            <Text style={{ color: c.muted, fontSize: 13, marginTop: 3, lineHeight: 18 }}>
              {[...meta, asset.assetTag].join('  |  ')}
            </Text>
          </View>
          {actionGroups.length > 0 ? (
            <Pressable
              onPress={() => setActionsOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="More actions"
              hitSlop={8}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: c.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="ellipsis-horizontal" size={18} color={c.text} />
            </Pressable>
          ) : null}
        </View>

        <View
          style={{
            marginTop: spacing.md,
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 6,
            alignItems: 'center',
          }}
        >
          {assetPills(asset, scheme, { includeOwnership: true }).map((p) => (
            <StatusPill key={p.label} label={p.label} bg={p.bg} fg={p.fg} />
          ))}
          <StatusPill
            label={`Condition: ${conditionToken.label}`}
            bg={palette[conditionToken.tone].bg}
            fg={palette[conditionToken.tone].fg}
          />
          {/* Agent freshness, never "online": the agent reports on a schedule,
              so the honest claim is how recently it did. */}
          {agent ? (
            <StatusPill
              label={agent.label}
              bg={palette[agent.tone].bg}
              fg={palette[agent.tone].fg}
            />
          ) : null}
        </View>

        {lastReport ? (
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md }}
          >
            <Ionicons name="sync-outline" size={13} color={c.subtle} />
            <Text style={{ color: c.subtle, fontSize: 12, flex: 1 }}>
              Last sync{' '}
              <Text style={{ color: c.muted, fontWeight: '600' }}>
                {new Date(lastReport.at).toLocaleString()}
              </Text>
              {' · '}
              {lastSyncLine(lastReport)}
            </Text>
          </View>
        ) : null}

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
          <AssetImageCard
            assetId={asset.id}
            assetName={asset.name}
            typeKey={asset.subcategory?.key}
            brand={asset.brand}
            source={imageSource}
            ownPhotos={ownPhotos}
            primaryPhotoId={primaryId}
            legacyPhotoApi={usesLegacyPhotoRoutes(asset)}
            catalogue={
              asset.vendorProduct?.primaryImageId
                ? { productId: asset.vendorProduct.id, imageId: asset.vendorProduct.primaryImageId }
                : null
            }
            groups={photoGroups}
            canManage={mayEdit}
            onViewListing={openListing}
            onChanged={() => void load()}
          />

          {/* Keyed by asset so it is shut again if this screen is ever handed
              a different asset without remounting. */}
          <CollapsibleListCard
            key={asset.id}
            title="Key information"
            summary={keyInformationSummary(asset)}
          >
            <InfoRow
              label="Serial number"
              value={asset.serialNumber}
              copy={asset.serialNumber}
              mono
            />
            <InfoRow label="Asset tag" value={asset.assetTag} copy={asset.assetTag} mono />
            <InfoRow label="Category" value={asset.category?.name} />
            <InfoRow label="Type" value={asset.subcategory?.name} />
            <InfoRow label="Brand" value={asset.brand} />
            <InfoRow label="Model" value={asset.model} />
            {/* Shown only when the asset carries one, so a monitor's list is
                not padded with blank network rows. */}
            {asset.macAddress ? (
              <InfoRow label="MAC address" value={asset.macAddress} copy={asset.macAddress} mono />
            ) : null}
            {asset.imei ? <InfoRow label="IMEI" value={asset.imei} copy={asset.imei} mono /> : null}
            <InfoRow label="Office" value={asset.office?.name} />
            {/* 0.3.31 - when the unit was last physically seen on a verification round. */}
            <InfoRow
              label="Last verified"
              value={lastVerifiedLabel(asset.lastVerification ?? null, new Date(), (d) =>
                fmtDate(d.toISOString()),
              )}
            />
            <InfoRow
              label="Assigned to"
              last={!asset.department && !asset.vendorProduct}
              value={
                holderName ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text
                      style={{ color: c.text, fontWeight: '600', fontSize: 14, textAlign: 'right' }}
                    >
                      {holderName}
                      {asset.assignedUser?.profile?.employeeNumber ? (
                        <Text style={{ color: c.subtle, fontSize: 12, fontWeight: '400' }}>
                          {' '}
                          · {asset.assignedUser.profile.employeeNumber}
                        </Text>
                      ) : null}
                    </Text>
                    {issuedBy ? (
                      <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }}>
                        issued by {issuedBy}
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  'Unassigned'
                )
              }
            />
            {asset.department ? (
              <InfoRow
                label="Team / department"
                value={asset.department.name}
                last={!asset.vendorProduct}
              />
            ) : null}
            {/* v2.53 - what this unit is according to the supplier who sold it.
                A link only for someone who can open the catalogue: an employee
                looking at their own laptop would otherwise tap through to a
                screen that refuses them. */}
            {asset.vendorProduct ? (
              <InfoRow
                label="Supplied as"
                value={asset.vendorProduct.name}
                last
                {...(openListing ? { onPress: openListing } : {})}
              />
            ) : null}
          </CollapsibleListCard>

          {tiles.length > 0 ? (
            <Card style={{ marginBottom: spacing.lg }}>
              <CardTitle
                action={
                  lastReport ? (
                    <Text style={{ color: c.subtle, fontSize: 12 }}>
                      Reported {relativeAge(lastReport.at)}
                    </Text>
                  ) : null
                }
              >
                Device health
              </CardTitle>
              <HealthTileGrid tiles={tiles} />
              {showDiscovery ? (
                <CardLink label="View health details" onPress={() => setTab('health')} />
              ) : null}
            </Card>
          ) : null}

          {/* v2.20 - whatever the type declared, labelled from the same
              catalogue the form used. Nothing recorded, nothing shown. */}
          {spec.rows.length > 0 ? (
            <ListCard title={`${spec.title} specification`}>
              {spec.rows.map(([label, value], i) => (
                <InfoRow
                  key={label}
                  label={label}
                  value={value}
                  last={i === spec.rows.length - 1}
                />
              ))}
            </ListCard>
          ) : null}

          {/* v2.32 - condition evidence, before and after, as a timeline per
              custody event. Shown whether or not the asset is out now. */}
          <ConditionPhotoStrip
            assetId={asset.id}
            groups={photoGroups}
            onReload={reloadConditionPhotos}
            primaryPhotoId={primaryId}
            onPrimaryChanged={maySetPrimary ? () => void load() : undefined}
            canCapture={canCapture}
            holderName={holderName}
            onAdd={setPhotoStage}
          />
          <View style={{ height: spacing.sm }} />

          <Card style={{ marginBottom: spacing.lg }}>
            <CardTitle
              action={
                <Pressable onPress={() => setTab('lifecycle')} accessibilityRole="link" hitSlop={6}>
                  <Text style={{ color: c.brand, fontSize: 13, fontWeight: '600' }}>
                    Full lifecycle →
                  </Text>
                </Pressable>
              }
            >
              {'Lifecycle & service'}
            </CardTitle>
            {events.length === 0 ? (
              <Text style={{ color: c.muted, fontSize: 14 }}>
                Nothing recorded for this device yet.
              </Text>
            ) : (
              events.map((e, i) => (
                <TimelineEvent
                  key={i}
                  event={e}
                  formatDate={fmtDate}
                  last={i === events.length - 1}
                />
              ))
            )}
          </Card>

          {/* v2.21 - what else this person was given. Only with a holder: with
              nobody holding it there is no kit to speak of. */}
          {holderId ? (
            <EquipmentKit holderId={holderId} holderName={holderName} excludeAssetId={asset.id} />
          ) : null}

          {/* Custody: the web panel's moves, gated by the same rule, plus the
              holder's side of it - confirming receipt - which is the phone's. */}
          <View onLayout={anchorLayout('custody')}>
            {offer.show || (openAssignment && isMine) ? (
              <>
                <SectionTitle>Custody</SectionTitle>
                <Card style={{ marginBottom: spacing.xl }}>
                  <Text style={{ color: c.muted, fontSize: 13, marginBottom: spacing.md }}>
                    {isHeld
                      ? `Currently with ${holderName ?? 'someone'}.`
                      : 'Not assigned to anyone right now.'}
                  </Text>

                  {openAssignment && isMine ? (
                    // v2.80 - the holder reports a fault on THIS item, already chosen.
                    <Button
                      label="Report a problem"
                      icon="warning-outline"
                      variant="secondary"
                      onPress={() => router.push(`/report-problem?assetId=${asset.id}`)}
                      style={{ marginBottom: spacing.md }}
                    />
                  ) : null}

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
          </View>

          <Card style={{ marginBottom: spacing.lg }}>
            <CardTitle>Condition</CardTitle>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <ToneBadge tone={conditionToken.tone} label={conditionToken.label} />
              <Text style={{ color: c.muted, fontSize: 14, flex: 1, lineHeight: 20 }}>
                {conditionSentence(asset.condition)}
              </Text>
            </View>
          </Card>

          <ListCard
            title={'Warranty & purchase'}
            action={<ToneBadge tone={standing.tone} label={standing.label} />}
          >
            <InfoRow label="Purchased on" value={fmtDate(asset.purchaseDate)} />
            {asset.vendorProduct?.warrantyMonths ? (
              <InfoRow label="Cover" value={`${asset.vendorProduct.warrantyMonths} months`} />
            ) : null}
            {asset.expectedReplacementDate ? (
              <InfoRow
                label="Expected replacement"
                value={fmtDate(asset.expectedReplacementDate)}
              />
            ) : null}
            <InfoRow
              label="Warranty ends"
              last
              value={
                <View style={{ alignItems: 'flex-end' }}>
                  <Text
                    style={{
                      color: standing.expired ? c.danger : c.text,
                      fontWeight: '600',
                      fontSize: 14,
                    }}
                  >
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
                </View>
              }
            />
          </ListCard>

          <ListCard
            title="Quick specs"
            footer={
              showDiscovery && asset.hardwareProfile ? (
                <CardLink label="View full hardware details" onPress={() => setTab('hardware')} />
              ) : null
            }
          >
            {specs.map((row, i) => (
              <InfoRow
                key={row.label}
                label={row.label}
                value={row.value}
                last={i === specs.length - 1}
              />
            ))}
          </ListCard>

          <View onLayout={anchorLayout('transfer')}>
            <TransferCard
              assetId={asset.id}
              assetName={asset.name}
              status={asset.status}
              officeId={asset.office?.id ?? null}
              holderId={holderId}
              openTransfer={asset.transfers?.[0] ?? null}
              onChanged={() => void load()}
            />
          </View>

          {/* End of life: the record once it exists, or the action for
              assets:dispose holders when the state machine allows it. */}
          <View onLayout={anchorLayout('disposal')}>
            <DisposalCard
              assetId={asset.id}
              assetName={asset.name}
              status={asset.status}
              disposal={asset.disposal ?? null}
              onChanged={() => void load()}
            />
          </View>

          {/* The imported sheet's remarks, one line, with the way to the rest. */}
          {summary ? (
            <Pressable
              onPress={() => setTab('notes')}
              accessibilityRole="button"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: radius.lg,
                backgroundColor: c.card,
                paddingHorizontal: spacing.lg,
                paddingVertical: 10,
              }}
            >
              <Ionicons name="document-text-outline" size={16} color={c.subtle} />
              <Text style={{ color: c.muted, fontSize: 13, flex: 1 }} numberOfLines={2}>
                {standing.expired ? (
                  <Text style={{ color: c.danger, fontWeight: '600' }}>Warranty out · </Text>
                ) : null}
                {summary}
              </Text>
              <Text style={{ color: c.brand, fontSize: 12, fontWeight: '600' }}>Open notes</Text>
            </Pressable>
          ) : null}
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

      {activeTab === 'notes' ? (
        <AssetNotes
          assetId={asset.id}
          notes={asset.notes}
          description={asset.description}
          version={asset.version}
          canEdit={mayEdit}
          onEditForm={() => router.push(`/asset/edit?id=${asset.id}`)}
          onSaved={() => void load()}
        />
      ) : null}

      {activeTab === 'attachments' ? (
        <>
          {/* v2.32 - condition evidence, before and after. */}
          <ConditionPhotoStrip
            assetId={asset.id}
            groups={photoGroups}
            onReload={reloadConditionPhotos}
            primaryPhotoId={primaryId}
            onPrimaryChanged={maySetPrimary ? () => void load() : undefined}
            canCapture={canCapture}
            holderName={holderName}
            onAdd={setPhotoStage}
          />
          <View style={{ height: spacing.sm }} />
          <Card>
            <CardTitle>Documents</CardTitle>
            <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>
              Documents are not yet stored against individual assets — the condition photos above
              are the evidence on file for this unit.
              {asset.vendorProduct
                ? ' Datasheets, manuals and certificates for this model live on its catalogue listing.'
                : ''}
            </Text>
            {openListing ? (
              <CardLink label="Open the catalogue listing" onPress={openListing} />
            ) : null}
          </Card>
        </>
      ) : null}

      {/* Price — assets:cost:read only (PriceCard checks again); recorded once, then locked. */}
      {activeTab === 'financials' && canSeeCost ? (
        <PriceCard
          assetId={asset.id}
          purchaseCost={asset.purchaseCost}
          currency={asset.currency}
          onRecorded={() => void load()}
        />
      ) : null}

      <MoreActionsSheet
        visible={actionsOpen}
        groups={actionGroups}
        assetName={asset.name}
        onClose={() => setActionsOpen(false)}
        onSelect={runAction}
      />

      {/* Mounted whatever the tab, so a handover finished from the custody
          card can still open the camera straight after. */}
      <HandoverSheet
        visible={handover !== null}
        mode={handover ?? 'assign'}
        assetId={asset.id}
        assetName={asset.name}
        holderName={holderName}
        holderId={holderId}
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

/**
 * A card whose body is a list of InfoRows: the title sits inside the card, as
 * on the web, with the rows flush to its edges beneath it.
 */
function ListCard({
  title,
  action,
  footer,
  children,
}: {
  title: string;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { spacing } = useTheme();
  return (
    <Card style={{ padding: 0, marginBottom: spacing.lg }}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 2 }}>
        <CardTitle action={action}>{title}</CardTitle>
      </View>
      {children}
      {footer ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>{footer}</View>
      ) : null}
    </Card>
  );
}

/**
 * A ListCard that opens on a tap, closed to begin with (v2.63; web: v2.62's
 * CollapsibleCard).
 *
 * The owner asked for Key information hidden by default: the header above
 * already carries the name, serial, brand, type and holder, so the full list
 * pushed the photographs and health down the screen to repeat most of it. It
 * is closed on every visit rather than remembered - "hidden by default" that
 * stays open after one tap reads as the setting not having worked. The one
 * line under the title keeps the identifiers in view while it is shut.
 */
function CollapsibleListCard({
  title,
  summary,
  children,
}: {
  title: string;
  summary?: string;
  children: ReactNode;
}) {
  const { c, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ padding: 0, marginBottom: spacing.lg }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}, ${open ? 'hide' : 'show'}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.md,
          paddingHorizontal: spacing.lg,
          // The whole header is the target, so it carries the card's padding
          // top and bottom while shut; open, the rows supply the bottom edge.
          paddingTop: spacing.lg,
          paddingBottom: open ? spacing.sm : spacing.lg,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>{title}</Text>
          {!open && summary ? (
            <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
              {summary}
            </Text>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600' }}>
            {open ? 'Hide' : 'Show'}
          </Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={c.muted} />
        </View>
      </Pressable>
      {open ? children : null}
    </Card>
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
                  <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>
                    {entry.title}
                  </Text>
                  <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }}>
                    {entry.date}
                    {entry.suffix}
                    {open
                      ? open.acknowledgedAt
                        ? ' · receipt confirmed'
                        : ' · awaiting receipt'
                      : ''}
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
