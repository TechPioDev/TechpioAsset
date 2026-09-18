'use client';

import { use, useEffect, useId, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Archive,
  ArrowLeft,
  ArrowRight,
  CalendarRange,
  Check,
  ChevronDown,
  Clock,
  Coins,
  Copy,
  Cpu,
  ExternalLink,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  type LucideIcon,
  Package,
  Paperclip,
  Pencil,
  Printer,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  StickyNote,
  TriangleAlert,
  Truck,
  UserCheck,
  Wallet,
} from 'lucide-react';
import {
  ASSET_STATUS_TOKENS,
  CONDITION_TOKENS,
  LIFECYCLE_STATE_TOKENS,
  AVAILABILITY_STATE_TOKENS,
  OWNERSHIP_TYPE_TOKENS,
  type StatusToken,
} from '@techpioasset/ui-tokens';
import {
  assetIdentifier,
  assetSpecRows,
  custodyHistory,
  custodyOptions,
  deviceLifecycle,
  hasDiscoveryTabs,
  HEALTH_GRADE_TONE,
  issuedByName,
  relativeAge,
  reportFreshness,
  warrantySource,
  PERMISSIONS,
  type AssetCondition,
  type AssetStatus,
  type LifecycleState,
  type AvailabilityState,
  type OwnershipType,
} from '@techpioasset/domain';
import { apiFetch, ApiError } from '@/lib/api-client';
import {
  assetDetailNav,
  conditionSentence,
  deviceHealthTiles,
  headerMeta,
  latestAgentReport,
  noteSummary,
  quickSpecs,
  resolveAssetImageSource,
  type AssetDetailNavKey,
  type HealthTile,
} from '@/lib/asset-overview';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { CustodyPanel } from '@/components/assets/custody-panel';
import { EquipmentKit } from '@/components/assets/equipment-kit';
import { ConditionPhotos } from '@/components/assets/condition-photos';
import {
  DisposalPanel,
  DISPOSABLE_FROM,
  type DisposalDto,
} from '@/components/assets/disposal-panel';
import {
  TransferPanel,
  DISPATCHABLE_FROM,
  type OpenTransferDto,
} from '@/components/assets/transfer-panel';
import { AssetHeaderThumb, AssetImageCard } from '@/components/assets/asset-image-card';
import { useAssetCover } from '@/lib/use-asset-cover';
import { AssetNotes } from '@/components/assets/asset-notes';
import { MoreActionsMenu, type MenuGroup } from '@/components/assets/more-actions-menu';
import {
  HardwareTab,
  HealthTab,
  OsTab,
  SoftwareTab,
  Tone,
  type HardwareProfileDto,
  type HealthDto,
  type OsInfoDto,
} from '@/components/assets/discovery-tabs';

interface AssetDetail {
  /** v2.47 - the catalogue listing this unit came from, when it came through procurement. */
  vendorProduct?: {
    id: string;
    name: string;
    brand: string | null;
    model: string | null;
    warrantyMonths: number | null;
    /** v2.61 - the listing's lead picture, which the image card shows first. */
    primaryImageId?: string | null;
  } | null;
  id: string;
  assetTag: string;
  name: string;
  description: string | null;
  qrToken: string | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  macAddress: string | null;
  imei: string | null;
  specs: Record<string, string> | null;
  status: AssetStatus;
  condition: AssetCondition;
  lifecycleState: LifecycleState | null;
  availabilityState: AvailabilityState | null;
  ownershipType: OwnershipType | null;
  purchaseDate: string | null;
  warrantyStartDate: string | null;
  warrantyEndDate: string | null;
  expectedReplacementDate: string | null;
  /** Total times this device has been assigned — how "assigned N times" is shown
   * without revealing who previous holders were. */
  assignmentCount?: number;
  purchaseCost?: string | null;
  currency?: string | null;
  version: number;
  category: { name: string } | null;
  subcategory: { key: string; name: string } | null;
  office: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  assignedUser: {
    id: string;
    email: string;
    profile: { firstName: string; lastName: string; employeeNumber: string | null } | null;
  } | null;
  assignmentDate: string | null;
  notes: string | null;
  /** v2.61 - the unit's own uploaded picture, if any. */
  photo: { id: string; mimeType: string; createdAt: string } | null;
  /** v2.65 - every photograph of the unit (up to five), the cover first. */
  photos?: { id: string; mimeType: string; sizeBytes: number | null; createdAt: string }[];
  assignments: {
    id: string;
    assignedAt: string;
    returnedAt: string | null;
    assignedBy: { profile: { firstName: string; lastName: string } | null } | null;
    user: { email: string; profile: { firstName: string; lastName: string } | null } | null;
    assetReturn: { conditionIn: AssetCondition; damageNotes: string | null } | null;
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
  // v2.5 H4 payload — null/zero until discovery has reported this machine.
  hardwareProfile: HardwareProfileDto | null;
  osInfo: OsInfoDto | null;
  disposal: DisposalDto | null;
  transfers: OpenTransferDto[];
  health: HealthDto | null;
  _count: { installedSoftware: number };
}

type AssetTab = AssetDetailNavKey;

/** One icon per side-nav entry; the order and labels come from lib/asset-overview. */
const NAV_ICONS: Record<AssetDetailNavKey, LucideIcon> = {
  overview: LayoutDashboard,
  lifecycle: CalendarRange,
  hardware: Cpu,
  os: ShieldCheck,
  software: Package,
  health: Activity,
  history: Clock,
  notes: StickyNote,
  attachments: Paperclip,
  financials: Wallet,
};

function fmtDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-content-subtle)]">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value ?? '—'}</dd>
    </div>
  );
}

/** Drop badges whose label an earlier badge already carries. */
function dedupeBadges(tokens: (StatusToken | null)[]): StatusToken[] {
  const seen = new Set<string>();
  return tokens.filter((t): t is StatusToken => {
    if (!t || seen.has(t.label)) return false;
    seen.add(t.label);
    return true;
  });
}

