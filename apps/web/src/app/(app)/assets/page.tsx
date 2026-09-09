'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Plus, X } from 'lucide-react';
import {
  ASSET_STATUS_TOKENS,
  CONDITION_TOKENS,
  LIFECYCLE_STATE_TOKENS,
  AVAILABILITY_STATE_TOKENS,
  OWNERSHIP_TYPE_TOKENS,
} from '@techpioasset/ui-tokens';
import {
  ASSET_STATUSES,
  ASSET_STATUSES_IN_EMPLOYEE_CUSTODY,
  LIFECYCLE_STATES,
  AVAILABILITY_STATES,
  OWNERSHIP_TYPES,
  PERMISSIONS,
  type AssetCondition,
  type AssetStatus,
  type LifecycleState,
  type AvailabilityState,
  type OwnershipType,
} from '@techpioasset/domain';
import type { BulkActionResult } from '@techpioasset/contracts';
import { apiFetch, apiFetchPage } from '@/lib/api-client';
import { downloadCsv } from '@/lib/download-csv';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { SortableHeader } from '@/components/sortable-header';

// Statuses that destroy or retire an asset — a bulk change to one asks first.
const DESTRUCTIVE_STATUSES = new Set(['RETIRED', 'DISPOSED', 'DONATED', 'LOST', 'STOLEN']);

/** Columns the asset list can be ordered by, as the API names them. */
type AssetSortField =
  | 'name'
  | 'category'
  | 'status'
  | 'condition'
  | 'assignedUser'
  | 'purchaseCost';

interface AssetRow {
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
  purchaseCost?: string | null;
  currency?: string | null;
  category: { name: string } | null;
  office: { name: string } | null;
  assignedUser: {
    id: string;
    email: string;
    profile: { firstName: string; lastName: string } | null;
  } | null;
}

