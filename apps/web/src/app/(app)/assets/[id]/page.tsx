'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ExternalLink, TicketPlus, ChevronDown, Printer, Lock, Pencil, RefreshCw, Sparkles } from 'lucide-react';
import {
  ASSET_STATUS_TOKENS,
  CONDITION_TOKENS,
  LIFECYCLE_STATE_TOKENS,
  AVAILABILITY_STATE_TOKENS,
  OWNERSHIP_TYPE_TOKENS,
  type StatusToken,
} from '@techpioasset/ui-tokens';
import {
  ASSET_TYPES_BY_KEY, isAgentReportedType, warrantySource,
  PERMISSIONS,
  type AssetCondition,
  type AssetStatus,
  type LifecycleState,
  type AvailabilityState,
  type OwnershipType,
} from '@techpioasset/domain';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { CustodyPanel } from '@/components/assets/custody-panel';
import { EquipmentKit } from '@/components/assets/equipment-kit';
import { ConditionPhotos } from '@/components/assets/condition-photos';
import { DisposalPanel, type DisposalDto } from '@/components/assets/disposal-panel';
import { TransferPanel, type OpenTransferDto } from '@/components/assets/transfer-panel';
import {
  HardwareTab,
  HealthTab,
  OsTab,
  SoftwareTab,
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
  } | null;
  id: string;
  assetTag: string;
  name: string;
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
  category: { name: string } | null;
  subcategory: { key: string; name: string } | null;
  office: { id: string; name: string } | null;
  assignedUser: {
    id: string;
    email: string;
    profile: { firstName: string; lastName: string; employeeNumber: string | null } | null;
  } | null;
  assignmentDate: string | null;
  notes: string | null;
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

type AssetTab =
  | 'overview'
  | 'lifecycle'
  | 'hardware'
  | 'os'
  | 'software'
  | 'health'
  | 'history'
  | 'financials';

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

/** Whole months between two dates, floored — for age and warranty-remaining. */
/** Drop badges whose label an earlier badge already carries. */
function dedupeBadges(tokens: (StatusToken | null)[]): StatusToken[] {
  const seen = new Set<string>();
  return tokens.filter((t): t is StatusToken => {
    if (!t || seen.has(t.label)) return false;
    seen.add(t.label);
    return true;
  });
}

function monthsBetween(from: Date, to: Date): number {
  return Math.max(
    0,
    (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()),
  );
}

