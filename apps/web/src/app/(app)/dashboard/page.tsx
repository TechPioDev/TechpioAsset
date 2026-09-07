'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileBarChart,
  Package,
  Plus,
  ShoppingBag,
  ShieldAlert,
  ShieldCheck,
  Upload,
  Users,
  Wrench,
} from 'lucide-react';
import { ASSET_STATUS_TOKENS } from '@techpioasset/ui-tokens';
import { PERMISSIONS, isReadOnlyPermission, type AssetStatus, type Permission } from '@techpioasset/domain';
import { apiFetch, apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { StatusBarChart } from '@/components/charts/status-bar-chart';
import { RoleTiles } from '@/components/dashboard/role-tiles';
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
  ROLE_LABELS[key] ?? key.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const SCOPE_LABELS: Record<string, string> = {
  ALL: 'All company data',
  DEPARTMENT: 'Your department',
  DIRECT_REPORTS: 'You & your reports',
  OWN: 'Only your own records',
};

/**
 * KPI tile v2 - a tone accent bar on the left edge carries the state, the
 * number carries the story. Hover lifts, focus rings; the accent doubles as
 * the tile's identity for scanning a row of six.
 */
function Kpi({
  icon,
  tone,
  value,
  label,
  sub,
  href,
}: {
  icon: ReactNode;
  tone: string;
  value: number;
  label: string;
  sub: string;
  href?: string;
}) {
  const body = (
    <div
      className="group relative h-full overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 pl-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: `var(--tone-${tone}-solid)` }}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="text-[27px] font-bold leading-none tracking-tight tabular-nums">
          {value.toLocaleString()}
        </div>
        <span
          className="grid size-8 shrink-0 place-items-center rounded-lg transition group-hover:scale-110"
          style={{ color: `var(--tone-${tone}-fg)`, background: `var(--tone-${tone}-bg)` }}
        >
          {icon}
        </span>
      </div>
      <div className="mt-2.5 text-[13px] font-semibold">{label}</div>
      <div className="mt-0.5 text-xs text-[var(--color-content-subtle)]">{sub}</div>
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * The fleet in one line - a segmented composition bar. Status colors do the
 * status job; identity is never color alone: segments wide enough carry their
 * own percentage, and the legend beneath names every state with its count.
 * 2px surface gaps keep neighbouring fills honest.
 */
function FleetBar({
  segments,
  total,
}: {
  segments: { key: string; label: string; count: number; tone: string }[];
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
          return (
            <div
              key={seg.key}
              title={`${seg.label}: ${seg.count} (${Math.round(pctOf)}%)`}
              className="relative flex items-center justify-center transition-[flex-grow] duration-500"
              style={{
                flexGrow: seg.count,
                flexBasis: 0,
                background: `var(--tone-${seg.tone}-solid)`,
                marginLeft: i === 0 ? 0 : 2,
              }}
            >
              {pctOf >= 8 ? (
                <span className="px-1 text-[11px] font-bold tabular-nums text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.45)]">
                  {Math.round(pctOf)}%
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {visible.map((seg) => (
          <span key={seg.key} className="inline-flex items-center gap-1.5 text-xs">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-[3px]"
              style={{ background: `var(--tone-${seg.tone}-solid)` }}
            />
            <span className="text-[var(--color-content-muted)]">{seg.label}</span>
            <span className="font-semibold tabular-nums">{seg.count.toLocaleString()}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Section heading with a kicker - the bento grid's typographic voice. */
function SectionHead({ kicker, title, action }: { kicker: string; title: string; action?: ReactNode }) {
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
    !!user && user.permissions.length > 0 && user.permissions.every((p) => isReadOnlyPermission(p as Permission));
  const roleLabel = user?.roles?.[0] ? formatRole(user.roles[0]) : null;
  const scopeLabel = scope ? SCOPE_LABELS[scope] : null;
  const isVendor = Boolean(user?.roles?.includes('VENDOR'));
  const quickActions = (
    isVendor ? VENDOR_QUICK_ACTIONS : user?.scope === 'OWN' ? EMPLOYEE_QUICK_ACTIONS : QUICK_ACTIONS
  ).filter(
    (a) => !a.perm || can(a.perm),
  );

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['dashboard-assets'],
    enabled: canSeeAssets,
    queryFn: () => apiFetchPage<AssetRow>('/assets?pageSize=100'),
  });

  // Total spend by category — server-aggregated, and only ever requested for
  // roles that may see cost (Finance / Super Admin).
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
  const total = data?.meta.page.totalItems ?? 0;
  const count = (s: AssetStatus) => assets.filter((a) => a.status === s).length;

  const available = count('AVAILABLE');
  const assigned = count('ASSIGNED') + count('IN_USE');
  const underRepair = count('UNDER_REPAIR');
  const critical = (['DAMAGED', 'LOST', 'STOLEN'] as AssetStatus[]).reduce(
    (n, s) => n + count(s),
    0,
  );
  const retired = (['RETIRED', 'DISPOSED'] as AssetStatus[]).reduce((n, s) => n + count(s), 0);
  const pct = (n: number) => (assets.length ? Math.round((n / assets.length) * 100) : 0);

  const operational = assets.length
    ? Math.round(((assets.length - underRepair - critical - retired) / assets.length) * 100)
    : 100;

  const now = Date.now();
  let w30 = 0,
    w60 = 0,
    w90 = 0,
    covered = 0;
  for (const a of assets) {
    if (!a.warrantyEndDate) {
      covered += 1;
      continue;
    }
    const days = Math.ceil((new Date(a.warrantyEndDate).getTime() - now) / DAY);
    if (days < 0) continue;
    else if (days <= 30) w30 += 1;
    else if (days <= 60) w60 += 1;
    else if (days <= 90) w90 += 1;
    else covered += 1;
  }
  const inMonths = (m: number) =>
    new Date(now + m * 30 * DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  const groupTop = (key: (a: AssetRow) => string | null) => {
    const map = new Map<string, number>();
    for (const a of assets) {
      const k = key(a) ?? 'Unassigned';
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5).reduce((n, [, v]) => n + v, 0);
    const rows = top.map(([name, value], i) => ({ name, value, fill: seriesColor(i) }));
    if (rest > 0) rows.push({ name: 'Other', value: rest, fill: seriesColor(5) });
    return rows;
  };
  const byCategory = groupTop((a) => a.category?.name ?? null);
  const byOffice = groupTop((a) => a.office?.name ?? null);

  const monthCounts = new Map<string, number>();
  for (const a of assets) {
    if (!a.purchaseDate) continue;
    const d = new Date(a.purchaseDate);
    const bucket = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthCounts.set(bucket, (monthCounts.get(bucket) ?? 0) + 1);
  }
  let running = 0;
  const growth = [...monthCounts.keys()]
    .sort()
    .map((m) => {
      running += monthCounts.get(m) ?? 0;
      const [y, mo] = m.split('-');
      return {
        label: new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, {
          month: 'short',
        }),
        value: running,
      };
    })
    .slice(-12);

  const statusData = (Object.keys(ASSET_STATUS_TOKENS) as AssetStatus[])
    .map((s) => ({
      label: ASSET_STATUS_TOKENS[s].label,
      count: count(s),
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
      href: '/assets',
      cta: 'View available',
    },
    critical > 0 && {
      tone: 'critical',
      title: 'Critical assets',
      body: `${critical} asset${critical === 1 ? '' : 's'} damaged, lost or stolen. Investigate and update status.`,
      href: '/assets',
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

  const expiringSoon = assets
    .filter((a) => {
      if (!a.warrantyEndDate) return false;
      const remaining = new Date(a.warrantyEndDate).getTime() - now;
      return remaining > 0 && remaining <= 30 * DAY;
    })
    .slice(0, 6);

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

  const fleetSegments = [
    { key: 'available', label: 'Available', count: available, tone: 'success' },
    { key: 'assigned', label: 'Assigned', count: assigned, tone: 'progress' },
    { key: 'repair', label: 'Under repair', count: underRepair, tone: 'warning' },
    { key: 'critical', label: 'Damaged / lost', count: critical, tone: 'critical' },
    { key: 'retired', label: 'Retired', count: retired, tone: 'neutral' },
  ];

  // The action center: everything asking for a decision, one card, ranked by
  // severity - recommendations first, then the specific devices behind them.
  return (
    <div className="grid gap-6">
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
              {user?.firstName ? `Welcome back, ${user.firstName}` : 'Asset command center'}
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
                <div className="mt-1 text-xs font-medium text-[var(--color-content-muted)]">
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
            <FleetBar segments={fleetSegments} total={assets.length} />
          </div>
        ) : (
          <p className="relative mt-3 max-w-xl text-sm text-[var(--color-content-muted)]">
            {isVendor
              ? 'Your catalogue with this buyer. Add what you are offering, keep prices and stock current, and send new offers for approval.'
              : "Here's what's assigned to you and where you can help. Confirm equipment you have received, and raise a ticket the moment something misbehaves."}
          </p>
        )}
      </section>

      {/* Role-based "what needs me now" tiles (server-scoped). */}
      <section aria-label="For you">
        <RoleTiles />
      </section>

      {isFleetViewer ? (
        <>
          {/* ── KPI band ─────────────────────────────────────────────────── */}
          <section aria-label="Key metrics" className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Kpi icon={<Boxes className="size-[18px]" />} tone="info" value={total} label="Total assets" sub={`${byOffice.length} office${byOffice.length === 1 ? '' : 's'}`} href="/assets" />
            <Kpi icon={<CheckCircle2 className="size-[18px]" />} tone="success" value={available} label="Available" sub={`${pct(available)}% of fleet`} href="/assets?status=AVAILABLE" />
            <Kpi icon={<Users className="size-[18px]" />} tone="progress" value={assigned} label="Assigned" sub={`${pct(assigned)}% of fleet`} href="/assets?status=ASSIGNED" />
            <Kpi icon={<Wrench className="size-[18px]" />} tone="warning" value={underRepair} label="Under repair" sub="in service" href="/maintenance" />
            <Kpi icon={<ShieldAlert className="size-[18px]" />} tone="danger" value={w30} label="Warranty expiring" sub="within 30 days" href="/reports" />
            <Kpi icon={<AlertTriangle className="size-[18px]" />} tone="critical" value={critical} label="Critical" sub="damaged / lost / stolen" href="/assets" />
          </section>

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
                            <span className="text-xs text-[var(--color-content-subtle)]">· {r.count}</span>
                          </span>
                          <span className="font-semibold tabular-nums">
                            {r.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                        <div className="col-span-2 h-1.5 rounded-full bg-[var(--color-surface-sunken)]">
                          <div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${pctOf}%` }} />
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
              {growth.length === 0 ? (
                <EmptyState title="No purchase dates" description="Growth needs dated purchases." />
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
                  <DonutChart data={byCategory} centerValue={total.toLocaleString()} centerLabel="assets" />
                  <Legend
                    items={byCategory.map((c) => ({ name: c.name, value: c.value.toLocaleString(), fill: c.fill }))}
                  />
                </div>
              )}
            </Card>
          </section>

          {/* ── Bento: health + offices + status ─────────────────────────── */}
          <section className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <SectionHead kicker="Health" title="Fleet in service" />
              <Gauge
                percent={operational}
                label={`Operational · ${assets.length - underRepair - critical - retired} devices`}
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
                    items={byOffice.map((o) => ({ name: o.name, pct: `${pct(o.value)}%`, fill: o.fill }))}
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
                  <Link href="/assets" className="text-[13px] font-semibold text-[var(--color-brand)]">
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
                            <span className="block truncate text-[13.5px] font-medium">{a.name}</span>
                            <span className="text-xs text-[var(--color-content-subtle)]">{a.assetTag}</span>
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
                        style={{ color: `var(--tone-${a.tone}-fg)`, background: `var(--tone-${a.tone}-bg)` }}
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
                  <Link href="/reports" className="text-[13px] font-semibold text-[var(--color-brand)]">
                    Renewal report
                  </Link>
                }
              />
              <WarrantyTimeline
                buckets={[
                  { count: w30, label: 'Expiring ≤ 30 days', when: `by ${inMonths(1)}`, color: 'var(--tone-critical-solid)' },
                  { count: w60, label: '31 – 60 days', when: `by ${inMonths(2)}`, color: 'var(--tone-warning-solid)' },
                  { count: w90, label: '61 – 90 days', when: `by ${inMonths(3)}`, color: 'var(--color-brand)' },
                  { count: covered, label: 'Covered / no expiry', when: 'healthy', color: 'var(--tone-success-solid)' },
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
                <EmptyState title="Nothing imminent" description="No warranties end in the next 30 days." />
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {expiringSoon.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                      <div className="min-w-0">
                        <Link href={`/assets/${a.id}`} className="truncate text-[13.5px] font-medium hover:underline">
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
                  Your kit
                </span>
                <h2 className="mt-0.5 text-[16px] font-bold tracking-tight">My equipment</h2>
              </div>
              <Package className="size-4 text-[var(--color-content-subtle)]" />
            </div>
            {myEquipment.length === 0 ? (
              <EmptyState title="No assets yet" description="Equipment issued to you will appear here." />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {myEquipment.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link href={`/assets/${a.id}`} className="truncate text-[13.5px] font-medium hover:underline">
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
                      style={{ color: `var(--tone-${a.tone}-fg)`, background: `var(--tone-${a.tone}-bg)` }}
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