function AssetsTable() {
  const params = useSearchParams();
  const [warrantyWithinDays, setWarrantyWithinDays] = useState(
    params.get('warrantyWithinDays') ?? '',
  );
  // v2.53 - the units bought against one catalogue listing. Arrives by link
  // from that listing's rollup, the same way the warranty filter does.
  const [vendorProductId, setVendorProductId] = useState(params.get('vendorProductId') ?? '');
  const { user, can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<string>('');
  // v2.1 Workstream A — the four-dimension filters.
  const [lifecycle, setLifecycle] = useState<string>('');
  const [availability, setAvailability] = useState<string>('');
  const [ownership, setOwnership] = useState<string>('');
  /**
   * v2.23 - "type" is one control covering two filters. Every asset in a fleet
   * can share a category ("IT Assets"), so category alone narrows nothing; but
   * "everything in this category" is still a thing people ask for. The value is
   * prefixed so one <select> can mean either: `sub:<id>` for a type, `cat:<id>`
   * for a whole category.
   */
  const [type, setType] = useState<string>('');
  /**
   * The page opens on laptops, which is what people come here for; everything
   * else is one change of this dropdown away. The type's id is per company, so
   * the default cannot be a constant - it is resolved once the catalogue
   * arrives, and only while the reader has not chosen anything themselves.
   * Choosing "All types" is a choice, so it sticks.
   */
  // Arriving with a filter on the URL counts as a choice: the dashboard's
  // warranty tile counts every asset type, so letting the laptop default apply
  // on top would show a subset of the number that was clicked.
  const [typeChosen, setTypeChosen] = useState(Boolean(params.get('warrantyWithinDays')));
  /**
   * Columns the API can order by, named as the API names them so a heading
   * cannot ask for a sort the server will quietly ignore.
   */
  const [sort, setSort] = useState<AssetSortField | null>(null);
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<string>('');
  const q = params.get('q') ?? '';

  /**
   * One place that turns the filter controls into query parameters, used for
   * both the table and the export. They were built separately, and the export
   * only ever sent q and status - so filtering to monitors and pressing Export
   * downloaded the whole fleet.
   */
  const filterParams = () => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (status) p.set('status', status);
    if (lifecycle) p.set('lifecycleState', lifecycle);
    if (availability) p.set('availabilityState', availability);
    if (ownership) p.set('ownershipType', ownership);
    if (type.startsWith('sub:')) p.set('subcategoryId', type.slice(4));
    if (type.startsWith('cat:')) p.set('categoryId', type.slice(4));
    // v2.26 - carried straight through from the URL. The dashboard's warranty
    // tile links here with it; the page rebuilt its query from its own controls
    // only, so the parameter was dropped and the tile landed on the whole
    // fleet. It arrives by link rather than from a control, so the banner below
    // is what says it is on and what turns it off.
    if (warrantyWithinDays) p.set('warrantyWithinDays', warrantyWithinDays);
    if (vendorProductId) p.set('vendorProductId', vendorProductId);
    return p;
  };

  // Click a heading to sort by it, click again to reverse - and go back to the
  // first page, because page 4 of the old order is meaningless in the new one.
  const toggleSort = (field: AssetSortField) => {
    if (sort === field) {
      setOrder(order === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(field);
      setOrder('asc');
    }
    setPage(1);
  };

  const query = filterParams();
  query.set('page', String(page));
  query.set('pageSize', '25');
  if (sort) {
    query.set('sort', sort);
    query.set('order', order);
  }

  // Types come from the company's own catalogue rather than the domain list, so
  // the dropdown offers what this company actually has.
  const { data: categories, isError: categoriesFailed } = useQuery({
    queryKey: ['categories'],
    queryFn: () =>
      apiFetch<{ id: string; name: string; subcategories: { id: string; name: string }[] }[]>(
        '/categories',
      ),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (typeChosen || !categories) return;
    const laptop = categories
      .flatMap((c) => c.subcategories)
      .find((sub) => sub.name.toLowerCase() === 'laptop');
    if (laptop) setType(`sub:${laptop.id}`);
    setTypeChosen(true);
  }, [categories, typeChosen]);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['assets', q, status, lifecycle, availability, ownership, type, page, sort, order],
    queryFn: () => apiFetchPage<AssetRow>(`/assets?${query.toString()}`),
    // Hold the first fetch until the default type is settled, so the table does
    // not show the whole fleet for a moment and then replace it. If the
    // catalogue cannot be read there is no default to wait for, and an
    // unfiltered table is far better than one that never arrives.
    enabled: typeChosen || categoriesFailed,
  });

  // Cost columns are absent from the payload entirely when the caller lacks
  // assets:cost:read, so the header is driven by the data rather than a guess.
  const showCost = Boolean(data?.data.some((row) => 'purchaseCost' in row));

  // Bulk actions are for roles that can update assets. Selection is per-page and
  // clears whenever the visible set changes so you never act on unseen rows.
  const canBulk = can(PERMISSIONS.ASSETS_UPDATE);
  useEffect(() => {
    setSelected(new Set());
  }, [q, status, lifecycle, availability, ownership, page]);

  const rows = data?.data ?? [];
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const toggleAll = () =>
    setSelected(allOnPageSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulk = useMutation({
    mutationFn: (input: { ids: string[]; status: string }) =>
      apiFetch<BulkActionResult>('/assets/bulk/status', { method: 'POST', body: input }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      setSelected(new Set());
      setBulkStatus('');
      const label = ASSET_STATUS_TOKENS[bulkStatus as AssetStatus]?.label ?? 'updated';
      if (result.failed.length === 0) {
        toast.success(`${result.succeeded.length} asset(s) set to ${label}`);
      } else if (result.succeeded.length === 0) {
        toast.error(`None updated — ${result.failed.length} couldn’t change to ${label}`);
      } else {
        toast.info(
          `${result.succeeded.length} set to ${label}; ${result.failed.length} skipped (invalid change)`,
        );
      }
    },
    onError: () => toast.error('Bulk update failed'),
  });

  const applyBulk = async () => {
    if (!bulkStatus || selected.size === 0) return;
    const label = ASSET_STATUS_TOKENS[bulkStatus as AssetStatus]?.label ?? bulkStatus;
    if (DESTRUCTIVE_STATUSES.has(bulkStatus)) {
      const ok = await confirm({
        title: `Set ${selected.size} asset(s) to ${label}?`,
        body: 'This changes each asset’s lifecycle status. Assets where the change isn’t valid will be skipped.',
        confirmLabel: label,
        destructive: true,
      });
      if (!ok) return;
    }
    bulk.mutate({ ids: [...selected], status: bulkStatus });
  };

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Assets</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {user?.scope === 'OWN'
              ? 'Assets assigned to you.'
              : q
                ? `Results for “${q}”.`
                : 'Everything you are permitted to see.'}
          </p>
          {warrantyWithinDays ? (
            <button
              type="button"
              onClick={() => {
                setWarrantyWithinDays('');
                setPage(1);
              }}
              className="mt-1 text-xs font-medium text-[var(--color-brand)] hover:underline"
            >
              Warranty ending within {warrantyWithinDays} days · show all assets
            </button>
          ) : null}
          {vendorProductId ? (
            <button
              type="button"
              onClick={() => {
                setVendorProductId('');
                setPage(1);
              }}
              className="mt-1 text-xs font-medium text-[var(--color-brand)] hover:underline"
            >
              Bought from one catalogue listing · show all assets
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs">
            <span className="font-medium text-[var(--color-content-muted)]">Type</span>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setTypeChosen(true);
                setPage(1);
              }}
              className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-sm"
            >
              <option value="">All types</option>
              <option value="sub:none">No type set</option>
              {(categories ?? []).map((c) => (
                <optgroup key={c.id} label={c.name}>
                  <option value={`cat:${c.id}`}>All {c.name}</option>
                  {c.subcategories.map((sub) => (
                    <option key={sub.id} value={`sub:${sub.id}`}>
                      {sub.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium text-[var(--color-content-muted)]">Status</span>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-sm"
            >
              <option value="">All statuses</option>
              {ASSET_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {ASSET_STATUS_TOKENS[value].label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium text-[var(--color-content-muted)]">Lifecycle</span>
            <select
              value={lifecycle}
              onChange={(e) => {
                setLifecycle(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-sm"
            >
              <option value="">Any lifecycle</option>
              {LIFECYCLE_STATES.map((value) => (
                <option key={value} value={value}>
                  {LIFECYCLE_STATE_TOKENS[value].label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium text-[var(--color-content-muted)]">Availability</span>
            <select
              value={availability}
              onChange={(e) => {
                setAvailability(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-sm"
            >
              <option value="">Any availability</option>
              {AVAILABILITY_STATES.map((value) => (
                <option key={value} value={value}>
                  {AVAILABILITY_STATE_TOKENS[value].label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium text-[var(--color-content-muted)]">Ownership</span>
            <select
              value={ownership}
              onChange={(e) => {
                setOwnership(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-sm"
            >
              <option value="">Any ownership</option>
              {OWNERSHIP_TYPES.map((value) => (
                <option key={value} value={value}>
                  {OWNERSHIP_TYPE_TOKENS[value].label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={async () => {
              const params = filterParams();
              const ok = await downloadCsv(
                `/assets/export${params.toString() ? `?${params}` : ''}`,
                'assets.csv',
              );
              if (ok) toast.success('Export downloaded');
              else toast.error('Could not export');
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
          >
            <Download aria-hidden="true" className="size-4" />
            Export
          </button>
          {can(PERMISSIONS.ASSETS_IMPORT) ? (
            <Link
              href="/assets/import"
              className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
            >
              <FileSpreadsheet aria-hidden="true" className="size-4" />
              Import Excel
            </Link>
          ) : null}
          {can(PERMISSIONS.ASSETS_CREATE) ? (
            <Link
              href="/assets/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-3 text-sm font-semibold text-[var(--color-brand-contrast)] hover:bg-[var(--color-brand-hover)]"
            >
              <Plus aria-hidden="true" className="size-4" />
              Add asset
            </Link>
          ) : null}
        </div>
      </header>

      {canBulk && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-[var(--color-brand)] bg-[var(--color-brand-subtle,var(--color-surface-sunken))] px-4 py-2.5">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="bulk-status">
              Set status for selected assets
            </label>
            <select
              id="bulk-status"
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-sm"
            >
              <option value="">Set status to…</option>
              {/* No custody statuses here: "Assigned" and "In use" are earned
                  through the Assign flow, which records who holds the device -
                  a bulk dropdown can only declare them, and a declared one is an
                  asset assigned to nobody. RETURNED likewise belongs to the
                  Return action, which closes the assignment it ends. */}
              {ASSET_STATUSES.filter(
                (value) =>
                  value !== 'RETURNED' && !ASSET_STATUSES_IN_EMPLOYEE_CUSTODY.includes(value),
              ).map((value) => (
                <option key={value} value={value}>
                  {ASSET_STATUS_TOKENS[value].label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={!bulkStatus || bulk.isPending}
              loading={bulk.isPending}
              onClick={applyBulk}
            >
              Apply
            </Button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              aria-label="Clear selection"
              className="grid size-8 place-items-center rounded-[var(--radius-control)] text-[var(--color-content-muted)] hover:bg-[var(--color-surface)]"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>
      ) : null}

      <Card>
        {isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Could not load assets" detail={(error as Error).message} />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="No assets found"
            description={
              q || status
                ? 'Try clearing the search or status filter.'
                : 'Nothing has been assigned to you yet.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Assets, {data.meta.page.totalItems} in total, page {data.meta.page.page} of{' '}
                {data.meta.page.totalPages}
              </caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  {canBulk ? (
                    <th scope="col" className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        checked={allOnPageSelected}
                        onChange={toggleAll}
                        className="size-4 rounded border-[var(--color-border-strong)] align-middle"
                      />
                    </th>
                  ) : null}
                  <SortableHeader label="Asset" field="name" sort={sort} order={order} onSort={toggleSort} />
                  <SortableHeader label="Category" field="category" sort={sort} order={order} onSort={toggleSort} />
                  <SortableHeader label="Status" field="status" sort={sort} order={order} onSort={toggleSort} />
                  <SortableHeader label="Condition" field="condition" sort={sort} order={order} onSort={toggleSort} />
                  <SortableHeader label="Assigned to" field="assignedUser" sort={sort} order={order} onSort={toggleSort} />
                  {/* Only offered to those who can read the figures. Ordering by
                      a hidden column would still reveal which kit is dearest. */}
                  {showCost ? (
                    <SortableHeader
                      label="Cost"
                      field="purchaseCost"
                      sort={sort}
                      order={order}
                      onSort={toggleSort}
                      align="right"
                    />
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.data.map((asset) => (
                  <tr
                    key={asset.id}
                    className={
                      selected.has(asset.id)
                        ? 'bg-[var(--color-surface-sunken)]'
                        : 'hover:bg-[var(--color-surface-sunken)]'
                    }
                  >
                    {canBulk ? (
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Select ${asset.name}`}
                          checked={selected.has(asset.id)}
                          onChange={() => toggleOne(asset.id)}
                          className="size-4 rounded border-[var(--color-border-strong)] align-middle"
                        />
                      </td>
                    ) : null}
                    <td className="px-4 py-2.5">
                      <Link href={`/assets/${asset.id}`} className="font-medium hover:underline">
                        {asset.name}
                      </Link>
                      <p className="text-xs text-[var(--color-content-subtle)]">
                        {asset.assetTag}
                        {asset.serialNumber ? ` · ${asset.serialNumber}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {asset.category?.name ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge token={ASSET_STATUS_TOKENS[asset.status]} size="sm" />
                        {asset.lifecycleState ? (
                          <StatusBadge
                            token={LIFECYCLE_STATE_TOKENS[asset.lifecycleState]}
                            size="sm"
                            showIcon={false}
                          />
                        ) : null}
                        {asset.availabilityState ? (
                          <StatusBadge
                            token={AVAILABILITY_STATE_TOKENS[asset.availabilityState]}
                            size="sm"
                            showIcon={false}
                          />
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge
                          token={CONDITION_TOKENS[asset.condition]}
                          size="sm"
                          showIcon={false}
                        />
                        {asset.ownershipType ? (
                          <StatusBadge
                            token={OWNERSHIP_TYPE_TOKENS[asset.ownershipType]}
                            size="sm"
                            showIcon={false}
                          />
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {asset.assignedUser?.profile
                        ? `${asset.assignedUser.profile.firstName} ${asset.assignedUser.profile.lastName}`
                        : (asset.assignedUser?.email ?? '—')}
                    </td>
                    {showCost ? (
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {asset.purchaseCost
                          ? `${asset.currency ?? ''} ${Number(asset.purchaseCost).toLocaleString()}`
                          : '—'}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data && data.meta.page.totalPages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          <p className="text-[var(--color-content-subtle)]">
            Page {data.meta.page.page} of {data.meta.page.totalPages}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= data.meta.page.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

export default function AssetsPage() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <AssetsTable />
    </Suspense>
  );
}
