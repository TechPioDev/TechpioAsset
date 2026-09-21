'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Download, Plus, Search } from 'lucide-react';
import { REQUEST_STATUS_TOKENS } from '@techpioasset/ui-tokens';
import { REQUEST_TYPES } from '@techpioasset/contracts';
import { PERMISSIONS, REQUEST_STATUSES, type RequestStatus } from '@techpioasset/domain';
import { apiFetch, apiFetchPage } from '@/lib/api-client';
import { downloadCsv } from '@/lib/download-csv';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { useSearchParams } from 'next/navigation';

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface RequestRow {
  id: string;
  requestNumber: string;
  type: string;
  status: RequestStatus;
  /** The step it is actually on, when it is on one. */
  currentStep: { name: string; kind: string } | null;
  priority: string;
  businessReason: string;
  estimatedCost: string | null;
  currency: string | null;
  createdAt: string;
  requester: { id: string; email: string; profile: { firstName: string; lastName: string } | null };
  items: { id: string; description: string; quantity: string }[];
}

function RequestsTable() {
  const { can } = useAuth();
  const toast = useToast();
  // v2.26 - seeded from the URL. The dashboard tiles have always linked here
  // with a filter on the query string, and this page ignored it: clicking
  // "Awaiting my approval: 5" landed on every request you can see. The number
  // was right and the destination was not.
  const search$ = useSearchParams();
  const [awaitingMe, setAwaitingMe] = useState(search$.get('awaitingMe') === 'true');
  const [mine, setMine] = useState(search$.get('mine') === 'true');
  const [open, setOpen] = useState(search$.get('open') === 'true');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(search$.get('status') ?? '');
  const [type, setType] = useState(search$.get('type') ?? '');

  // Debounce the search box so we query once the user pauses, not per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (awaitingMe) params.set('awaitingMe', 'true');
  if (mine) params.set('mine', 'true');
  if (open) params.set('open', 'true');
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (type) params.set('type', type);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['requests', awaitingMe, mine, open, page, q, status, type],
    queryFn: () => apiFetchPage<RequestRow>(`/requests?${params.toString()}`),
  });

  // v2.22 - the company request policy plus any exception on this account.
  // Cheap, cached, and answered by the same code the server enforces with.
  const canCreate = useQuery({
    queryKey: ['can-create-request'],
    queryFn: () => apiFetch<{ allowed: boolean; reason?: string }>('/requests/can-create'),
    staleTime: 60_000,
  });

  /**
   * Who gets the "Awaiting me" filter (v2.27).
   *
   * Approving is not the only way a step is cleared: an assessment stage is
   * completed by recording an answer, which needs REQUESTS_ASSESS alone. Gating
   * this on approval hid the filter from the very people an Inventory check is
   * assigned to - so the request sat in their queue with nothing on screen that
   * would show them a queue. The predicate behind the filter already resolves
   * assessment stages; only the control was missing.
   */
  const canSeeOwnQueue = can(PERMISSIONS.REQUESTS_APPROVE) || can(PERMISSIONS.REQUESTS_ASSESS);
  const hasFilters = q !== '' || status !== '' || type !== '';

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Requests</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {awaitingMe
              ? 'Waiting on your decision.'
              : mine && open
                ? 'Your requests that are still in flight.'
                : mine
                  ? 'Requests you raised.'
                  : open
                    ? 'Requests still in flight.'
                    : 'Requests you can see.'}
          </p>
          {mine || open ? (
            <button
              type="button"
              onClick={() => {
                setMine(false);
                setOpen(false);
                setPage(1);
              }}
              className="mt-1 text-xs font-medium text-[var(--color-brand)] hover:underline"
            >
              Show all requests
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {canSeeOwnQueue ? (
            <div
              role="radiogroup"
              aria-label="Filter"
              className="inline-flex rounded-[var(--radius-control)] border border-[var(--color-border-strong)] p-0.5"
            >
              {[
                { label: 'All', value: false },
                { label: 'Awaiting me', value: true },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={awaitingMe === option.value}
                  onClick={() => {
                    setAwaitingMe(option.value);
                    setPage(1);
                  }}
                  className={
                    awaitingMe === option.value
                      ? 'rounded-[calc(var(--radius-control)-2px)] bg-[var(--color-brand)] px-3 py-1.5 text-sm text-[var(--color-brand-contrast)]'
                      : 'px-3 py-1.5 text-sm text-[var(--color-content-muted)]'
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}

          {/* v2.22 - the button follows the same rule the server enforces, and
              when it is off it says why and who to ask rather than vanishing. */}
          {canCreate.data && !canCreate.data.allowed ? (
            <p className="max-w-sm rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3.5 py-2.5 text-sm text-[var(--color-content-muted)]">
              {canCreate.data.reason}
            </p>
          ) : (
            /* A link, not a button with a navigation handler: middle-click and
               "open in new tab" should work. */
            <Link
              href="/requests/new"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-brand-contrast)] hover:bg-[var(--color-brand-hover)]"
            >
              <Plus aria-hidden="true" className="size-4" />
              New request
            </Link>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--color-content-subtle)]"
          />
          <Input
            type="search"
            aria-label="Search requests"
            placeholder="Search by number, item or reason…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-sm"
        >
          <option value="">All statuses</option>
          {REQUEST_STATUSES.map((value) => (
            <option key={value} value={value}>
              {REQUEST_STATUS_TOKENS[value].label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by type"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-sm"
        >
          <option value="">All types</option>
          {REQUEST_TYPES.map((value) => (
            <option key={value} value={value}>
              {titleCase(value)}
            </option>
          ))}
        </select>

        {hasFilters ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSearch('');
              setQ('');
              setStatus('');
              setType('');
              setPage(1);
            }}
          >
            Clear
          </Button>
        ) : null}
        <button
          type="button"
          onClick={async () => {
            const p = new URLSearchParams();
            if (q) p.set('q', q);
            if (status) p.set('status', status);
            if (type) p.set('type', type);
            const ok = await downloadCsv(
              `/requests/export${p.toString() ? `?${p}` : ''}`,
              'requests.csv',
            );
            if (ok) toast.success('Export downloaded');
            else toast.error('Could not export');
          }}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
        >
          <Download aria-hidden="true" className="size-4" />
          Export
        </button>
      </div>

      <Card>
        {isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Could not load requests" detail={(error as Error).message} />
        ) : data.data.length === 0 ? (
          <EmptyState
            title={
              hasFilters
                ? 'No matching requests'
                : awaitingMe
                  ? 'Nothing awaiting you'
                  : 'No requests yet'
            }
            description={
              hasFilters
                ? 'No requests match these filters. Try clearing them.'
                : awaitingMe
                  ? 'Requests appear here when they reach a step you approve.'
                  : 'Raise a request for equipment, furniture or supplies.'
            }
          />
        ) : (
          <>
          {/* v2.70 - on a phone each request is a card: the number and where
              it stands on one line, what was asked for under it, who asked
              and the estimate last. The whole card opens the request - a
              four-column table needed sideways scrolling to reach Status. */}
          <ul className="divide-y divide-[var(--color-border)] sm:hidden">
            {data.data.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/requests/${row.id}`}
                  className="block px-4 py-3 active:bg-[var(--color-surface-sunken)]"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">{row.requestNumber}</span>
                    <StatusBadge
                      token={REQUEST_STATUS_TOKENS[row.status]}
                      size="sm"
                      label={row.currentStep?.name}
                    />
                  </span>
                  <span className="mt-1 line-clamp-2 block text-sm text-[var(--color-content-muted)]">
                    {row.items.map((i) => i.description).join(', ') || 'No items'}
                  </span>
                  <span className="mt-1.5 flex items-center justify-between gap-2 text-xs text-[var(--color-content-subtle)]">
                    <span className="min-w-0 truncate">
                      {row.requester.profile
                        ? `${row.requester.profile.firstName} ${row.requester.profile.lastName}`
                        : row.requester.email}
                    </span>
                    {row.estimatedCost && Number(row.estimatedCost) > 0 ? (
                      <span className="shrink-0 tabular-nums">
                        {row.currency ?? ''} {Number(row.estimatedCost).toLocaleString()}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Requests, {data.meta.page.totalItems} in total</caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Request
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Requester
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Estimate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.data.map((row) => (
                  <tr key={row.id} className="hover:bg-[var(--color-surface-sunken)]">
                    <td className="px-4 py-2.5">
                      <Link href={`/requests/${row.id}`} className="font-medium hover:underline">
                        {row.requestNumber}
                      </Link>
                      <p className="max-w-md truncate text-xs text-[var(--color-content-subtle)]">
                        {row.items.map((i) => i.description).join(', ')}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {row.requester.profile
                        ? `${row.requester.profile.firstName} ${row.requester.profile.lastName}`
                        : row.requester.email}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge
                        token={REQUEST_STATUS_TOKENS[row.status]}
                        size="sm"
                        label={row.currentStep?.name}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {row.estimatedCost && Number(row.estimatedCost) > 0
                        ? `${row.currency ?? ''} ${Number(row.estimatedCost).toLocaleString()}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      {data && data.meta.page.totalPages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          <p className="text-[var(--color-content-subtle)]">
            Page {data.meta.page.page} of {data.meta.page.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= data.meta.page.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

export default function RequestsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <RequestsTable />
    </Suspense>
  );
}
