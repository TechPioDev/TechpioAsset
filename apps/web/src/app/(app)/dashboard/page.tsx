'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Boxes,
  ClipboardList,
  Eye,
  FileBarChart,
  IndianRupee,
  Building2,
  Package,
  Plus,
  ShoppingBag,
  ShieldCheck,
  Upload,
  Users,
  Wrench,
} from 'lucide-react';
import {
  ASSET_STATUS_GROUP_LABELS,
  ASSET_STATUS_TOKENS,
  OFFER_LIFECYCLE_TOKENS,
} from '@techpioasset/ui-tokens';
import {
  PERMISSIONS,
  ASSET_STATUS_GROUPS,
  fleetBreakdown,
  fleetGrowthReadiness,
  fleetGrowthShortfall,
  formatInr,
  isReadOnlyPermission,
  type AssetStatus,
  type OfferLifecycle,
  type Permission,
} from '@techpioasset/domain';
import { apiFetch, apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Card, EmptyState, ErrorState, Skeleton, linkButtonCls } from '@/components/ui';
import { useOfferPolicy } from '@/components/catalogue/use-offer-policy';
import { StatusBadge } from '@/components/status-badge';
import { StatusBarChart } from '@/components/charts/status-bar-chart';
import { RoleTiles } from '@/components/dashboard/role-tiles';
import { ReceiptPrompt } from '@/components/dashboard/receipt-prompt';
import {
  AllocationPie,
  DonutChart,
  Gauge,
  GrowthArea,
  Legend,
  WarrantyTimeline,
} from '@/components/dashboard/charts';

interface AssetRow {
  id: string;
  assetTag: string;
  name: string;
  status: AssetStatus;
  warrantyEndDate: string | null;
  purchaseDate: string | null;
  category: { name: string } | null;
  office: { name: string } | null;
  assignedUser: { id: string; email: string } | null;
}

const DAY = 86_400_000;
const PALETTE = [
  'var(--color-brand)',
  'var(--tone-progress-solid)',
  'var(--tone-info-solid)',
  'var(--tone-success-solid)',
  'var(--tone-warning-solid)',
  'var(--color-content-subtle)',
];
const seriesColor = (i: number): string =>
  PALETTE[i % PALETTE.length] ?? 'var(--color-content-subtle)';

// Friendly labels for the header role chip. Custom roles (WS-G) fall back to a
// title-cased key, so the chip is always sensible without a lookup round-trip.
const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  COMPANY_ADMIN: 'Company Admin',
  IT_ADMIN: 'IT Manager',
  IT_TECHNICIAN: 'IT Technician',
  HR: 'HR Manager',
  OFFICE_ADMIN: 'Office Admin',
  FINANCE: 'Finance Manager',
  MANAGER: 'Department Manager',
  PROCUREMENT_MANAGER: 'Procurement Manager',
  INVENTORY_MANAGER: 'Inventory Manager',
  EMPLOYEE: 'Employee',
  AUDITOR: 'Auditor',
};
const formatRole = (key: string): string =>
  ROLE_LABELS[key] ??
  key
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const SCOPE_LABELS: Record<string, string> = {
  ALL: 'All company data',
  DEPARTMENT: 'Your department',
  DIRECT_REPORTS: 'You & your reports',
  OWN: 'Only your own records',
};

/**
 * v2.94 - the bar is the navigation now.
 *
 * Six tiles beneath it repeated its segments, because the segments were not
 * clickable and the tiles were. A segment that opens the list it counts lets
 * the duplicates go: one control, in one place, saying one thing once.
 */
interface FleetSegment {
  key: string;
  label: string;
  count: number;
  tone: string;
  /** The list this segment counts. Absent for "Other", which has no filter. */
  href?: string;
}

