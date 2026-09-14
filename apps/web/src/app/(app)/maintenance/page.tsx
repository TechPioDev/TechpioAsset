'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, User } from 'lucide-react';
import { apiFetchPage } from '@/lib/api-client';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { SchedulesPanel } from '@/components/maintenance/schedules-panel';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/providers/auth-provider';

/**
 * v2.5 H5 — the work-order board. Open work grouped by status with SLA
 * indicators: an overdue deadline reads red, an escalated order says so.
 * Closed work keeps the table treatment below the board.
 */

interface MaintenanceRow {
  id: string;
  type: string;
  status: string;
  title: string;
  scheduledFor: string | null;
  completedAt: string | null;
  technicianId: string | null;
  slaDueAt: string | null;
  escalatedAt: string | null;
  asset: { id: string; assetTag: string; name: string } | null;
  vendor: { id: string; name: string } | null;
}

const COLUMNS = [
  { key: 'REQUESTED', label: 'Requested', tone: 'neutral' },
  { key: 'SCHEDULED', label: 'Scheduled', tone: 'info' },
  { key: 'IN_PROGRESS', label: 'In progress', tone: 'warning' },
  { key: 'ON_HOLD', label: 'On hold', tone: 'neutral' },
] as const;

const CLOSED = new Set(['COMPLETED', 'CANCELLED', 'FAILED']);

const CLOSED_TONE: Record<string, string> = {
  COMPLETED: 'success',
  CANCELLED: 'muted',
  FAILED: 'critical',
};

function slaBadge(row: MaintenanceRow) {
  if (!row.slaDueAt) return null;
  const overdue = new Date(row.slaDueAt).getTime() < Date.now();
  const label = overdue
    ? `SLA overdue · ${new Date(row.slaDueAt).toLocaleDateString()}`
    : `SLA ${new Date(row.slaDueAt).toLocaleDateString()}`;
  const tone = overdue ? 'critical' : 'info';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{
        color: `var(--tone-${tone}-fg)`,
        backgroundColor: `var(--tone-${tone}-bg)`,
        borderColor: `var(--tone-${tone}-border)`,
      }}
    >
      {overdue ? <AlertTriangle aria-hidden="true" className="size-3" /> : null}
      {label}
    </span>
  );
}