/** Copies a serial or MAC without selecting it by hand; the icon confirms. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error('Clipboard is blocked — select the value and copy it instead');
        }
      }}
      className="grid size-6 place-items-center rounded text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-content)]"
    >
      {copied ? (
        <Check aria-hidden="true" className="size-3.5 text-[var(--tone-success-fg)]" />
      ) : (
        <Copy aria-hidden="true" className="size-3.5" />
      )}
    </button>
  );
}

/** A label/value line in the Key Information list, optionally copyable. */
function InfoRow({
  label,
  value,
  copy,
}: {
  label: string;
  value: React.ReactNode;
  copy?: string | null;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-[var(--color-content-muted)]">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1 text-right text-sm font-medium">
        <span className="min-w-0 break-words">{value ?? '—'}</span>
        {copy ? <CopyButton value={copy} label={label} /> : null}
      </dd>
    </div>
  );
}

/**
 * A card that opens on a click, closed to begin with (v2.62).
 *
 * The owner asked for Key information hidden by default: the header above
 * already carries the name, serial, brand, type and holder, so the full list
 * pushed the photographs and health below the fold to repeat most of it. It is
 * closed on every visit rather than remembered - "hidden by default" that
 * stays open after one click reads as the setting not having worked. The one
 * line under the title keeps the identifiers in view while it is shut.
 */
function CollapsibleCard({
  title,
  summary,
  children,
}: {
  title: string;
  summary?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <Card className="p-5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold">{title}</span>
          {!open && summary ? (
            <span className="mt-0.5 block truncate text-xs text-[var(--color-content-subtle)]">
              {summary}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-[var(--color-content-muted)]">
          {open ? 'Hide' : 'Show'}
          <ChevronDown
            aria-hidden="true"
            className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>
      {open ? <div id={bodyId}>{children}</div> : null}
    </Card>
  );
}

function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-[15px] font-semibold">{children}</h2>
      {action}
    </div>
  );
}

/** The five doors into /requests/new, each pre-filled with this device. */
function ticketItems(assetTag: string, assetName: string): { label: string; href: string }[] {
  const about = encodeURIComponent(`${assetTag} ${assetName}`);
  return [
    { href: `/requests/new?report=issue&about=${about}`, label: 'Report a problem' },
    { href: `/requests/new?issue=SOFTWARE&about=${about}`, label: 'System / software update' },
    {
      href: `/requests/new?type=ADDITIONAL_EQUIPMENT&about=${about}`,
      label: 'Accessories (mouse, headphones…)',
    },
    { href: `/requests/new?type=REPLACEMENT&about=${about}`, label: 'Request replacement' },
    { href: `/requests/new?type=UPGRADE&about=${about}`, label: 'Request upgrade' },
  ];
}