function FleetBar({
  segments,
  total,
}: {
  segments: FleetSegment[];
  total: number;
}) {
  const visible = segments.filter((seg) => seg.count > 0);
  if (total === 0 || visible.length === 0) return null;
  return (
    <div>
      <div
        className="flex h-9 w-full overflow-hidden rounded-lg"
        role="img"
        aria-label={visible.map((seg) => `${seg.label} ${seg.count}`).join(', ')}
      >
        {visible.map((seg, i) => {
          const pctOf = (seg.count / total) * 100;
          const inner =
            pctOf >= 8 ? (
              <span className="px-1 text-[11px] font-bold tabular-nums text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.45)]">
                {Math.round(pctOf)}%
              </span>
            ) : null;
          const style = {
            flexGrow: seg.count,
            flexBasis: 0,
            background: `var(--tone-${seg.tone}-solid)`,
            marginLeft: i === 0 ? 0 : 2,
          };
          const cls =
            'relative flex items-center justify-center transition-[flex-grow] duration-500';
          const title = `${seg.label}: ${seg.count} (${Math.round(pctOf)}%)`;
          return seg.href ? (
            <Link
              key={seg.key}
              href={seg.href}
              title={`${title} - open this list`}
              className={`${cls} hover:brightness-110`}
              style={style}
            >
              {inner}
            </Link>
          ) : (
            <div key={seg.key} title={title} className={cls} style={style}>
              {inner}
            </div>
          );
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {visible.map((seg) => {
          const swatch = (
            <>
              <span
                aria-hidden="true"
                className="size-2.5 rounded-[3px]"
                style={{ background: `var(--tone-${seg.tone}-solid)` }}
              />
              <span className="text-[var(--color-content-muted)]">{seg.label}</span>
              <span className="font-semibold tabular-nums">{seg.count.toLocaleString()}</span>
            </>
          );
          const cls = 'inline-flex items-center gap-1.5 text-xs';
          return seg.href ? (
            <Link key={seg.key} href={seg.href} className={`${cls} hover:underline`}>
              {swatch}
            </Link>
          ) : (
            <span key={seg.key} className={cls}>
              {swatch}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Section heading with a kicker - the bento grid's typographic voice. */
function SectionHead({
  kicker,
  title,
  action,
}: {
  kicker: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-brand)]">
          {kicker}
        </span>
        <h2 className="mt-0.5 text-[16px] font-bold tracking-tight">{title}</h2>
      </div>
      {action}
    </div>
  );
}

// Employee quick actions (OWN scope): the three things an employee actually
// comes to do, phrased as intents. Each lands on the request form with the
// type pre-selected.
/**
 * A supplier is not a colleague with a laptop (v2.44).
 *
 * Its scope is OWN, so without this it landed on the employee dashboard and was
 * told to confirm equipment it had received and report faults on kit it does
 * not have. Nothing here is about kit; it is about the catalogue, which is the
 * only reason a supplier has an account.
 */
/** The few fields the dashboard shows for a supplier's own offer. */
interface VendorOfferRow {
  id: string;
  name: string;
  landedCost: string;
  availableQuantity: number;
  availableUntil: string;
  effectiveStatus: OfferLifecycle;
}

const VENDOR_QUICK_ACTIONS: {
  href: string;
  label: string;
  icon: ReactNode;
  tone: string;
  perm?: Permission;
}[] = [
  {
    href: '/catalogue',
    label: 'Your offers',
    icon: <ShoppingBag className="size-[18px]" />,
    tone: 'info',
    perm: PERMISSIONS.VENDOR_PRODUCTS_READ,
  },
  {
    href: '/catalogue/new',
    label: 'Add an offer',
    icon: <Plus className="size-[18px]" />,
    tone: 'progress',
    perm: PERMISSIONS.VENDOR_PRODUCTS_MANAGE,
  },
  {
    // Reachable from a button on the catalogue and from no menu anywhere, so a
    // supplier looking for "where do I change my phone number" found nothing.
    href: '/catalogue/company',
    label: 'Your company details',
    icon: <Building2 className="size-[18px]" />,
    tone: 'neutral',
    perm: PERMISSIONS.VENDOR_PORTAL_ACCESS,
  },
];

const EMPLOYEE_QUICK_ACTIONS: {
  href: string;
  label: string;
  icon: ReactNode;
  tone: string;
  perm?: Permission;
}[] = [
  {
    href: '/requests/new',
    label: 'Request equipment',
    icon: <ClipboardList className="size-[18px]" />,
    tone: 'progress',
    perm: PERMISSIONS.REQUESTS_CREATE,
  },
  {
    href: '/requests/new?report=issue',
    label: 'Report an issue',
    icon: <Wrench className="size-[18px]" />,
    tone: 'warning',
    perm: PERMISSIONS.REQUESTS_CREATE,
  },
  {
    href: '/requests/new?type=REPLACEMENT',
    label: 'Request replacement',
    icon: <Boxes className="size-[18px]" />,
    tone: 'info',
    perm: PERMISSIONS.REQUESTS_CREATE,
  },
  {
    href: '/my-assets',
    label: 'My assets',
    icon: <Users className="size-[18px]" />,
    tone: 'success',
  },
];

// Quick actions, each gated by the permission that makes it usable, so a role
// only ever sees the shortcuts it can actually act on.
const QUICK_ACTIONS: {
  href: string;
  label: string;
  icon: ReactNode;
  tone: string;
  perm?: Permission;
  /** Shown only to this role - for the Super Admin-only expense report. */
  role?: string;
}[] = [
  {
    href: '/assets',
    label: 'Browse assets',
    icon: <Boxes className="size-[18px]" />,
    tone: 'info',
    perm: PERMISSIONS.ASSETS_READ,
  },
  {
    href: '/requests/new',
    label: 'New request',
    icon: <ClipboardList className="size-[18px]" />,
    tone: 'progress',
    perm: PERMISSIONS.REQUESTS_CREATE,
  },
  {
    href: '/maintenance',
    label: 'Maintenance',
    icon: <Wrench className="size-[18px]" />,
    tone: 'warning',
    perm: PERMISSIONS.MAINTENANCE_READ,
  },
  {
    href: '/people',
    label: 'People',
    icon: <Users className="size-[18px]" />,
    tone: 'success',
    perm: PERMISSIONS.EMPLOYEES_READ,
  },
  {
    href: '/invoices/upload',
    label: 'Upload invoice',
    icon: <Upload className="size-[18px]" />,
    tone: 'neutral',
    perm: PERMISSIONS.INVOICES_UPLOAD,
  },
  {
    href: '/reports',
    label: 'Run report',
    icon: <FileBarChart className="size-[18px]" />,
    tone: 'danger',
    perm: PERMISSIONS.REPORTS_READ,
  },
  {
    href: '/expenses',
    label: 'Expenses',
    icon: <IndianRupee className="size-[18px]" />,
    tone: 'info',
    role: 'SUPER_ADMIN',
  },
];

interface SpendReport {
  rows: { name: string; count: number; total: number }[];
}

export default function DashboardPage() {
  const { user, can } = useAuth();
  const canSeeSpend = can(PERMISSIONS.ASSETS_COST_READ);
  /**
   * The fleet query needs a permission, and one role does not have it.
   *
   * VENDOR carries an empty permission list, so this call 403d and isError took
   * the entire dashboard down - a role that can sign in landed on "Could not
   * load the dashboard" with nothing else on the page, even though the role
   * tiles below fetch from /dashboard and work for anyone. The spend query two
   * lines down was already gated this way; this one was not.
   */
  const canSeeAssets = can(PERMISSIONS.ASSETS_READ);

  // Role context. Everyone reads their own scope; only non-OWN scopes see the
  // fleet-level widgets. A user whose grants are all read-only (e.g. Auditor)
  // gets a read-only surface: no create/act controls.
  const scope = user?.scope;
  const isFleetViewer = scope !== undefined && scope !== 'OWN';
  const isReadOnly =
    !!user &&
    user.permissions.length > 0 &&
    user.permissions.every((p) => isReadOnlyPermission(p as Permission));
  const roleLabel = user?.roles?.[0] ? formatRole(user.roles[0]) : null;
  const scopeLabel = scope ? SCOPE_LABELS[scope] : null;
  const isVendor = Boolean(user?.roles?.includes('VENDOR'));
  const quickActions = (
    isVendor ? VENDOR_QUICK_ACTIONS : user?.scope === 'OWN' ? EMPLOYEE_QUICK_ACTIONS : QUICK_ACTIONS
  ).filter(
    (a) =>
      (!a.perm || can(a.perm)) &&
      (!('role' in a) || typeof a.role !== 'string' || Boolean(user?.roles?.includes(a.role))),
  );

  // A supplier's own offers and the tenant's publishing policy. Both are cheap
  // and neither is fetched for anyone else.
  const { publishesAtOnce } = useOfferPolicy();

  const { data: vendorOfferData } = useQuery({
    queryKey: ['dashboard-vendor-offers'],
    enabled: isVendor,
    queryFn: () => apiFetch<VendorOfferRow[]>('/vendor-products?take=6'),
  });
  const vendorOffers = vendorOfferData ?? [];

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['dashboard-assets'],
    enabled: canSeeAssets,
    queryFn: () => apiFetchPage<AssetRow>('/assets?pageSize=100'),
  });

  // Counts come from the database, not from the page of rows above. Deriving
  // them by filtering `assets` counted the PAGE: 169 assets with pageSize=100
  // produced a breakdown summing to 100, printed beside a total of 169.
  const statsQuery = useQuery({
    queryKey: ['dashboard-asset-stats'],
    enabled: canSeeAssets,
    queryFn: () =>
      apiFetch<{
        total: number;
        byStatus: Record<string, number>;
        byCategory: { name: string; count: number }[];
        byOffice: { name: string; count: number }[];
        purchase: { dated: number; byMonth: { month: string; count: number }[] };
        warranty: Record<string, number> & { total: number };
      }>('/assets/stats'),
  });

  // Total spend by category — server-aggregated, and only ever requested for
  // roles that may see cost (Finance / Super Admin).
  /*
    v3.2 - asked for by the server, using the list's own warrantyWithinDays
    filter, rather than sifted out of the fetched page.

    It sits beside a timeline that now counts across the whole fleet. Left as
    it was, the band could say "3 expiring within 30 days" while the list under
    it showed none, because those three were on page two.

    Declared HERE, with the other queries, because the component returns early
    below for the loading and error states - a hook added further down runs on
    some renders and not others, and React counts hooks rather than naming
    them. That is the second time in this file's week; the rule is that a new
    hook goes with the other hooks, never where its value is used.
  */
  const expiringSoonQuery = useQuery({
    queryKey: ['dashboard-expiring-soon'],
    enabled: canSeeAssets,
    queryFn: () => apiFetchPage<AssetRow>('/assets?warrantyWithinDays=30&pageSize=6'),
  });

  const spend = useQuery({
    queryKey: ['dashboard-spend'],
    enabled: canSeeSpend,
    queryFn: () => apiFetch<SpendReport>('/reports?type=SPENDING_BY_CATEGORY'),
  });

  // Both guards are conditional on the query having actually run: a disabled
  // query reports `pending` forever, which would replace the error page with a
  // skeleton that never resolves - a quieter version of the same bug.
  if (canSeeAssets && isPending) {
    return (
      <div className="grid gap-5">
        <Skeleton className="h-9 w-72" />
        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      </div>
    );
  }

  if (canSeeAssets && isError) {
    return <ErrorState title="Could not load the dashboard" detail={(error as Error).message} />;
  }

  // Empty rather than absent, so every derived count below is a real zero for a
  // reader who cannot see the fleet. The sections that use them are already
  // behind isFleetViewer.
  const assets = data?.data ?? [];
  const byStatus = statsQuery.data?.byStatus ?? {};
  const total = statsQuery.data?.total ?? data?.meta.page.totalItems ?? 0;

  // Grouped by the domain rules, which are tested to cover every status - so a
  // status added later lands in `other` instead of vanishing from the bar.
  const fleet = fleetBreakdown(byStatus, total);
  const {
    available,
    assigned,
    inStock,
    onOrder: incoming,
    underRepair,
    critical,
    retired,
    other,
  } = fleet;

  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  const operational = total
    ? Math.round(((total - underRepair - critical - retired) / total) * 100)
    : 100;

  const now = Date.now();

  /*
    v3.2 - the warranty timeline is counted by the SERVER across the whole
    fleet. It was counted here over the fetched page, and it did
    `if (days < 0) continue` - so an already-lapsed warranty was counted
    nowhere. The four numbers did not add up to the fleet, and the assets
    missing from them were the ones most worth seeing.

    Six buckets now, and they are exhaustive: expired, 30/60/90, beyond, and
    none recorded. `warrantyBreakdown` in the domain is tested to prove they
    sum to the total.
  */
  const warranty = statsQuery.data?.warranty;
  const wExpired = warranty?.EXPIRED ?? 0;
  const w30 = warranty?.WITHIN_30 ?? 0;
  const w60 = warranty?.WITHIN_60 ?? 0;
  const w90 = warranty?.WITHIN_90 ?? 0;
  const covered = (warranty?.BEYOND_90 ?? 0) + (warranty?.NONE ?? 0);

  const inMonths = (m: number) =>
    new Date(now + m * 30 * DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  /**
   * The five biggest groups, and everything else as "Other".
   *
   * Takes counts the SERVER produced. It used to count the fetched page, which
   * is how a donut came to print 169 in the middle while its slices read 99
   * and 1, and an office pie showed 56% + 3%. Rolling the tail into "Other"
   * rather than dropping it is what keeps the slices adding up to the total in
   * the middle.
   */
  const groupTop = (counts: { name: string; count: number }[]) => {
    const sorted = [...counts].sort((a, b) => b.count - a.count);
    const rows = sorted
      .slice(0, 5)
      .map(({ name, count }, i) => ({ name, value: count, fill: seriesColor(i) }));
    const rest = sorted.slice(5).reduce((n, r) => n + r.count, 0);
    if (rest > 0) rows.push({ name: 'Other', value: rest, fill: seriesColor(5) });
    return rows;
  };
  // From the server, not from `assets`. Grouping the fetched page put "169"
  // in the middle of a donut whose slices read 99 and 1, and an office pie
  // whose two slices came to 59%.
  const byCategory = groupTop(statsQuery.data?.byCategory ?? []);
  const byOffice = groupTop(statsQuery.data?.byOffice ?? []);

  /*
    v3.1 - the growth line is built from the SERVER's purchase dates, not from
    the page of rows. It iterated `assets`, so with pageSize=100 it charted
    whatever dated assets happened to land on page one - the fifth place that
    bug turned up.

    It is also only drawn when most of the fleet carries a date. A cumulative
    count understates the fleet by exactly the number of undated assets, so on
    3-of-171 it drew a line rising to 2 under the heading "Fleet growth". That
    is not an approximation, it is a wrong number that looks like an answer.
  */
  const purchase = statsQuery.data?.purchase;
  const growthReady = fleetGrowthReadiness(purchase?.dated ?? 0, total);

  let running = 0;
  const growth = (purchase?.byMonth ?? []).map(({ month, count }) => {
    running += count;
    const [y, mo] = month.split('-');
    return {
      label: new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, {
        month: 'short',
      }),
      value: running,
    };
  });

  const statusData = (Object.keys(ASSET_STATUS_TOKENS) as AssetStatus[])
    .map((s) => ({
      label: ASSET_STATUS_TOKENS[s].label,
      count: byStatus[s] ?? 0,
      fill: `var(--tone-${ASSET_STATUS_TOKENS[s].tone}-solid)`,
    }))
    .filter((d) => d.count > 0);

  const recs = [
    w30 > 0 && {
      tone: 'danger',
      title: 'Plan warranty renewals',
      body: `${w30} asset${w30 === 1 ? '' : 's'} fall out of warranty within 30 days. Review coverage before it lapses.`,
      href: '/reports',
      cta: 'Open warranty report',
    },
    underRepair > 0 && {
      tone: 'warning',
      title: 'Repairs in progress',
      body: `${underRepair} asset${underRepair === 1 ? '' : 's'} under repair. Check turnaround on the maintenance board.`,
      href: '/maintenance',
      cta: 'Open maintenance',
    },
    available > 0 && {
      tone: 'info',
      title: 'Idle inventory',
      body: `${available} available asset${available === 1 ? '' : 's'} unassigned. Reallocate to clear open requests.`,
      href: '/assets?status=AVAILABLE',
      cta: 'View available',
    },
    critical > 0 && {
      tone: 'critical',
      title: 'Critical assets',
      body: `${critical} asset${critical === 1 ? '' : 's'} damaged, lost or stolen. Investigate and update status.`,
      href: '/assets?status=DAMAGED,LOST,STOLEN',
      cta: 'Review assets',
    },
  ]
    .filter(Boolean)
    .slice(0, 3) as {
    tone: string;
    title: string;
    body: string;
    href: string;
    cta: string;
  }[];

  const expiringSoon = expiringSoonQuery.data?.data ?? [];

  const needsAttention = assets
    .filter((a) =>
      (['UNDER_REPAIR', 'DAMAGED', 'LOST', 'STOLEN'] as AssetStatus[]).includes(a.status),
    )
    .slice(0, 6);

  // For an OWN-scope user (e.g. Employee) the fetched assets ARE their own kit.
  const myEquipment = assets.slice(0, 8);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  // The link is built from the SAME group that produced the number, so a
  // segment can never open a list that disagrees with the count on it - the
  // fault the Assigned tile had, counting ASSIGNED + IN_USE and linking to
  // ASSIGNED alone.
  const groupHref = (k: keyof typeof ASSET_STATUS_GROUPS) =>
    `/assets?status=${ASSET_STATUS_GROUPS[k].join(',')}`;

  const fleetSegments: FleetSegment[] = [
    { key: 'assigned', label: ASSET_STATUS_GROUP_LABELS.assigned, count: assigned, tone: 'progress', href: groupHref('assigned') },
    { key: 'available', label: ASSET_STATUS_GROUP_LABELS.available, count: available, tone: 'success', href: groupHref('available') },
    { key: 'stock', label: ASSET_STATUS_GROUP_LABELS.inStock, count: inStock, tone: 'info', href: groupHref('inStock') },
    { key: 'incoming', label: ASSET_STATUS_GROUP_LABELS.onOrder, count: incoming, tone: 'neutral', href: groupHref('onOrder') },
    { key: 'repair', label: ASSET_STATUS_GROUP_LABELS.underRepair, count: underRepair, tone: 'warning', href: groupHref('underRepair') },
    { key: 'critical', label: ASSET_STATUS_GROUP_LABELS.critical, count: critical, tone: 'critical', href: groupHref('critical') },
    { key: 'retired', label: ASSET_STATUS_GROUP_LABELS.retired, count: retired, tone: 'muted', href: groupHref('retired') },
    // Orange on purpose, and deliberately NOT a link. "Other" appearing at all
    // means a status nobody bucketed - there is no filter that would show it,
    // and offering one that returned nothing would be a second lie.
    { key: 'other', label: 'Other', count: other, tone: 'danger' },
  ];

  // The action center: everything asking for a decision, one card, ranked by
  // severity - recommendations first, then the specific devices behind them.
  return (
    <div className="grid gap-6">
      {/* v2.80 - a handover waiting on this person, before anything else. */}
      <ReceiptPrompt />
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden rounded-3xl border border-[var(--color-border)] p-6 sm:p-7"
        style={{
          background:
            'linear-gradient(135deg, color-mix(in srgb, var(--color-brand) 14%, var(--color-surface-raised)) 0%, var(--color-surface-raised) 55%)',
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full opacity-25 blur-3xl"
          style={{ background: 'var(--color-brand)' }}
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--color-brand)]">
              {today}
            </span>
            <h1 className="mt-1 text-[26px] font-bold tracking-tight sm:text-[30px]">
              {user?.firstName
                ? `Welcome back, ${user.firstName}`
                : isVendor
                  ? 'Your catalogue'
                  : 'Asset command center'}
            </h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {roleLabel ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-2.5 py-1 text-xs font-semibold text-[var(--color-brand-contrast)]">
                  <Users className="size-3.5" />
                  {roleLabel}
                </span>
              ) : null}
              {scopeLabel ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 px-2.5 py-1 text-xs font-medium text-[var(--color-content-muted)] backdrop-blur">
                  <ShieldCheck className="size-3.5" />
                  {scopeLabel}
                </span>
              ) : null}
              {isReadOnly ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--tone-warning-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--tone-warning-fg)]">
                  <Eye className="size-3.5" /> Read-only
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-5">
            {isFleetViewer ? (
              <div className="hidden text-right sm:block">
                <div className="text-[30px] font-bold leading-none tabular-nums">
                  {total.toLocaleString()}
                </div>
                <div
                  className="mt-1 text-xs font-medium text-[var(--color-content-muted)]"
                  title="Operational = everything except under repair, damaged, lost, stolen and retired."
                >
                  assets · {operational}% operational
                </div>
              </div>
            ) : null}
            {!isReadOnly && can(PERMISSIONS.ASSETS_CREATE) ? (
              <Link
                href="/assets/new"
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-brand-contrast)] shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <Plus className="size-4" /> Add asset
              </Link>
            ) : null}
          </div>
        </div>

        {isFleetViewer ? (
          <div className="relative mt-6">
            <FleetBar segments={fleetSegments} total={total} />
          </div>
        ) : (
          <p className="relative mt-3 max-w-xl text-sm text-[var(--color-content-muted)]">
            {isVendor
              ? publishesAtOnce
                ? 'What you are offering this buyer. Add products, keep prices and stock current, and publish - buyers see an offer as soon as you do.'
                : 'What you are offering this buyer. Add products, keep prices and stock current, and send new offers for approval.'
              : "Here's what's assigned to you and where you can help. Confirm equipment you have received, and raise a ticket the moment something misbehaves."}
          </p>
        )}
      </section>

      {/*
        Role-based "what needs me now" tiles (server-scoped).

        A reader who can see the fleet already has the total in the hero above,
        so the server's assets-total tile is hidden for them - the same number
        twice, two inches apart, was the clearest example of the duplication.
        A reader who cannot see the hero still gets it.
      */}
      <section aria-label="For you">
        <RoleTiles hideKeys={isFleetViewer ? ['assets-total'] : []} />
      </section>

      {isFleetViewer ? (
        <>
          {/*
            v2.94 - the KPI band is gone, and that is the point.

            It held six tiles: Total assets (the hero says it), Available,
            Assigned, Under repair and Critical (the bar above says all four,
            and its segments are now links), and Warranty expiring within 30
            days - which sat next to a server tile counting 90 days, two
            near-identical labels showing different numbers.

            Half a dashboard drawn twice is why nothing on it stood out. The
            warranty figure survives in the row above, where it is stated once
            with its window.
          */}

          {/* ── Spend (Finance only) ─────────────────────────────────────── */}
          {canSeeSpend && spend.data && spend.data.rows.length > 0 ? (
            <Card className="p-5">
              <SectionHead kicker="Finance" title="Total spend on record" />
              <div className="flex flex-wrap items-start justify-between gap-6">
                <p className="text-[32px] font-bold tracking-tight tabular-nums">
                  {spend.data.rows
                    .reduce((sum, r) => sum + r.total, 0)
                    .toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
                <div className="grid min-w-[260px] flex-1 gap-1.5 sm:max-w-md">
                  {spend.data.rows.slice(0, 5).map((r) => {
                    const grand = spend.data.rows.reduce((acc, x) => acc + x.total, 0) || 1;
                    const pctOf = Math.round((r.total / grand) * 100);
                    return (
                      <div key={r.name} className="grid grid-cols-[1fr_auto] items-center gap-x-3">
                        <div className="flex items-center justify-between text-[13px]">
                          <span className="text-[var(--color-content-muted)]">
                            {r.name}{' '}
                            <span className="text-xs text-[var(--color-content-subtle)]">
                              · {r.count}
                            </span>
                          </span>
                          <span className="font-semibold tabular-nums">
                            {r.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                        <div className="col-span-2 h-1.5 rounded-full bg-[var(--color-surface-sunken)]">
                          <div
                            className="h-full rounded-full bg-[var(--color-brand)]"
                            style={{ width: `${pctOf}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          ) : null}

          {/* ── Bento: growth + composition ──────────────────────────────── */}
          <section className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <SectionHead kicker="Trajectory" title="Fleet growth" />
              {!growthReady.ok ? (
                <EmptyState {...fleetGrowthShortfall(growthReady)} />
              ) : (
                <GrowthArea data={growth} />
              )}
            </Card>
            <Card className="p-5">
              <SectionHead kicker="Composition" title="By category" />
              {byCategory.length === 0 ? (
                <EmptyState title="No assets" description="Nothing to chart yet." />
              ) : (
                <div className="flex items-center gap-5">
                  <DonutChart
                    data={byCategory}
                    centerValue={total.toLocaleString()}
                    centerLabel="assets"
                  />
                  <Legend
                    items={byCategory.map((c) => ({
                      name: c.name,
                      value: c.value.toLocaleString(),
                      fill: c.fill,
                    }))}
                  />
                </div>
              )}
            </Card>
          </section>

          {/* ── Bento: health + offices + status ─────────────────────────── */}
          <section className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <SectionHead kicker="Health" title="Fleet in service" />
              {/*
                The last one. This read `assets.length`, so with a page of 100
                and 2,174 retired it printed "-2383 devices" - a negative count
                of working equipment. The percentage beside it was already
                computed from `total` and was right, which is exactly why
                nobody noticed: one number on the card was correct.
              */}
              <Gauge
                percent={operational}
                label={`Operational · ${(total - underRepair - critical - retired).toLocaleString()} devices`}
              />
            </Card>
            <Card className="p-5">
              <SectionHead kicker="Locations" title="Office allocation" />
              {byOffice.length === 0 ? (
                <EmptyState title="No offices" description="No allocation to show." />
              ) : (
                <div className="flex items-center gap-5">
                  <AllocationPie data={byOffice} />
                  <Legend
                    items={byOffice.map((o) => ({
                      name: o.name,
                      pct: `${pct(o.value)}%`,
                      fill: o.fill,
                    }))}
                  />
                </div>
              )}
            </Card>
            <Card className="p-5">
              <SectionHead kicker="Lifecycle" title="Assets by status" />
              {statusData.length === 0 ? (
                <EmptyState title="No assets" description="Nothing to chart." />
              ) : (
                <StatusBarChart data={statusData} />
              )}
            </Card>
          </section>

          {/* ── Action center + quick actions ────────────────────────────── */}
          <section className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <SectionHead
                kicker="Action center"
                title="What needs a decision"
                action={
                  <Link
                    href="/assets"
                    className="text-[13px] font-semibold text-[var(--color-brand)]"
                  >
                    All assets <ArrowRight className="inline size-3.5" />
                  </Link>
                }
              />
              {recs.length === 0 && needsAttention.length === 0 ? (
                <EmptyState title="All clear" description="Nothing needs a decision right now." />
              ) : (
                <div className="grid gap-2.5">
                  {recs.map((r) => (
                    <Link
                      key={r.title}
                      href={r.href}
                      className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3.5 transition hover:-translate-y-px hover:border-[var(--color-border-strong)]"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-1 size-2.5 shrink-0 rounded-full"
                        style={{ background: `var(--tone-${r.tone}-solid)` }}
                      />
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-semibold">{r.title}</span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-[var(--color-content-muted)]">
                          {r.body}
                        </span>
                        <span className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--color-brand)]">
                          {r.cta} <ArrowRight className="size-3.5" />
                        </span>
                      </span>
                    </Link>
                  ))}
                  {needsAttention.length > 0 ? (
                    <div className="mt-1 grid gap-1 border-t border-[var(--color-border)] pt-3">
                      {needsAttention.map((a) => (
                        <Link
                          key={a.id}
                          href={`/assets/${a.id}`}
                          className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition hover:bg-[var(--color-surface-sunken)]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13.5px] font-medium">
                              {a.name}
                            </span>
                            <span className="text-xs text-[var(--color-content-subtle)]">
                              {a.assetTag}
                            </span>
                          </span>
                          <StatusBadge token={ASSET_STATUS_TOKENS[a.status]} size="sm" />
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </Card>

            {quickActions.length > 0 ? (
              <Card className="p-5">
                <SectionHead kicker="Shortcuts" title="Quick actions" />
                <div className="grid gap-2">
                  {quickActions.map((a) => (
                    <Link
                      key={a.href}
                      href={a.href}
                      className="group flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-[13.5px] font-semibold transition hover:-translate-y-0.5 hover:border-[var(--color-brand)] hover:bg-[var(--color-surface)] hover:shadow-sm"
                    >
                      <span
                        className="grid size-9 place-items-center rounded-[10px] transition group-hover:scale-110"
                        style={{
                          color: `var(--tone-${a.tone}-fg)`,
                          background: `var(--tone-${a.tone}-bg)`,
                        }}
                      >
                        {a.icon}
                      </span>
                      {a.label}
                      <ArrowRight className="ml-auto size-4 text-[var(--color-content-subtle)] transition group-hover:translate-x-0.5 group-hover:text-[var(--color-brand)]" />
                    </Link>
                  ))}
                </div>
              </Card>
            ) : null}
          </section>

          {/* ── Warranty band ────────────────────────────────────────────── */}
          <section className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <SectionHead
                kicker="Coverage"
                title="Warranty expiry timeline"
                action={
                  <Link
                    href="/reports"
                    className="text-[13px] font-semibold text-[var(--color-brand)]"
                  >
                    Renewal report
                  </Link>
                }
              />
              <WarrantyTimeline
                buckets={[
                  {
                    // First, because a warranty that has already lapsed is a
                    // bigger problem than one lapsing next month - and it was
                    // the one state this timeline could not previously show.
                    count: wExpired,
                    label: 'Already expired',
                    when: 'overdue',
                    color: 'var(--tone-danger-solid)',
                  },
                  {
                    count: w30,
                    label: 'Expiring ≤ 30 days',
                    when: `by ${inMonths(1)}`,
                    color: 'var(--tone-critical-solid)',
                  },
                  {
                    count: w60,
                    label: '31 – 60 days',
                    when: `by ${inMonths(2)}`,
                    color: 'var(--tone-warning-solid)',
                  },
                  {
                    count: w90,
                    label: '61 – 90 days',
                    when: `by ${inMonths(3)}`,
                    color: 'var(--color-brand)',
                  },
                  {
                    count: covered,
                    label: 'Covered / no expiry',
                    when: 'healthy',
                    color: 'var(--tone-success-solid)',
                  },
                ]}
              />
            </Card>
            <Card className="p-0">
              <div className="border-b border-[var(--color-border)] px-5 py-3.5">
                <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-brand)]">
                  Next 30 days
                </span>
                <h2 className="mt-0.5 text-[16px] font-bold tracking-tight">Expiring warranties</h2>
              </div>
              {expiringSoon.length === 0 ? (
                <EmptyState
                  title="Nothing imminent"
                  description="No warranties end in the next 30 days."
                />
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {expiringSoon.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                      <div className="min-w-0">
                        <Link
                          href={`/assets/${a.id}`}
                          className="truncate text-[13.5px] font-medium hover:underline"
                        >
                          {a.name}
                        </Link>
                        <p className="text-xs text-[var(--color-content-subtle)]">{a.assetTag}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-[var(--tone-warning-bg)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--tone-warning-fg)]">
                        {Math.ceil((new Date(a.warrantyEndDate as string).getTime() - now) / DAY)}d
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </>
      ) : (
        /* ── OWN scope (employee) ─────────────────────────────────────────── */
        <section className="grid gap-4 lg:grid-cols-3">
          <Card className="p-0 lg:col-span-2">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3.5">
              <div>
                <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-brand)]">
                  {isVendor ? 'Your catalogue' : 'Your kit'}
                </span>
                <h2 className="mt-0.5 text-[16px] font-bold tracking-tight">
                  {isVendor ? 'Latest offers' : 'My equipment'}
                </h2>
              </div>
              {isVendor ? (
                <Link
                  href="/catalogue"
                  className="text-xs font-semibold text-[var(--color-brand)] hover:underline"
                >
                  See all
                </Link>
              ) : (
                <Package className="size-4 text-[var(--color-content-subtle)]" />
              )}
            </div>
            {/* A supplier is never issued equipment, so this half of the page was
                a permanent "No assets yet" - the largest thing on the screen
                saying nothing. It gets what it came here for instead. */}
            {isVendor ? (
              vendorOffers.length === 0 ? (
                <EmptyState
                  title="Nothing listed yet"
                  description="Add what you sell, put a picture on it, and publish it."
                  action={
                    <Link href="/catalogue/new" className={linkButtonCls.primary}>
                      <Plus aria-hidden="true" className="size-4" /> Add your first offer
                    </Link>
                  }
                />
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {vendorOffers.map((o) => {
                    const days = Math.ceil(
                      (new Date(o.availableUntil).getTime() - Date.now()) / 86_400_000,
                    );
                    return (
                      <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-3">
                        <div className="min-w-0">
                          <Link
                            href={`/catalogue/${o.id}`}
                            className="truncate text-[13.5px] font-medium hover:underline"
                          >
                            {o.name}
                          </Link>
                          <p className="text-xs text-[var(--color-content-subtle)]">
                            {formatInr(Number(o.landedCost))} ·{' '}
                            {o.availableQuantity > 0
                              ? `${o.availableQuantity} available`
                              : 'nothing left in stock'}
                            {days <= 30
                              ? days > 0
                                ? ` · ends in ${days} ${days === 1 ? 'day' : 'days'}`
                                : ' · ended'
                              : ''}
                          </p>
                        </div>
                        <StatusBadge token={OFFER_LIFECYCLE_TOKENS[o.effectiveStatus]} size="sm" />
                      </li>
                    );
                  })}
                </ul>
              )
            ) : myEquipment.length === 0 ? (
              <EmptyState
                title="No assets yet"
                description="Equipment issued to you will appear here."
              />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {myEquipment.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link
                        href={`/assets/${a.id}`}
                        className="truncate text-[13.5px] font-medium hover:underline"
                      >
                        {a.name}
                      </Link>
                      <p className="text-xs text-[var(--color-content-subtle)]">{a.assetTag}</p>
                    </div>
                    <StatusBadge token={ASSET_STATUS_TOKENS[a.status]} size="sm" />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {quickActions.length > 0 ? (
            <Card className="p-5">
              <SectionHead kicker="Shortcuts" title="Quick actions" />
              <div className="grid gap-2">
                {quickActions.map((a) => (
                  <Link
                    key={a.href}
                    href={a.href}
                    className="group flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-[13.5px] font-semibold transition hover:-translate-y-0.5 hover:border-[var(--color-brand)] hover:bg-[var(--color-surface)] hover:shadow-sm"
                  >
                    <span
                      className="grid size-9 place-items-center rounded-[10px] transition group-hover:scale-110"
                      style={{
                        color: `var(--tone-${a.tone}-fg)`,
                        background: `var(--tone-${a.tone}-bg)`,
                      }}
                    >
                      {a.icon}
                    </span>
                    {a.label}
                    <ArrowRight className="ml-auto size-4 text-[var(--color-content-subtle)] transition group-hover:translate-x-0.5 group-hover:text-[var(--color-brand)]" />
                  </Link>
                ))}
              </div>
            </Card>
          ) : null}
        </section>
      )}
    </div>
  );
}