function humanDuration(months: number): string {
  if (months <= 0) return '—';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} yr${y > 1 ? 's' : ''}` : '', m ? `${m} mo` : ''].filter(Boolean).join(' ') || '—';
}

export default function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can, user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const canSeeCost = can(PERMISSIONS.ASSETS_COST_READ);
  const [tab, setTab] = useState<AssetTab>('overview');
  const [price, setPrice] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['asset', id],
    queryFn: () => apiFetch<AssetDetail>(`/assets/${id}`),
  });

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

  // Moving from a laptop to a headset with "Hardware" open would leave the page
  // on a tab that no longer exists, showing nothing at all. This sits above the
  // loading and error returns: a hook after an early return runs on some
  // renders and not others, which React rejects outright.
  const discoveryAvailable =
    !data ||
    isAgentReportedType(data.subcategory?.key) ||
    Boolean(data.hardwareProfile) ||
    Boolean(data.osInfo) ||
    Boolean(data.health) ||
    data._count.installedSoftware > 0;

  useEffect(() => {
    if (!discoveryAvailable && (tab === 'hardware' || tab === 'os' || tab === 'software' || tab === 'health')) {
      setTab('overview');
    }
  }, [discoveryAvailable, tab]);

  if (isPending) {
    return (
      <div className="mx-auto grid max-w-3xl gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
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

  // v2.20 - render the stored specification in the type's own field order, so
  // two monitors always read the same way round, and label it from the shared
  // catalogue rather than showing raw keys.
  const typeDef = data.subcategory ? ASSET_TYPES_BY_KEY[data.subcategory.key] : undefined;

  /**
   * The agent-reported sections belong to things that boot. A headset shows
   * four tabs that say "Nothing discovered yet" forever, which reads as
   * discovery being broken rather than inapplicable.
   *
   * They are still shown for any asset that actually carries the data, whatever
   * its type: something reported it, and hiding that would lose real
   * information. Only the permanently-empty case disappears.
   */
  const showDiscovery = discoveryAvailable;
  const specRows: [string, string][] = typeDef
    ? typeDef.fields
        .filter((f) => data.specs?.[f.key])
        .map((f) => [f.unit ? `${f.label} (${f.unit})` : f.label, data.specs![f.key]!])
    : Object.entries(data.specs ?? {});

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div>
        {/* The crumb must lead somewhere the viewer may actually go: an
            OWN-scope holder cannot open /assets, so it would bounce them to
            the dashboard. Point them back at their own equipment instead. */}
        <Breadcrumbs
          items={[
            can(PERMISSIONS.ASSETS_READ) && user?.scope !== 'OWN'
              ? { label: 'Assets', href: '/assets' }
              : { label: 'My assets', href: '/my-assets' },
            { label: data.assetTag },
          ]}
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{data.name}</h1>
          {/* Status, lifecycle and availability are three dimensions that often
              agree - ASSIGNED derives availability "Assigned", so printing all
              three verbatim reads "Assigned · Deployed · Assigned", which looks
              like a bug, not three answers. Same dedupe the mobile app applies:
              each dimension still gets its pill, but a label already on screen
              is not repeated. */}
          {dedupeBadges([
            ASSET_STATUS_TOKENS[data.status],
            data.lifecycleState ? LIFECYCLE_STATE_TOKENS[data.lifecycleState] : null,
            data.availabilityState ? AVAILABILITY_STATE_TOKENS[data.availabilityState] : null,
          ]).map((token) => (
            <StatusBadge key={token.label} token={token} size="sm" />
          ))}
          {data.ownershipType ? (
            <StatusBadge
              token={OWNERSHIP_TYPE_TOKENS[data.ownershipType]}
              size="sm"
              showIcon={false}
            />
          ) : null}
          {/* Everything a holder needs to ask for, one menu: the issue
              catalogue for problems, request types for equipment. Each entry
              lands on /requests/new pre-filled with this device, so nobody
              types an asset tag by hand. */}
          {user && data.assignedUser?.id === user.id ? (
            <CreateTicketMenu assetTag={data.assetTag} assetName={data.name} />
          ) : null}
          {/* Printable handover receipt - the print CSS strips the app chrome,
              so the browser's Save as PDF is the PDF engine. Offered whenever a
              holder exists; an employee can only ever reach their own device. */}
          {data.assignedUser ? (
            <Link
              href={`/assets/${id}/receipt`}
              className={`${user && data.assignedUser?.id === user.id ? '' : 'ml-auto '}inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-surface-sunken)]`}
            >
              <Printer aria-hidden="true" className="size-4" />
              Receipt
            </Link>
          ) : null}
          {can(PERMISSIONS.ASSETS_UPDATE) ? (
            <Link
              href={`/assets/${id}/edit`}
              className={`${data.assignedUser ? '' : 'ml-auto '}inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-surface-sunken)]`}
            >
              <Pencil aria-hidden="true" className="size-4" />
              Edit
            </Link>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-[var(--color-content-subtle)]">
          {data.assetTag}
          {data.serialNumber ? ` · SN ${data.serialNumber}` : ''}
        </p>
      </div>

      {/* v2.2 Workstream E — tabbed asset detail. */}
      <div
        role="tablist"
        aria-label="Asset detail sections"
        className="flex gap-1 border-b border-[var(--color-border)]"
      >
        {(
          [
            ['overview', 'Overview'],
            ['lifecycle', 'Lifecycle'],
            ...(showDiscovery
              ? ([
                  ['hardware', 'Hardware'],
                  ['os', 'OS & Security'],
                  [
                    'software',
                    `Software${data._count.installedSoftware ? ` (${data._count.installedSoftware})` : ''}`,
                  ],
                  ['health', 'Health'],
                ] as const)
              : []),
            ['history', 'History'],
            ...(canSeeCost ? ([['financials', 'Financials']] as const) : []),
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={
              tab === key
                ? 'border-b-2 border-[var(--color-brand)] px-3.5 py-2 text-sm font-semibold text-[var(--color-brand)]'
                : 'border-b-2 border-transparent px-3.5 py-2 text-sm font-medium text-[var(--color-content-muted)] hover:text-[var(--color-content)]'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <Card className="p-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Row label="Category" value={data.category?.name} />
            <Row label="Type" value={data.subcategory?.name} />
            <Row label="Office" value={data.office?.name} />
            <Row label="Brand" value={data.brand} />
            <Row label="Model" value={data.model} />
            {/* v2.20 - shown only when the asset carries one, so a monitor's
                card is not padded with blank network rows. */}
            {data.imei ? <Row label="IMEI" value={<span className="font-mono text-xs">{data.imei}</span>} /> : null}
            {data.macAddress ? (
              <Row label="MAC address" value={<span className="font-mono text-xs">{data.macAddress}</span>} />
            ) : null}
            <Row
              label="Condition"
              value={
                <StatusBadge token={CONDITION_TOKENS[data.condition]} size="sm" showIcon={false} />
              }
            />
            <Row label="Purchased on" value={fmtDate(data.purchaseDate)} />
            {/* v2.47 - what this unit actually is, according to the supplier who
                sold it. Only present for units that came through procurement
                after the link existed; older ones say nothing rather than
                guessing. */}
            {data.vendorProduct ? (
              <Row
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
            <Row
              label="Warranty ends"
              value={
                <WarrantyCheck
                  assetId={id}
                  ends={data.warrantyEndDate}
                  serial={data.serialNumber}
                  identity={[
                    data.hardwareProfile?.manufacturer,
                    data.brand,
                    data.model,
                    data.name,
                  ]}
                  canUpdate={can(PERMISSIONS.ASSETS_UPDATE)}
                />
              }
            />
            <Row
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
                    {(() => {
                      const open = data.assignments.find((a) => !a.returnedAt);
                      return open?.assignedBy?.profile ? (
                        <span className="block text-xs text-[var(--color-content-subtle)]">
                          issued by {open.assignedBy.profile.firstName}{' '}
                          {open.assignedBy.profile.lastName}
                        </span>
                      ) : null;
                    })()}
                  </>
                ) : (
                  'Unassigned'
                )
              }
            />
          </dl>
          {data.notes ? (
            <p className="mt-4 border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-content-muted)]">
              {data.notes}
            </p>
          ) : null}

          {/* v2.20 - whatever the type declared, labelled from the same
              catalogue the form used. Nothing recorded, nothing shown. */}
          {specRows.length > 0 ? (
            <div className="mt-4 border-t border-[var(--color-border)] pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                {typeDef?.name ?? 'Specification'}
              </p>
              <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {specRows.map(([label, value]) => (
                  <Row key={label} label={label} value={value} />
                ))}
              </dl>
            </div>
          ) : null}
        </Card>
      ) : null}

      {tab === 'overview' ? (
        <CustodyPanel
          assetId={id}
          status={data.status}
          holderName={holderName}
          holderId={data.assignedUser?.id ?? null}
        />
      ) : null}

      {/* v2.32 - condition evidence, before and after. Shown whether or not the
          asset is currently out: the comparison that matters most is usually a
          past handover, after the person has already given the kit back. */}
      {tab === 'overview' ? <ConditionPhotos assetId={id} holderName={holderName} /> : null}

      {/* v2.21 - what else this person was given. Only shown when the asset has
          a holder: with nobody holding it there is no kit to speak of. */}
      {tab === 'overview' && data.assignedUser ? (
        <EquipmentKit
          holderId={data.assignedUser.id}
          holderName={holderName}
          excludeAssetId={id}
          emptyMessage={`${holderName ?? 'This person'} holds no other equipment.`}
        />
      ) : null}

      {tab === 'overview' ? (
        <TransferPanel
          assetId={id}
          status={data.status}
          officeId={data.office?.id ?? null}
          holderId={data.assignedUser?.id ?? null}
          openTransfer={data.transfers[0] ?? null}
        />
      ) : null}

      {tab === 'overview' ? (
        <DisposalPanel
          assetId={id}
          assetName={data.name}
          status={data.status}
          disposal={data.disposal}
        />
      ) : null}

      {tab === 'lifecycle' ? <LifecycleTab data={data} /> : null}

      {tab === 'hardware' ? <HardwareTab hw={data.hardwareProfile} /> : null}
      {tab === 'os' ? <OsTab os={data.osInfo} /> : null}
      {tab === 'software' ? <SoftwareTab assetId={id} /> : null}
      {tab === 'health' ? (
        <HealthTab assetId={id} health={data.health} canRecompute={can(PERMISSIONS.ASSETS_UPDATE)} />
      ) : null}

      {tab === 'history' ? (
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Custody &amp; condition history</h2>
          {data.assignments.length === 0 && data.conditionLogs.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-content-muted)]">No history yet.</p>
          ) : (
            <ol className="mt-3 space-y-3">
              {data.assignments.map((a) => (
                <li key={`a-${a.id}`} className="flex gap-3 text-sm">
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--color-brand)]" />
                  <span>
                    <span className="font-medium">
                      {a.returnedAt ? 'Returned by ' : 'Assigned to '}
                      {a.user?.profile
                        ? `${a.user.profile.firstName} ${a.user.profile.lastName}`
                        : (a.user?.email ?? 'someone')}
                    </span>
                    <span className="text-[var(--color-content-subtle)]">
                      {' '}
                      · {fmtDate(a.returnedAt ?? a.assignedAt)}
                      {!a.returnedAt && a.assignedBy?.profile
                        ? ` · issued by ${a.assignedBy.profile.firstName} ${a.assignedBy.profile.lastName}`
                        : ''}
                    </span>
                    {a.assetReturn?.damageNotes ? (
                      <span className="block text-xs text-[var(--tone-warning-fg)]">
                        {a.assetReturn.damageNotes}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
              {data.conditionLogs.map((log) => (
                <li key={`c-${log.id}`} className="flex gap-3 text-sm">
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--color-content-subtle)]" />
                  <span>
                    <span className="font-medium">
                      {log.previousStatus && log.newStatus && log.previousStatus !== log.newStatus
                        ? `${log.previousStatus} → ${log.newStatus}`
                        : log.previousCondition && log.newCondition
                          ? `Condition ${log.previousCondition} → ${log.newCondition}`
                          : 'Status change'}
                    </span>
                    <span className="text-[var(--color-content-subtle)]"> · {fmtDate(log.recordedAt)}</span>
                    {log.reason ? (
                      <span className="block text-xs text-[var(--color-content-subtle)]">{log.reason}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
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
  );
}

/**
 * Device lifecycle (v2.12) — the story of one device, for the person holding it.
 *
 * Built entirely from data the asset endpoint already returns and already
 * anonymises for OWN-scope viewers: purchase and warranty dates, assignment
 * events (previous holders reduced to a count, never named), and condition /
 * status changes that stand in for repairs and maintenance. No cost, no vendor,
 * no colleague identities — those never leave the API for an employee.
 */
function LifecycleTab({ data }: { data: AssetDetail }) {
  const now = new Date();
  const purchase = data.purchaseDate ? new Date(data.purchaseDate) : null;
  const warrantyEnd = data.warrantyEndDate ? new Date(data.warrantyEndDate) : null;
  const ageMonths = purchase ? monthsBetween(purchase, now) : 0;
  const warrantyMonthsLeft = warrantyEnd && warrantyEnd > now ? monthsBetween(now, warrantyEnd) : 0;
  const underWarranty = Boolean(warrantyEnd && warrantyEnd > now);

  type Event = { date: Date | null; title: string; detail?: string; tone: string };
  const events: Event[] = [];
  if (purchase) events.push({ date: purchase, title: 'Purchased', tone: 'info' });
  if (data.warrantyStartDate)
    events.push({ date: new Date(data.warrantyStartDate), title: 'Warranty started', tone: 'success' });

  for (const a of data.assignments) {
    events.push({
      date: new Date(a.assignedAt),
      title: a.user ? 'Assigned to you' : 'Assigned',
      detail: a.user ? undefined : 'to a team member',
      tone: 'progress',
    });
    if (a.returnedAt)
      events.push({
        date: new Date(a.returnedAt),
        title: 'Returned',
        detail: a.assetReturn?.conditionIn ? `condition: ${a.assetReturn.conditionIn.toLowerCase()}` : undefined,
        tone: 'muted',
      });
  }

  for (const log of data.conditionLogs) {
    const bits = [
      log.previousStatus && log.newStatus && log.previousStatus !== log.newStatus
        ? `${log.previousStatus.toLowerCase()} → ${log.newStatus.toLowerCase()}`
        : null,
      log.previousCondition && log.newCondition && log.previousCondition !== log.newCondition
        ? `condition ${log.newCondition.toLowerCase()}`
        : null,
      log.reason ?? null,
    ].filter(Boolean);
    events.push({
      date: new Date(log.recordedAt),
      title: 'Status update',
      detail: bits.join(' · ') || undefined,
      tone: 'warning',
    });
  }

  if (warrantyEnd)
    events.push({
      date: warrantyEnd,
      title: warrantyEnd > now ? 'Warranty ends' : 'Warranty ended',
      tone: warrantyEnd > now ? 'muted' : 'critical',
    });
  if (data.expectedReplacementDate)
    events.push({
      date: new Date(data.expectedReplacementDate),
      title: 'Expected replacement',
      tone: 'info',
    });

  // Chronological story, oldest first, ending with where the device stands now.
  events.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));

  const chips: { label: string; value: string }[] = [
    { label: 'Purchased', value: fmtDate(data.purchaseDate) },
    { label: 'Asset age', value: purchase ? humanDuration(ageMonths) : '—' },
    {
      label: 'Warranty',
      value: warrantyEnd
        ? underWarranty
          ? `${humanDuration(warrantyMonthsLeft)} left`
          : 'Expired'
        : '—',
    },
    { label: 'Expected replacement', value: fmtDate(data.expectedReplacementDate) },
    {
      label: 'Times assigned',
      value: String(data.assignmentCount ?? data.assignments.length),
    },
  ];

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
          This device has been assigned {data.assignmentCount ?? data.assignments.length} time
          {(data.assignmentCount ?? data.assignments.length) === 1 ? '' : 's'}. Previous holders are
          not shown.
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
                      <span className="font-normal text-[var(--color-content-muted)]"> — {e.detail}</span>
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
 * The holder's ticket menu (v2.15). Five doors into /requests/new, each
 * pre-filled with this device: problems route through the issue catalogue so
 * the right type and priority are chosen for them; equipment needs go straight
 * to the matching request type.
 */
function CreateTicketMenu({ assetTag, assetName }: { assetTag: string; assetName: string }) {
  const [open, setOpen] = useState(false);
  const about = encodeURIComponent(`${assetTag} ${assetName}`);
  const items: [string, string][] = [
    [`/requests/new?report=issue&about=${about}`, 'Report a problem'],
    [`/requests/new?issue=SOFTWARE&about=${about}`, 'System / software update'],
    [`/requests/new?type=ADDITIONAL_EQUIPMENT&about=${about}`, 'Accessories (mouse, headphones…)'],
    [`/requests/new?type=REPLACEMENT&about=${about}`, 'Request replacement'],
    [`/requests/new?type=UPGRADE&about=${about}`, 'Request upgrade'],
  ];
  return (
    <div className="relative ml-auto">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-3 text-sm font-medium text-white hover:opacity-90"
      >
        <TicketPlus aria-hidden="true" className="size-4" />
        Create ticket
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </button>
      {open ? (
        <>
          {/* Click-away layer under the menu. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 w-64 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] py-1 shadow-lg"
          >
            {items.map(([href, label]) => (
              // No onClick-close: hiding the menu re-renders and can unmount
              // the link before Next follows it, eating the navigation. The
              // route change closes the menu by unmounting the whole page.
              <Link
                key={href}
                role="menuitem"
                href={href}
                className="block px-3 py-2 text-sm hover:bg-[var(--color-surface-sunken)]"
              >
                {label}
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </div>
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