function MaintenanceBoard() {
  const [view, setView] = useState<'board' | 'schedules'>('board');
  // v2.26 - the dashboard's "Open maintenance" tile links here with ?open=true;
  // without reading it the count and the destination disagreed.
  const params = useSearchParams();
  const [openOnly] = useState(params.get('open') === 'true');
  // "Mine" - the phone's technician filter: work orders assigned to me. Read
  // from the URL on every render so the choice survives a reload and a link.
  const { user } = useAuth();
  const mine = params.get('mine') === '1';
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['maintenance', openOnly, mine ? (user?.id ?? null) : null],
    enabled: !mine || Boolean(user),
    queryFn: () =>
      apiFetchPage<MaintenanceRow>(
        `/maintenance?pageSize=100${openOnly ? '&open=true' : ''}${mine ? `&technicianId=${encodeURIComponent(user!.id)}` : ''}`,
      ),
  });

  if (view === 'schedules') {
    return (
      <div className="grid gap-4">
        <MaintenanceHeader view={view} setView={setView} />
        <SchedulesPanel />
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-56" />
        ))}
      </div>
    );
  }
  if (isError) {
    return <ErrorState title="Could not load maintenance" detail={(error as Error).message} />;
  }

  const open = data.data.filter((row) => !CLOSED.has(row.status));
  if (mine) {
    // As on the phone: the jobs on my plate, SLA-overdue first, then the
    // soonest deadline. The shared "All open" board keeps the API's order.
    open.sort((a, b) => {
      const overdue = Number(isSlaOverdue(b)) - Number(isSlaOverdue(a));
      if (overdue !== 0) return overdue;
      const dueA = a.slaDueAt ? new Date(a.slaDueAt).getTime() : Infinity;
      const dueB = b.slaDueAt ? new Date(b.slaDueAt).getTime() : Infinity;
      return dueA - dueB;
    });
  }
  const closed = data.data.filter((row) => CLOSED.has(row.status)).slice(0, 15);

  return (
    <div className="grid gap-4">
      <MaintenanceHeader view={view} setView={setView} />
      <ScopeFilter mine={mine} />

      {open.length === 0 ? (
        <EmptyState
          title={mine ? 'No open work orders assigned to you' : 'No open work orders'}
          description={
            mine
              ? 'Work orders assigned to you appear here. Switch to All open to see the whole queue.'
              : 'Repairs and inspections appear here.'
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((column) => {
            const rows = open.filter((row) => row.status === column.key);
            return (
              <section key={column.key} aria-label={`${column.label}, ${rows.length} work orders`}>
                <h2 className="flex items-center justify-between px-1 pb-2 text-sm font-semibold">
                  {column.label}
                  <span
                    className="rounded-full px-2 py-0.5 text-xs tabular-nums"
                    style={{
                      color: `var(--tone-${column.tone}-fg)`,
                      backgroundColor: `var(--tone-${column.tone}-bg)`,
                    }}
                  >
                    {rows.length}
                  </span>
                </h2>
                <div className="grid gap-2">
                  {rows.length === 0 ? (
                    <p className="rounded-[var(--radius-control)] border border-dashed border-[var(--color-border)] p-3 text-center text-xs text-[var(--color-content-subtle)]">
                      Nothing here
                    </p>
                  ) : (
                    rows.map((row) => (
                      <Link key={row.id} href={`/maintenance/${row.id}`} className="block">
                        <Card className="grid gap-1.5 p-3 transition-colors hover:border-[var(--color-border-strong)]">
                          <p className="text-sm font-medium leading-snug">{row.title}</p>
                          <p className="text-xs text-[var(--color-content-subtle)]">
                            {row.asset?.assetTag ?? '—'} · {row.type.toLowerCase()}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {slaBadge(row)}
                            {row.escalatedAt ? (
                              <span
                                className="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium"
                                style={{
                                  color: 'var(--tone-critical-fg)',
                                  backgroundColor: 'var(--tone-critical-bg)',
                                  borderColor: 'var(--tone-critical-border)',
                                }}
                              >
                                escalated
                              </span>
                            ) : null}
                            {row.technicianId ? (
                              <span className="inline-flex items-center gap-1 text-xs text-[var(--color-content-subtle)]">
                                <User aria-hidden="true" className="size-3" /> assigned
                              </span>
                            ) : null}
                          </div>
                        </Card>
                      </Link>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {closed.length > 0 ? (
        <Card>
          <h2 className="border-b border-[var(--color-border)] px-4 py-3 text-sm font-semibold">
            Recently closed
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Recently closed work orders</caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th scope="col" className="px-4 py-2.5 font-medium">Work</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Asset</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Outcome</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Closed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {closed.map((row) => (
                  <tr key={row.id} className="hover:bg-[var(--color-surface-sunken)]">
                    <td className="px-4 py-2.5">
                      <Link href={`/maintenance/${row.id}`} className="font-medium hover:underline">
                        {row.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {row.asset?.assetTag ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="inline-flex rounded-full border px-2 py-0.5 text-xs"
                        style={{
                          color: `var(--tone-${CLOSED_TONE[row.status] ?? 'neutral'}-fg)`,
                          backgroundColor: `var(--tone-${CLOSED_TONE[row.status] ?? 'neutral'}-bg)`,
                          borderColor: `var(--tone-${CLOSED_TONE[row.status] ?? 'neutral'}-border)`,
                        }}
                      >
                        {row.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {row.completedAt ? new Date(row.completedAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function isSlaOverdue(row: MaintenanceRow): boolean {
  return row.slaDueAt != null && new Date(row.slaDueAt).getTime() < Date.now() && !CLOSED.has(row.status);
}

/**
 * Mine / All open (?mine=1), the same two scopes as the phone's work-order
 * list. Other query parameters - the dashboard tile's ?open=true - ride along.
 */
function ScopeFilter({ mine }: { mine: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function choose(next: boolean) {
    const query = new URLSearchParams(params.toString());
    if (next) query.set('mine', '1');
    else query.delete('mine');
    const qs = query.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div role="group" aria-label="Which work orders" className="flex gap-1.5">
      {(
        [
          [true, 'Mine'],
          [false, 'All open'],
        ] as const
      ).map(([value, label]) => (
        <button
          key={label}
          type="button"
          aria-pressed={mine === value}
          onClick={() => choose(value)}
          className={
            mine === value
              ? 'rounded-full border border-[var(--color-brand)] bg-[var(--color-brand)] px-3 py-1 text-sm font-semibold text-[var(--color-brand-contrast)]'
              : 'rounded-full border border-[var(--color-border-strong)] px-3 py-1 text-sm font-medium text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]'
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Board / schedules switch shared by both views. */
function MaintenanceHeader({
  view,
  setView,
}: {
  view: 'board' | 'schedules';
  setView: (v: 'board' | 'schedules') => void;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Maintenance</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          {view === 'board'
            ? 'Work orders across the estate — overdue SLAs read red and escalate once, automatically.'
            : 'Recurring service. The daily sweep raises each schedule’s work order when it falls due.'}
        </p>
      </div>
      <div role="tablist" aria-label="Maintenance view" className="flex gap-1">
        {(
          [
            ['board', 'Work orders'],
            ['schedules', 'Schedules'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={
              view === key
                ? 'rounded-[var(--radius-control)] bg-[var(--color-brand)] px-3 py-1.5 text-sm font-semibold text-white'
                : 'rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]'
            }
          >
            {label}
          </button>
        ))}
      </div>
    </header>
  );
}

/**
 * useSearchParams needs a Suspense boundary at the route level, so the board is
 * its own component and the page provides one.
 */
export default function MaintenancePage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <MaintenanceBoard />
    </Suspense>
  );
}