export default function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can, user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const canSeeCost = can(PERMISSIONS.ASSETS_COST_READ);
  const canUpdate = can(PERMISSIONS.ASSETS_UPDATE);
  const [tab, setTab] = useState<AssetTab>('overview');
  const [price, setPrice] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['asset', id],
    queryFn: () => apiFetch<AssetDetail>(`/assets/${id}`),
  });
  // One download of the cover picture, for the header thumbnail and the lead box.
  const cover = useAssetCover(id, data);

  const recordPrice = useMutation({
    mutationFn: (purchaseCost: string) =>
      apiFetch(`/assets/${id}/price`, { method: 'PATCH', body: { purchaseCost } }),
    onSuccess: () => {
      setPriceError(null);
      void queryClient.invalidateQueries({ queryKey: ['asset', id] });
      toast.success('Price recorded and locked');
    },
    onError: (caught) => {
      const message =
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title)
          : 'Could not record the price.';
      setPriceError(message);
      toast.error(message);
    },
  });

  /**
   * One-click "Report damage" - the phone's button, same call. It goes through
   * the status endpoint, which applies the transition rules and custody check
   * the edit form's status change does, and lets a holder without
   * assets:update report only DAMAGED on a device they hold.
   */
  const reportDamage = useMutation({
    mutationFn: () =>
      apiFetch(`/assets/${id}/status`, {
        method: 'POST',
        body: { status: 'DAMAGED', reason: 'Reported damaged from web' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['asset', id] });
      void queryClient.invalidateQueries({ queryKey: ['my-assets'] });
      toast.success('Reported. IT has been notified this asset is damaged.');
    },
    onError: (caught) => {
      toast.error(
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title)
          : 'Could not report. You may not have permission to change this asset.',
      );
    },
  });

  // Moving from a laptop to a headset with "Hardware" open would leave the page
  // on a tab that no longer exists, showing nothing at all. This sits above the
  // loading and error returns: a hook after an early return runs on some
  // renders and not others, which React rejects outright.
  // The rule itself is shared with the phone (domain asset-detail.ts).
  const discoveryAvailable = !data || hasDiscoveryTabs(data);

  useEffect(() => {
    if (
      !discoveryAvailable &&
      (tab === 'hardware' || tab === 'os' || tab === 'software' || tab === 'health')
    ) {
      setTab('overview');
    }
  }, [discoveryAvailable, tab]);

  if (isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-28" />
        <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <Skeleton className="h-10 lg:h-80" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }
  if (isError) {
    return <ErrorState title="Could not load the asset" detail={(error as Error).message} />;
  }

  const holder = data.assignedUser;
  const holderName = holder?.profile
    ? `${holder.profile.firstName} ${holder.profile.lastName}`
    : (holder?.email ?? null);
  const isHolder = Boolean(user && holder?.id === user.id);

  /**
   * The agent-reported sections belong to things that boot; see
   * hasDiscoveryTabs in the domain package for why an empty headset hides them.
   */
  const showDiscovery = discoveryAvailable;
  const nav = assetDetailNav({
    showDiscovery,
    softwareCount: data._count.installedSoftware,
    canSeeCost,
  });

  // The crumb must lead somewhere the viewer may actually go: an OWN-scope
  // holder cannot open /assets, so it would bounce them to the dashboard.
  const backToList = can(PERMISSIONS.ASSETS_READ) && user?.scope !== 'OWN';
  const back = backToList
    ? { href: '/assets', label: 'Assets' }
    : { href: '/my-assets', label: 'My assets' };

  const identifier = assetIdentifier(data);
  const meta = headerMeta({
    brand: data.brand,
    model: data.model,
    typeName: data.subcategory?.name,
    holderName,
  });
  const lastReport = latestAgentReport(data.hardwareProfile, data.osInfo);
  const freshness = lastReport ? reportFreshness(lastReport.at) : null;

  /** Switch to the overview and bring one of its panels into view. */
  const jumpTo = (anchor: string) => {
    setTab('overview');
    requestAnimationFrame(() =>
      document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };

  // Which "manage" doors exist, mirroring the panels' own gates so the menu
  // never points at a panel that is not there.
  const holderId = holder?.id ?? null;
  const custody = custodyOptions({
    canAssign: can(PERMISSIONS.ASSETS_ASSIGN),
    canReturn: can(PERMISSIONS.ASSETS_RETURN),
    status: data.status,
    isHeld: Boolean(holderId),
  });
  const canOfferTransfer =
    can(PERMISSIONS.ASSETS_TRANSFER) &&
    ((data.status === 'IN_TRANSIT' && Boolean(data.transfers[0])) ||
      (!holderId && DISPATCHABLE_FROM.includes(data.status)));
  const canOfferDisposal =
    !data.disposal && can(PERMISSIONS.ASSETS_DISPOSE) && DISPOSABLE_FROM.includes(data.status);

  const menuGroups: MenuGroup[] = [
    {
      items: [
        // Printable handover receipt - the print CSS strips the app chrome, so
        // the browser's Save as PDF is the PDF engine. Offered whenever a
        // holder exists; an employee can only ever reach their own device.
        ...(data.assignedUser
          ? [{ label: 'Handover receipt', icon: Printer, href: `/assets/${id}/receipt` }]
          : []),
        ...(canUpdate ? [{ label: 'Edit asset', icon: Pencil, href: `/assets/${id}/edit` }] : []),
        ...(data.qrToken
          ? [{ label: 'QR label', icon: QrCode, onClick: () => setTab('lifecycle') }]
          : []),
      ],
    },
    {
      title: 'Manage',
      items: [
        ...(custody.show
          ? [
              {
                label: custody.recordReturn ? 'Hand over / record return' : 'Assign to someone',
                icon: UserCheck,
                onClick: () => jumpTo('asset-custody'),
              },
            ]
          : []),
        ...(canOfferTransfer
          ? [
              {
                label: data.status === 'IN_TRANSIT' ? 'Confirm arrival' : 'Office transfer',
                icon: Truck,
                onClick: () => jumpTo('asset-transfer'),
              },
            ]
          : []),
        ...(canOfferDisposal
          ? [{ label: 'Record disposal', icon: Archive, onClick: () => jumpTo('asset-disposal') }]
          : []),
        ...(canSeeCost
          ? [
              {
                label: data.purchaseCost != null ? 'Price & financials' : 'Record price',
                icon: Coins,
                onClick: () => setTab('financials'),
              },
            ]
          : []),
      ],
    },
    // Everything a holder needs to ask for: the issue catalogue for problems,
    // request types for equipment. Each lands on /requests/new pre-filled
    // with this device, so nobody types an asset tag by hand.
    ...(isHolder
      ? [
          {
            title: 'Create ticket',
            items: ticketItems(data.assetTag, data.name).map((t) => ({ ...t, icon: LifeBuoy })),
          },
        ]
      : []),
  ];

  const warrantyEnd = data.warrantyEndDate ? new Date(data.warrantyEndDate) : null;
  const warrantyExpired = Boolean(warrantyEnd && warrantyEnd <= new Date());
  const summary = noteSummary(data.notes);

  return (
    <div className="grid gap-4">
      {/* Top bar: the way back, and the two actions that are always in view. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={back.href}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to {back.label}
        </Link>
        <div className="flex items-center gap-2">
          <MoreActionsMenu groups={menuGroups} />
          {/* Offered to whoever the API lets report it - a fleet manager, or
              the person holding the device - and not once it already is. */}
          {data.status !== 'DAMAGED' && (canUpdate || isHolder) ? (
            <Button
              variant="danger"
              size="sm"
              className="h-9"
              loading={reportDamage.isPending}
              onClick={() => reportDamage.mutate()}
            >
              <TriangleAlert aria-hidden="true" className="size-4" />
              Report damage
            </Button>
          ) : null}
        </div>
      </div>

      {/* Header: who this device is, in one glance. */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start gap-4">
          <AssetHeaderThumb
            assetName={data.name}
            typeKey={data.subcategory?.key}
            coverUrl={cover.coverFailed ? null : cover.coverUrl}
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">
              {data.name}
              {identifier ? (
                <span className="font-normal text-[var(--color-content-muted)]">
                  {' '}
                  · {identifier.label}{' '}
                  <span className="font-mono text-base">{identifier.value}</span>
                </span>
              ) : null}
            </h1>
            <p className="mt-1 text-sm text-[var(--color-content-muted)]">
              {meta.map((part, i) => (
                <span key={part}>
                  {i > 0 ? (
                    <span className="mx-1.5 text-[var(--color-content-subtle)]">|</span>
                  ) : null}
                  {part}
                </span>
              ))}
              <span className="mx-1.5 text-[var(--color-content-subtle)]">|</span>
              <span className="font-mono text-xs">{data.assetTag}</span>
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {/* Status, lifecycle and availability are three dimensions that
                  often agree - ASSIGNED derives availability "Assigned", so
                  printing all three verbatim reads "Assigned · Deployed ·
                  Assigned". Same dedupe the mobile app applies. */}
              {dedupeBadges([
                ASSET_STATUS_TOKENS[data.status],
                data.lifecycleState ? LIFECYCLE_STATE_TOKENS[data.lifecycleState] : null,
                data.availabilityState ? AVAILABILITY_STATE_TOKENS[data.availabilityState] : null,
              ]).map((token) => (
                <StatusBadge key={token.label} token={token} size="sm" />
              ))}
              <StatusBadge
                token={CONDITION_TOKENS[data.condition]}
                size="sm"
                label={`Condition: ${CONDITION_TOKENS[data.condition].label}`}
              />
              {data.ownershipType ? (
                <StatusBadge
                  token={OWNERSHIP_TYPE_TOKENS[data.ownershipType]}
                  size="sm"
                  showIcon={false}
                />
              ) : null}
              {/* Agent freshness, never "online": the agent reports on a
                  schedule, so the honest claim is how recently it did. */}
              {lastReport && freshness ? (
                <Tone
                  tone={
                    freshness === 'fresh'
                      ? 'success'
                      : freshness === 'ageing'
                        ? 'warning'
                        : 'critical'
                  }
                >
                  {freshness === 'fresh'
                    ? 'Agent reporting'
                    : freshness === 'ageing'
                      ? `Agent last seen ${relativeAge(lastReport.at)}`
                      : `Agent not reporting · ${relativeAge(lastReport.at)}`}
                </Tone>
              ) : null}
            </div>
          </div>
          {lastReport ? (
            <div className="shrink-0 sm:text-right">
              <p className="text-xs text-[var(--color-content-subtle)]">Last sync</p>
              <p className="mt-0.5 text-sm font-medium tabular-nums">
                {new Date(lastReport.at).toLocaleString()}
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-content-subtle)]">
                Updated {relativeAge(lastReport.at)} · {lastReport.source.toLowerCase()}
              </p>
            </div>
          ) : null}
        </div>
      </Card>

      {/* Body: the side nav and whichever section is open. On a phone the nav
          becomes a strip that scrolls sideways. */}
      <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav
          aria-label="Asset detail sections"
          className="min-w-0 lg:sticky lg:top-4 lg:self-start"
        >
          <div
            role="tablist"
            className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
          >
            {nav.map(({ key, label, badge }) => {
              const Icon = NAV_ICONS[key];
              const active = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(key)}
                  className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-[var(--radius-control)] px-3 py-2 text-sm ${
                    active
                      ? 'bg-[var(--color-surface-raised)] font-semibold text-[var(--color-brand)] shadow-sm ring-1 ring-[var(--color-border)]'
                      : 'font-medium text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-content)]'
                  }`}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {label}
                  {badge ? (
                    <span className="ml-auto rounded-full bg-[var(--color-surface-sunken)] px-1.5 py-0.5 text-[0.7rem] font-semibold tabular-nums text-[var(--color-content-muted)]">
                      {badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="min-w-0">
          {tab === 'overview' ? (
            <OverviewTab
              id={id}
              data={data}
              holderName={holderName}
              showDiscovery={showDiscovery}
              canUpdate={canUpdate}
              lastReport={lastReport}
              warrantyExpired={warrantyExpired}
              summary={summary}
              cover={cover}
              setTab={setTab}
            />
          ) : null}

          {tab === 'lifecycle' ? <LifecycleTab data={data} /> : null}

          {tab === 'hardware' ? <HardwareTab hw={data.hardwareProfile} /> : null}
          {tab === 'os' ? <OsTab os={data.osInfo} /> : null}
          {tab === 'software' ? <SoftwareTab assetId={id} /> : null}
          {tab === 'health' ? (
            <HealthTab assetId={id} health={data.health} canRecompute={canUpdate} />
          ) : null}

          {tab === 'history' ? (
            <Card className="p-5">
              <h2 className="text-[15px] font-semibold">Custody &amp; condition history</h2>
              {data.assignments.length === 0 && data.conditionLogs.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--color-content-muted)]">No history yet.</p>
              ) : (
                <ol className="mt-3 space-y-3">
                  {custodyHistory(data, fmtDate).map((entry) => (
                    <li key={entry.key} className="flex gap-3 text-sm">
                      <span
                        className={`mt-1 size-2 shrink-0 rounded-full ${
                          entry.kind === 'assignment'
                            ? 'bg-[var(--color-brand)]'
                            : 'bg-[var(--color-content-subtle)]'
                        }`}
                      />
                      <span>
                        <span className="font-medium">{entry.title}</span>
                        <span className="text-[var(--color-content-subtle)]">
                          {' '}
                          · {entry.date}
                          {entry.suffix}
                        </span>
                        {entry.note ? (
                          <span
                            className={`block text-xs ${
                              entry.noteTone === 'warning'
                                ? 'text-[var(--tone-warning-fg)]'
                                : 'text-[var(--color-content-subtle)]'
                            }`}
                          >
                            {entry.note}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          ) : null}

          {tab === 'notes' ? (
            <AssetNotes
              assetId={id}
              notes={data.notes}
              description={data.description}
              version={data.version}
              canEdit={canUpdate}
            />
          ) : null}

          {tab === 'attachments' ? (
            <div className="grid gap-4">
              {/* v2.32 - condition evidence, before and after. */}
              <ConditionPhotos
                assetId={id}
                holderName={holderName}
                primaryPhotoId={data.photo?.id ?? null}
              />
              <Card className="p-5">
                <h2 className="text-[15px] font-semibold">Documents</h2>
                <p className="mt-2 text-sm text-[var(--color-content-muted)]">
                  Documents are not yet stored against individual assets — the condition photos
                  above are the evidence on file for this unit.
                  {data.vendorProduct ? (
                    <>
                      {' '}
                      Datasheets, manuals and certificates for this model live on its{' '}
                      <Link
                        href={`/catalogue/${data.vendorProduct.id}`}
                        className="text-[var(--color-brand)] hover:underline"
                      >
                        catalogue listing
                      </Link>
                      .
                    </>
                  ) : null}
                </p>
              </Card>
            </div>
          ) : null}

          {/* Price — visible to Finance / Super Admin only; recorded once, then locked. */}
          {tab === 'financials' && canSeeCost ? (
            <Card className="p-5">
              <h2 className="text-[15px] font-semibold">Price</h2>
              {data.purchaseCost != null ? (
                <div className="mt-2 flex items-center gap-2.5">
                  <p className="text-2xl font-bold tracking-tight tabular-nums">
                    {Number(data.purchaseCost).toLocaleString()}
                    {data.currency ? (
                      <span className="ml-1.5 text-sm font-medium text-[var(--color-content-subtle)]">
                        {data.currency}
                      </span>
                    ) : null}
                  </p>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-sunken)] px-2.5 py-1 text-xs font-medium text-[var(--color-content-muted)]">
                    <Lock aria-hidden="true" className="size-3" /> Locked
                  </span>
                </div>
              ) : (
                <form
                  className="mt-3 flex flex-wrap items-start gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (/^\d+(\.\d{1,2})?$/.test(price)) recordPrice.mutate(price);
                    else setPriceError('Enter a plain amount, e.g. 45000 or 45000.50');
                  }}
                >
                  <div className="grid gap-1">
                    <Input
                      inputMode="decimal"
                      placeholder="45000.00"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      aria-label="Purchase price"
                      className="w-44"
                    />
                    {priceError ? (
                      <p role="alert" className="text-xs text-[var(--tone-critical-fg)]">
                        {priceError}
                      </p>
                    ) : null}
                  </div>
                  <Button type="submit" loading={recordPrice.isPending}>
                    Record price
                  </Button>
                  <p className="basis-full text-xs text-[var(--color-content-subtle)]">
                    Recorded once — it locks after saving and cannot be edited.
                  </p>
                </form>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The overview (v2.61): the picture, the key facts and the health strip on the
 * left; condition, warranty and quick specs on the right, with the custody,
 * transfer and disposal panels beside them because those are the actions a
 * technician came here for. Every panel keeps its own gate and renders nothing
 * when it does not apply; `empty:hidden` keeps an empty anchor from costing a
 * grid gap.
 */
function OverviewTab({
  id,
  data,
  holderName,
  showDiscovery,
  canUpdate,
  lastReport,
  warrantyExpired,
  summary,
  cover,
  setTab,
}: {
  id: string;
  data: AssetDetail;
  holderName: string | null;
  showDiscovery: boolean;
  canUpdate: boolean;
  lastReport: { at: string; source: string } | null;
  warrantyExpired: boolean;
  summary: string | null;
  cover: ReturnType<typeof useAssetCover>;
  setTab: (tab: AssetTab) => void;
}) {
  const holder = data.assignedUser;
  const imageSource = resolveAssetImageSource(data);
  const tiles = deviceHealthTiles(data.hardwareProfile, data.osInfo);
  // v2.20 - render the stored specification in the type's own field order, so
  // two monitors always read the same way round, labelled from the catalogue.
  const spec = assetSpecRows(data.subcategory?.key, data.specs);
  const specs = quickSpecs({
    hw: data.hardwareProfile,
    os: data.osInfo,
    specs: data.specs,
    assetTag: data.assetTag,
  });
  // The story itself lives in the domain package, so the phone tells the same one.
  const { events } = deviceLifecycle(data, fmtDate);
  const issuedBy = issuedByName(data.assignments);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="grid min-w-0 gap-4">
          <AssetImageCard
            assetId={id}
            assetName={data.name}
            typeKey={data.subcategory?.key}
            brand={data.brand}
            source={imageSource}
            ownPhotos={data.photos ?? (data.photo ? [data.photo] : [])}
            primaryPhotoId={data.photo?.id ?? null}
            slides={cover.slides}
            coverUrl={cover.coverUrl}
            coverFailed={cover.coverFailed}
            canManage={canUpdate}
          />

          <CollapsibleCard
            title="Key information"
            summary={[data.serialNumber, data.assetTag, data.office?.name]
              .filter(Boolean)
              .join(' · ')}
          >
            <dl className="mt-3 divide-y divide-[var(--color-border)]">
              <InfoRow
                label="Serial number"
                value={
                  data.serialNumber ? <span className="font-mono">{data.serialNumber}</span> : null
                }
                copy={data.serialNumber}
              />
              <InfoRow
                label="Asset tag"
                value={<span className="font-mono">{data.assetTag}</span>}
                copy={data.assetTag}
              />
              <InfoRow label="Category" value={data.category?.name} />
              <InfoRow label="Type" value={data.subcategory?.name} />
              <InfoRow label="Brand" value={data.brand} />
              <InfoRow label="Model" value={data.model} />
              {/* v2.20 - shown only when the asset carries one, so a monitor's
                  list is not padded with blank network rows. */}
              {data.macAddress ? (
                <InfoRow
                  label="MAC address"
                  value={<span className="font-mono text-xs">{data.macAddress}</span>}
                  copy={data.macAddress}
                />
              ) : null}
              {data.imei ? (
                <InfoRow
                  label="IMEI"
                  value={<span className="font-mono text-xs">{data.imei}</span>}
                  copy={data.imei}
                />
              ) : null}
              <InfoRow label="Office" value={data.office?.name} />
              <InfoRow
                label="Assigned to"
                value={
                  holderName ? (
                    <>
                      {holderName}
                      {holder?.profile?.employeeNumber ? (
                        <span className="text-xs text-[var(--color-content-subtle)]">
                          {' '}
                          · {holder.profile.employeeNumber}
                        </span>
                      ) : null}
                      {issuedBy ? (
                        <span className="block text-xs font-normal text-[var(--color-content-subtle)]">
                          issued by {issuedBy}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    'Unassigned'
                  )
                }
              />
              {data.department ? (
                <InfoRow label="Team / department" value={data.department.name} />
              ) : null}
              {/* v2.47 - what this unit actually is, according to the supplier
                  who sold it. Only present for units that came through
                  procurement after the link existed. */}
              {data.vendorProduct ? (
                <InfoRow
                  label="Supplied as"
                  value={
                    <Link
                      href={`/catalogue/${data.vendorProduct.id}`}
                      className="text-[var(--color-brand)] hover:underline"
                    >
                      {data.vendorProduct.name}
                    </Link>
                  }
                />
              ) : null}
            </dl>
          </CollapsibleCard>

          {tiles.length > 0 || data.health ? (
            <Card className="p-5">
              <SectionTitle
                action={
                  lastReport ? (
                    <span className="text-xs text-[var(--color-content-subtle)]">
                      Reported {relativeAge(lastReport.at)}
                    </span>
                  ) : null
                }
              >
                Device health
              </SectionTitle>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                {data.health ? (
                  <HealthTileCard
                    tile={{
                      key: 'smart',
                      label: 'Health score',
                      value: `${data.health.overall} / 100`,
                      hint: data.health.grade.toLowerCase(),
                      tone: HEALTH_GRADE_TONE[data.health.grade] as HealthTile['tone'],
                      percent: data.health.overall,
                    }}
                  />
                ) : null}
                {tiles.map((tile) => (
                  <HealthTileCard key={tile.key} tile={tile} />
                ))}
              </div>
              {showDiscovery ? (
                <button
                  type="button"
                  onClick={() => setTab('health')}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand)] hover:underline"
                >
                  View health details <ArrowRight aria-hidden="true" className="size-3" />
                </button>
              ) : null}
            </Card>
          ) : null}

          {/* v2.20 - whatever the type declared, labelled from the same
              catalogue the form used. Nothing recorded, nothing shown. */}
          {spec.rows.length > 0 ? (
            <Card className="p-5">
              <SectionTitle>{spec.title} specification</SectionTitle>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                {spec.rows.map(([label, value]) => (
                  <Row key={label} label={label} value={value} />
                ))}
              </dl>
            </Card>
          ) : null}

          {/* v2.32 - condition evidence, before and after. Shown whether or not
              the asset is currently out: the comparison that matters most is
              usually a past handover. */}
          <ConditionPhotos
            assetId={id}
            holderName={holderName}
            primaryPhotoId={data.photo?.id ?? null}
          />

          <Card className="p-5">
            <SectionTitle
              action={
                <button
                  type="button"
                  onClick={() => setTab('lifecycle')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand)] hover:underline"
                >
                  Full lifecycle <ArrowRight aria-hidden="true" className="size-3" />
                </button>
              }
            >
              Lifecycle &amp; service
            </SectionTitle>
            {events.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-content-muted)]">
                Nothing recorded for this device yet.
              </p>
            ) : (
              <ol className="relative mt-4 ml-1.5 grid gap-4 border-l border-[var(--color-border)] pl-5">
                {events.map((e, i) => (
                  <li key={i} className="relative">
                    <span
                      aria-hidden="true"
                      className="absolute -left-[1.55rem] top-1 size-2.5 rounded-full ring-4 ring-[var(--color-surface-raised)]"
                      style={{ background: `var(--tone-${e.tone}-fg)` }}
                    />
                    <p className="text-sm font-medium">
                      {e.title}
                      {e.detail ? (
                        <span className="font-normal text-[var(--color-content-muted)]">
                          {' '}
                          — {e.detail}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-[var(--color-content-subtle)]">
                      {e.date ? fmtDate(e.date.toISOString()) : '—'}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {/* v2.21 - what else this person was given. Only with a holder:
              with nobody holding it there is no kit to speak of. */}
          {holder ? (
            <EquipmentKit
              holderId={holder.id}
              holderName={holderName}
              excludeAssetId={id}
              emptyMessage={`${holderName ?? 'This person'} holds no other equipment.`}
            />
          ) : null}
        </div>

        <div className="grid min-w-0 gap-4 self-start">
          <div id="asset-custody" className="empty:hidden">
            <CustodyPanel
              assetId={id}
              status={data.status}
              holderName={holderName}
              holderId={holder?.id ?? null}
            />
          </div>

          <Card className="p-5">
            <SectionTitle>Condition</SectionTitle>
            <div className="mt-3 flex items-center gap-3">
              <StatusBadge token={CONDITION_TOKENS[data.condition]} />
              <p className="text-sm text-[var(--color-content-muted)]">
                {conditionSentence(data.condition)}
              </p>
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle
              action={
                data.warrantyEndDate ? (
                  <Tone tone={warrantyExpired ? 'critical' : 'success'}>
                    {warrantyExpired ? 'Warranty out' : 'Under warranty'}
                  </Tone>
                ) : (
                  <Tone tone="muted">Not recorded</Tone>
                )
              }
            >
              Warranty &amp; purchase
            </SectionTitle>
            <dl className="mt-1 divide-y divide-[var(--color-border)]">
              <InfoRow label="Purchased on" value={fmtDate(data.purchaseDate)} />
              {data.vendorProduct?.warrantyMonths ? (
                <InfoRow label="Cover" value={`${data.vendorProduct.warrantyMonths} months`} />
              ) : null}
              {data.expectedReplacementDate ? (
                <InfoRow
                  label="Expected replacement"
                  value={fmtDate(data.expectedReplacementDate)}
                />
              ) : null}
            </dl>
            <div className="mt-3 border-t border-[var(--color-border)] pt-3">
              <p className="text-xs text-[var(--color-content-subtle)]">Warranty ends</p>
              <div className="mt-1 text-sm font-medium">
                <WarrantyCheck
                  assetId={id}
                  ends={data.warrantyEndDate}
                  serial={data.serialNumber}
                  identity={[data.hardwareProfile?.manufacturer, data.brand, data.model, data.name]}
                  canUpdate={canUpdate}
                />
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle>Quick specs</SectionTitle>
            <dl className="mt-1 divide-y divide-[var(--color-border)]">
              {specs.map((row) => (
                <InfoRow key={row.label} label={row.label} value={row.value} />
              ))}
            </dl>
            {showDiscovery && data.hardwareProfile ? (
              <button
                type="button"
                onClick={() => setTab('hardware')}
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand)] hover:underline"
              >
                View full hardware details <ArrowRight aria-hidden="true" className="size-3" />
              </button>
            ) : null}
          </Card>

          <div id="asset-transfer" className="empty:hidden">
            <TransferPanel
              assetId={id}
              status={data.status}
              officeId={data.office?.id ?? null}
              holderId={holder?.id ?? null}
              openTransfer={data.transfers[0] ?? null}
            />
          </div>
          <div id="asset-disposal" className="empty:hidden">
            <DisposalPanel
              assetId={id}
              assetName={data.name}
              status={data.status}
              disposal={data.disposal}
            />
          </div>
        </div>
      </div>

      {/* The imported sheet's remarks, one line, with the way to the rest. */}
      {summary ? (
        <p className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-4 py-2.5 text-sm text-[var(--color-content-muted)]">
          <StickyNote
            aria-hidden="true"
            className="size-4 shrink-0 text-[var(--color-content-subtle)]"
          />
          <span className="min-w-0">
            {warrantyExpired ? (
              <span className="font-medium text-[var(--tone-critical-fg)]">Warranty out · </span>
            ) : null}
            {summary}
          </span>
          <button
            type="button"
            onClick={() => setTab('notes')}
            className="ml-auto text-xs font-medium text-[var(--color-brand)] hover:underline"
          >
            Open notes
          </button>
        </p>
      ) : null}
    </div>
  );
}

/** One tile in the Device health strip: label, value, an optional fill bar and hint. */
function HealthTileCard({ tile }: { tile: HealthTile }) {
  const color = tile.tone ? `var(--tone-${tile.tone}-fg)` : undefined;
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] p-3">
      <p className="text-xs text-[var(--color-content-subtle)]">{tile.label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums" style={color ? { color } : undefined}>
        {tile.value}
      </p>
      {tile.percent != null ? (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
          role="img"
          aria-label={`${tile.label}: ${tile.percent}%`}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${tile.percent}%`, backgroundColor: color ?? 'var(--color-brand)' }}
          />
        </div>
      ) : null}
      {tile.hint ? (
        <p className="mt-1 text-xs text-[var(--color-content-subtle)]">{tile.hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Device lifecycle (v2.12) — the story of one device, for the person holding it.
 * See deviceLifecycle in the domain package for what it is built from, and why
 * it never names a previous holder.
 */
function LifecycleTab({ data }: { data: AssetDetail }) {
  // The story itself - chips, events, their order and wording - is built in
  // the domain package, so the phone's Lifecycle tab tells the same one.
  const { chips, events, timesAssigned } = deviceLifecycle(data, fmtDate);

  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">Device lifecycle</h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
          {chips.map((c) => (
            <Row key={c.label} label={c.label} value={c.value} />
          ))}
        </dl>
        <p className="mt-4 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-content-subtle)]">
          This device has been assigned {timesAssigned} time
          {timesAssigned === 1 ? '' : 's'}. Previous holders are not shown.
        </p>
      </Card>

      <AssetQrCard assetTag={data.assetTag} qrToken={data.qrToken} />

      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">Timeline</h2>
        {events.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-content-muted)]">
            Nothing recorded for this device yet.
          </p>
        ) : (
          <ol className="mt-4 grid gap-4">
            {events.map((e, i) => (
              <li key={i} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-1 size-2.5 shrink-0 rounded-full"
                  style={{ background: `var(--tone-${e.tone}-fg)` }}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {e.title}
                    {e.detail ? (
                      <span className="font-normal text-[var(--color-content-muted)]">
                        {' '}
                        — {e.detail}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-[var(--color-content-subtle)]">
                    {e.date ? fmtDate(e.date.toISOString()) : '—'}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

/**
 * The asset's QR label (v2.12). Drawn locally from the token the API already
 * returns — the same reasoning as the MFA QR: the value never goes to an
 * external chart service. Scanning it opens this device's page.
 */
function AssetQrCard({ assetTag, qrToken }: { assetTag: string; qrToken: string | null }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!qrToken) {
      setDataUrl(null);
      return;
    }
    const url = `${window.location.origin}/assets/scan/${qrToken}`;
    QRCode.toDataURL(url, { margin: 1, width: 176 })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [qrToken]);

  if (!qrToken) return null;

  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-semibold">QR label</h2>
      <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
        Scanning this opens the device&apos;s page. Print it and stick it on the asset.
      </p>
      {dataUrl ? (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL */}
          <img
            src={dataUrl}
            alt={`QR code for ${assetTag}`}
            width={176}
            height={176}
            className="rounded-lg border border-[var(--color-border)] bg-white p-2"
          />
          <div className="grid gap-2">
            <span className="font-mono text-sm">{assetTag}</span>
            <a
              href={dataUrl}
              download={`${assetTag}-qr.png`}
              className="inline-flex h-9 w-fit items-center rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
            >
              Download label
            </a>
          </div>
        </div>
      ) : (
        <Skeleton className="mt-3 h-44 w-44" />
      )}
    </Card>
  );
}

/**
 * The warranty checker (v2.15). Detects the manufacturer from what the asset
 * already knows - the agent-reported hardware manufacturer first, the register
 * fields second - and links the technician to that maker's OFFICIAL warranty
 * source. Dell and Lenovo resolve the device straight from the URL; for the
 * form-based vendors the serial rides the clipboard.
 */
function WarrantyCheck({
  assetId,
  ends,
  serial,
  identity,
  canUpdate,
}: {
  assetId: string;
  ends: string | null;
  serial: string | null;
  identity: (string | null | undefined)[];
  canUpdate: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(ends ? ends.slice(0, 10) : '');
  const [pasted, setPasted] = useState('');
  const [aiNote, setAiNote] = useState<string | null>(null);
  const source = warrantySource(serial, ...identity);

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/assets/${assetId}`, {
        method: 'PATCH',
        body: { warrantyEndDate: date || null },
      }),
    onSuccess: async () => {
      toast.success('Warranty date recorded');
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ['asset', assetId] });
    },
    onError: () => toast.error('Could not save the warranty date'),
  });

  // Lenovo answers serial lookups directly - one click, no copying anything.
  const vendorRefresh = useMutation({
    mutationFn: () =>
      apiFetch<{
        warrantyEndDate: string | null;
        warrantyName: string | null;
        status: string | null;
        applied: boolean;
      }>(`/assets/${assetId}/warranty-refresh`, { method: 'POST', body: {} }),
    onSuccess: async (r) => {
      if (!r.warrantyEndDate) {
        toast.error('Lenovo returned no coverage end date for this serial');
        return;
      }
      toast.success(
        `Lenovo: ${r.warrantyName ?? 'warranty'} ends ${fmtDate(r.warrantyEndDate)}${
          r.status ? ` — ${r.status}` : ''
        }`,
      );
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ['asset', assetId] });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Lookup failed'),
  });

  // Whether AI paste-and-extract is switched on for this user; asked only once
  // the editor opens, so the read view costs nothing.
  const aiGate = useQuery({
    queryKey: ['ai-gate', 'WARRANTY_EXTRACTION'],
    queryFn: () =>
      apiFetch<{ enabled: boolean; simulated: boolean }>('/ai-config/gate/WARRANTY_EXTRACTION'),
    enabled: editing && canUpdate,
    staleTime: 60_000,
  });

  const extract = useMutation({
    mutationFn: (text: string) =>
      apiFetch<{
        warrantyEndDate: string | null;
        warrantyType: string | null;
        serialSeen: boolean;
        simulated: boolean;
      }>(`/assets/${assetId}/warranty-extract`, { method: 'POST', body: { text } }),
    onSuccess: (r) => {
      if (!r.warrantyEndDate) {
        setAiNote(null);
        toast.error('No warranty end date found in the pasted text');
        return;
      }
      setDate(r.warrantyEndDate);
      setAiNote(
        [
          `Found ${fmtDate(r.warrantyEndDate)}`,
          r.warrantyType ? `— ${r.warrantyType}` : null,
          r.simulated ? '(simulated — add a real AI key under Platform → AI provider)' : null,
          !r.serialSeen && serial
            ? '· the pasted text does not mention this serial — check it is the right device'
            : null,
        ]
          .filter(Boolean)
          .join(' '),
      );
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Extraction failed',
      ),
  });

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {editing ? (
        <span className="inline-flex items-center gap-1.5">
          <input
            type="date"
            aria-label="Warranty end date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-7 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-1.5 text-xs"
          />
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="text-xs font-semibold text-[var(--color-brand)]"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs text-[var(--color-content-subtle)]"
          >
            Cancel
          </button>
        </span>
      ) : (
        <span>{fmtDate(ends)}</span>
      )}
      {editing && aiGate.data?.enabled ? (
        <span className="mt-1 grid w-full basis-full gap-1.5">
          <textarea
            rows={3}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            onPaste={(e) => {
              // Pasting IS the intent - run the extraction immediately rather
              // than making the paste and the button two separate ideas.
              const text = e.clipboardData.getData('text/plain');
              if (text.trim().length >= 20 && !extract.isPending) {
                setPasted(text);
                extract.mutate(text);
              }
            }}
            placeholder={`Copy the ${source?.label ?? 'vendor'} warranty page (Ctrl+A, Ctrl+C), come back and click the button`}
            className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 py-1.5 text-xs"
          />
          <span className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                if (pasted.trim().length >= 20) {
                  extract.mutate(pasted);
                  return;
                }
                // One-click path: read what they copied on the vendor page.
                try {
                  const text = await navigator.clipboard.readText();
                  if (text.trim().length >= 20) {
                    setPasted(text);
                    extract.mutate(text);
                  } else {
                    toast.error(
                      `Copy the ${source?.label ?? 'vendor'} page first (Ctrl+A, Ctrl+C), then click this`,
                    );
                  }
                } catch {
                  toast.error('Clipboard is blocked — click in the box and press Ctrl+V instead');
                }
              }}
              disabled={extract.isPending}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 text-xs font-medium text-[var(--color-brand)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-50"
            >
              <Sparkles aria-hidden="true" className="size-3" />
              {extract.isPending
                ? 'Reading…'
                : pasted.trim().length >= 20
                  ? 'Find date with AI'
                  : 'Paste & find date'}
            </button>
            {aiNote ? (
              <span className="text-xs text-[var(--color-content-muted)]">{aiNote}</span>
            ) : null}
          </span>
        </span>
      ) : null}
      {canUpdate && source?.vendor === 'lenovo' && serial ? (
        <button
          type="button"
          onClick={() => vendorRefresh.mutate()}
          disabled={vendorRefresh.isPending}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 text-xs font-medium text-[var(--color-brand)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-50"
        >
          <RefreshCw
            aria-hidden="true"
            className={vendorRefresh.isPending ? 'size-3 animate-spin' : 'size-3'}
          />
          {vendorRefresh.isPending ? 'Asking Lenovo…' : 'Update from Lenovo'}
        </button>
      ) : null}
      {source ? (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          onClick={() => {
            if (!source.serialInUrl && serial) {
              void navigator.clipboard.writeText(serial);
              toast.success(`Serial copied — paste it on the ${source.label} page`);
            }
          }}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 text-xs font-medium text-[var(--color-brand)] hover:bg-[var(--color-surface-sunken)]"
        >
          <ShieldCheck aria-hidden="true" className="size-3" />
          Check with {source.label}
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      ) : null}
      {/* Record what the vendor said without a trip through the edit form -
          check, type, saved. */}
      {canUpdate && !editing ? (
        <button
          type="button"
          aria-label="Record warranty end date"
          onClick={() => setEditing(true)}
          className="text-xs font-medium text-[var(--color-content-subtle)] hover:text-[var(--color-brand)]"
        >
          <Pencil aria-hidden="true" className="size-3" />
        </button>
      ) : null}
    </span>
  );
}
