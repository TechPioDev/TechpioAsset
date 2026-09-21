'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, PackagePlus, Plus } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { ApiError, apiFetch, apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, EmptyState, ErrorState, Field, NativeSelect, Skeleton } from '@/components/ui';
import { TonePill, fmtDate, inputCls } from '@/components/procurement/shared';

interface Level {
  id: string;
  quantity: string;
  reserved: string;
  inventoryItem: { id: string; sku: string; name: string; unit: string; minStock: string | null };
  stockLocation: { id: string; code: string; name: string };
}
interface Movement {
  id: string;
  type: string;
  quantity: string;
  reason: string | null;
  refType: string | null;
  createdAt: string;
  inventoryItem: { sku: string; name: string };
  stockLocationId: string;
}
interface Location {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  _count: { levels: number };
}
/** v2.9 C4 - a lot of one item at one location. */
interface Batch {
  id: string;
  batchNumber: string;
  quantity: string;
  expiryDate: string | null;
  receivedAt: string;
  expiryState: 'OK' | 'EXPIRING_SOON' | 'EXPIRED' | 'NO_EXPIRY';
  inventoryItem: { id: string; sku: string; name: string };
  stockLocation: { id: string; name: string };
}
interface Item {
  id: string;
  sku: string;
  name: string;
}
interface Category {
  id: string;
  name: string;
  defaultTrackingType: 'INDIVIDUAL' | 'QUANTITY';
  subcategories: { id: string; name: string }[];
}

const MOVEMENT_TONE: Record<string, string> = {
  RECEIPT: 'success',
  ISSUE: 'progress',
  ADJUST_UP: 'info',
  ADJUST_DOWN: 'warning',
  TRANSFER_IN: 'info',
  TRANSFER_OUT: 'warning',
  CONVERT_TO_ASSET: 'neutral',
};

export default function InventoryPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'levels' | 'batches' | 'ledger' | 'locations'>('levels');

  // Add / adjust / transfer form state (inline panel, one at a time). "add" is
  // an adjustment with a positive delta - the same audited ledger path, framed
  // as the everyday act of putting stock on a shelf.
  const [action, setAction] = useState<'add' | 'adjust' | 'transfer' | null>(null);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [itemId, setItemId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState('');

  // v2.9 C4 - lots on the shelf, soonest expiry first.
  const batches = useQuery({
    queryKey: ['stock-batches'],
    queryFn: () => apiFetch<Batch[]>('/stock/batches'),
  });
  const levels = useQuery({
    queryKey: ['stock-levels'],
    // v2.10 S2: paginated — one row per item/location pair grows as the product.
    queryFn: () => apiFetchPage<Level>('/stock/levels?pageSize=50'),
  });
  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => apiFetch<Location[]>('/stock/locations'),
  });
  const items = useQuery({
    queryKey: ['stock-items'],
    queryFn: () => apiFetch<Item[]>('/stock/items'),
  });
  const ledger = useQuery({
    queryKey: ['stock-ledger'],
    queryFn: () => apiFetchPage<Movement>('/stock/movements?pageSize=50'),
    enabled: tab === 'ledger',
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['stock-levels'] });
    void qc.invalidateQueries({ queryKey: ['stock-ledger'] });
  };

  const run = useMutation({
    mutationFn: () => {
      if (action === 'adjust' || action === 'add') {
        return apiFetch('/stock/adjust', {
          method: 'POST',
          body: {
            inventoryItemId: itemId,
            stockLocationId: locationId,
            delta: action === 'add' ? Math.abs(amount) : amount,
            reason: reason.trim(),
          },
        });
      }
      return apiFetch('/stock/transfer', {
        method: 'POST',
        body: {
          inventoryItemId: itemId,
          fromLocationId: locationId,
          toLocationId,
          quantity: Math.abs(amount),
          note: reason.trim() || null,
        },
      });
    },
    onSuccess: () => {
      toast.success(action === 'add' ? 'Stock added' : action === 'adjust' ? 'Stock adjusted' : 'Stock transferred');
      setAction(null);
      setReason('');
      refresh();
    },
    // Guarded refusals (insufficient stock, reservations) speak verbatim.
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update stock'),
  });

  const canAdjust = can(PERMISSIONS.INVENTORY_ADJUST);
  const canTransfer = can(PERMISSIONS.INVENTORY_TRANSFER);
  const validForm =
    itemId &&
    locationId &&
    (action === 'add'
      ? Number.isInteger(amount) && amount > 0 && reason.trim().length >= 5
      : action === 'adjust'
        ? amount !== 0 && reason.trim().length >= 5
        : amount > 0 && toLocationId && toLocationId !== locationId);

  /** Open the add-stock panel, optionally preset to one item and shelf. */
  const openAdd = (preset?: { itemId: string; locationId?: string }) => {
    setAction('add');
    setAmount(1);
    setReason('');
    if (preset) {
      setItemId(preset.itemId);
      if (preset.locationId) setLocationId(preset.locationId);
    }
  };
  const noItems = items.isSuccess && items.data.length === 0;
  const noLocations = locations.isSuccess && locations.data.length === 0;

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--color-content-subtle)]">
            Warehouse
          </span>
          <h1 className="mt-1 flex items-center gap-2 text-[24px] font-bold tracking-tight">
            <Boxes className="size-6 text-[var(--color-brand)]" /> Inventory
          </h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            The movement ledger is the record; levels are its rollup, never edited directly.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canAdjust ? (
            <Button variant="secondary" onClick={() => setNewItemOpen(true)}>
              <Plus className="size-4" /> New item
            </Button>
          ) : null}
          {canAdjust ? (
            <Button onClick={() => (action === 'add' ? setAction(null) : openAdd())}>
              <PackagePlus className="size-4" /> Add stock
            </Button>
          ) : null}
          {canAdjust ? (
            <Button variant="ghost" onClick={() => setAction(action === 'adjust' ? null : 'adjust')}>
              Adjust
            </Button>
          ) : null}
          {canTransfer ? (
            <Button variant="ghost" onClick={() => setAction(action === 'transfer' ? null : 'transfer')}>
              Transfer
            </Button>
          ) : null}
        </div>
      </header>

      {newItemOpen ? (
        <NewItemDialog
          canEnterCost={can(PERMISSIONS.ASSETS_COST_READ)}
          onClose={() => setNewItemOpen(false)}
          onCreated={(created) => {
            setNewItemOpen(false);
            void qc.invalidateQueries({ queryKey: ['stock-items'] });
            // Straight on to the next thing anyone does with a new item.
            openAdd({ itemId: created.id });
          }}
        />
      ) : null}

      {action && (noItems || noLocations) && action !== 'transfer' ? (
        <Card className="p-4 text-sm text-[var(--color-content-muted)]">
          {noItems ? 'There are no stock items yet - create one with “New item” first. ' : ''}
          {noLocations
            ? can(PERMISSIONS.INVENTORY_LOCATIONS_MANAGE)
              ? 'There are no stock locations yet - add one on the Locations tab.'
              : 'There are no stock locations yet - ask an Inventory Manager to add one.'
            : ''}
        </Card>
      ) : null}

      {action ? (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          {action === 'add' ? (
            <p className="w-full text-[13px] font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
              Add stock to a location
            </p>
          ) : null}
          <div>
            <label htmlFor="inv-item" className="mb-1 block text-[13px] font-medium">Item</label>
            <select id="inv-item" value={itemId} onChange={(e) => setItemId(e.target.value)} className={inputCls}>
              <option value="">Choose…</option>
              {(items.data ?? []).map((i) => (
                <option key={i.id} value={i.id}>{i.name} · {i.sku}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="inv-loc" className="mb-1 block text-[13px] font-medium">
              {action === 'transfer' ? 'From location' : 'Location'}
            </label>
            <select id="inv-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
              <option value="">Choose…</option>
              {(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          {action === 'transfer' ? (
            <div>
              <label htmlFor="inv-to" className="mb-1 block text-[13px] font-medium">To location</label>
              <select id="inv-to" value={toLocationId} onChange={(e) => setToLocationId(e.target.value)} className={inputCls}>
                <option value="">Choose…</option>
                {(locations.data ?? [])
                  .filter((l) => l.id !== locationId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
              </select>
            </div>
          ) : null}
          <div>
            <label htmlFor="inv-qty" className="mb-1 block text-[13px] font-medium">
              {action === 'adjust' ? 'Delta (+/−)' : action === 'add' ? 'Quantity to add' : 'Quantity'}
            </label>
            <input
              id="inv-qty"
              type="number"
              min={action === 'adjust' ? undefined : 1}
              step={action === 'add' ? 1 : undefined}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className={`${inputCls} w-28`}
            />
          </div>
          <div className="min-w-56 flex-1">
            <label htmlFor="inv-reason" className="mb-1 block text-[13px] font-medium">
              {action === 'transfer' ? 'Note' : 'Reason (required)'}
            </label>
            <input
              id="inv-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                action === 'add'
                  ? 'e.g. Opening stock count, bought locally'
                  : action === 'adjust'
                    ? 'Adjustments are audited'
                    : 'Optional'
              }
              className={inputCls}
            />
          </div>
          <Button loading={run.isPending} disabled={!validForm} onClick={() => run.mutate()}>
            <Plus className="size-4" />{' '}
            {action === 'add' ? 'Add stock' : action === 'adjust' ? 'Post adjustment' : 'Move stock'}
          </Button>
        </Card>
      ) : null}

      <div role="tablist" aria-label="Inventory sections" className="flex gap-1 border-b border-[var(--color-border)]">
        {(
          [
            ['levels', 'Stock levels'],
            ['batches', 'Lots & expiry'],
            ['ledger', 'Ledger'],
            ['locations', 'Locations'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              tab === key
                ? 'border-[var(--color-brand)] text-[var(--color-brand)]'
                : 'border-transparent text-[var(--color-content-muted)] hover:text-[var(--color-content)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'levels' ? (
        levels.isPending ? (
          <Skeleton className="h-64" />
        ) : levels.isError ? (
          <ErrorState title="Could not load stock" detail={(levels.error as Error).message} />
        ) : levels.data.data.length === 0 ? (
          <Card className="p-8">
            <EmptyState
              title="No stock yet"
              description={
                canAdjust
                  ? noItems
                    ? 'Create your first stock item, then add the quantity you have on the shelf.'
                    : 'Add stock to a location, or receive a purchase order into one.'
                  : 'Receive a purchase order into a location, or post an adjustment.'
              }
              action={
                canAdjust ? (
                  noItems ? (
                    <Button onClick={() => setNewItemOpen(true)}>
                      <Plus className="size-4" /> New item
                    </Button>
                  ) : (
                    <Button onClick={() => openAdd()}>
                      <PackagePlus className="size-4" /> Add stock
                    </Button>
                  )
                ) : undefined
              }
            />
          </Card>
        ) : (
          <>
          {/* v2.71 - on a phone each stock level is a card: the item and where
              it is, the three numbers in a row, and Add on the card. */}
          <Card className="p-0 sm:hidden">
            <ul className="divide-y divide-[var(--color-border)]">
              {levels.data.data.map((l) => {
                const qty = Number(l.quantity);
                const reserved = Number(l.reserved);
                const low =
                  l.inventoryItem.minStock !== null && qty <= Number(l.inventoryItem.minStock);
                return (
                  <li key={l.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{l.inventoryItem.name}</p>
                        <p className="truncate text-xs text-[var(--color-content-subtle)]">
                          {l.inventoryItem.sku} · {l.stockLocation.name}
                        </p>
                      </div>
                      {canAdjust ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={`Add stock of ${l.inventoryItem.name} at ${l.stockLocation.name}`}
                          onClick={() => {
                            openAdd({ itemId: l.inventoryItem.id, locationId: l.stockLocation.id });
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                        >
                          <PackagePlus className="size-3.5" /> Add
                        </Button>
                      ) : null}
                    </div>
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <dt className="text-[var(--color-content-subtle)]">On hand</dt>
                        <dd className="text-sm tabular-nums">
                          {qty} {low ? <TonePill label="low" tone="warning" /> : null}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--color-content-subtle)]">Reserved</dt>
                        <dd className="text-sm tabular-nums">{reserved}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--color-content-subtle)]">Available</dt>
                        <dd className="text-sm font-semibold tabular-nums">
                          {Math.max(0, qty - reserved)}
                        </dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card className="hidden overflow-x-auto p-0 sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-content-subtle)]">
                  <th className="px-4 py-3 font-semibold">Item</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">On hand</th>
                  <th className="px-4 py-3 font-semibold">Reserved</th>
                  <th className="px-4 py-3 font-semibold">Available</th>
                  {canAdjust ? (
                    <th className="px-4 py-3 font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {levels.data.data.map((l) => {
                  const qty = Number(l.quantity);
                  const reserved = Number(l.reserved);
                  const low = l.inventoryItem.minStock !== null && qty <= Number(l.inventoryItem.minStock);
                  return (
                    <tr key={l.id} className="hover:bg-[var(--color-surface-sunken)]">
                      <td className="px-4 py-3">
                        {l.inventoryItem.name}
                        <p className="text-xs text-[var(--color-content-subtle)]">{l.inventoryItem.sku}</p>
                      </td>
                      <td className="px-4 py-3 text-[var(--color-content-muted)]">{l.stockLocation.name}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {qty} {low ? <TonePill label="low" tone="warning" /> : null}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{reserved}</td>
                      <td className="px-4 py-3 font-semibold tabular-nums">{Math.max(0, qty - reserved)}</td>
                      {canAdjust ? (
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Add stock of ${l.inventoryItem.name} at ${l.stockLocation.name}`}
                            onClick={() => {
                              openAdd({ itemId: l.inventoryItem.id, locationId: l.stockLocation.id });
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                          >
                            <PackagePlus className="size-3.5" /> Add
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          </>
        )
      ) : null}

      {tab === 'batches' ? (
        batches.isPending ? (
          <Skeleton className="h-64" />
        ) : batches.isError ? (
          <ErrorState title="Could not load lots" detail={(batches.error as Error).message} />
        ) : batches.data.length === 0 ? (
          <Card className="p-8">
            <EmptyState
              title="No lots on the shelf"
              description="Lots appear when a batch-tracked item is received with the batch number from the box."
            />
          </Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-content-subtle)]">
                  <th className="px-4 py-3 font-semibold">Lot</th>
                  <th className="px-4 py-3 font-semibold">Item</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">On hand</th>
                  <th className="px-4 py-3 font-semibold">Expires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {batches.data.map((b) => (
                  <tr key={b.id} className="hover:bg-[var(--color-surface-sunken)]">
                    <td className="px-4 py-3 font-medium">{b.batchNumber}</td>
                    <td className="px-4 py-3">
                      {b.inventoryItem.name}
                      <p className="text-xs text-[var(--color-content-subtle)]">{b.inventoryItem.sku}</p>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-content-muted)]">{b.stockLocation.name}</td>
                    <td className="px-4 py-3 tabular-nums">{Number(b.quantity)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[var(--color-content-muted)]">{fmtDate(b.expiryDate)}</span>
                        {b.expiryState === 'EXPIRED' ? <TonePill label="expired" tone="critical" /> : null}
                        {b.expiryState === 'EXPIRING_SOON' ? <TonePill label="expiring" tone="warning" /> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-content-subtle)]">
              Issuing draws on these lots oldest-expiry-first. Expired stock is refused unless somebody
              records a reason for using it anyway.
            </p>
          </Card>
        )
      ) : null}

      {tab === 'ledger' ? (
        ledger.isPending ? (
          <Skeleton className="h-64" />
        ) : ledger.isError ? (
          <ErrorState title="Could not load the ledger" detail={(ledger.error as Error).message} />
        ) : (
          <Card className="p-0">
            {ledger.data!.data.length === 0 ? (
              <EmptyState title="No movements yet" description="Every stock change lands here, append-only." />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {ledger.data!.data.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate">
                        <TonePill label={m.type} tone={MOVEMENT_TONE[m.type] ?? 'neutral'} />{' '}
                        <span className="font-medium">{m.inventoryItem.name}</span>{' '}
                        <span className="tabular-nums">× {Number(m.quantity)}</span>
                      </p>
                      <p className="text-xs text-[var(--color-content-subtle)]">
                        {m.reason ?? m.refType ?? ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--color-content-subtle)]">
                      {new Date(m.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )
      ) : null}

      {tab === 'locations' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(locations.data ?? []).map((l) => (
            <Card key={l.id} className="p-4">
              <p className="font-semibold">{l.name}</p>
              <p className="text-xs text-[var(--color-content-subtle)]">
                {l.code} · {l._count.levels} item(s) {l.isActive ? '' : '· inactive'}
              </p>
            </Card>
          ))}
          {can(PERMISSIONS.INVENTORY_LOCATIONS_MANAGE) ? <NewLocationCard onCreated={() => void qc.invalidateQueries({ queryKey: ['stock-locations'] })} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A new item in the stock catalogue. Describes the item only - quantity is
 * added afterwards through the audited adjust path, which this dialog hands
 * straight on to. Purchase cost is shown only to roles that may see money.
 */
function NewItemDialog({
  canEnterCost,
  onClose,
  onCreated,
}: {
  canEnterCost: boolean;
  onClose: () => void;
  onCreated: (item: { id: string; name: string }) => void;
}) {
  const toast = useToast();
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<Category[]>('/categories'),
  });
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('unit');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [minStock, setMinStock] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Quantity-tracked categories first: they are the ones stock is kept in.
  const sorted = [...(categories.data ?? [])].sort(
    (a, b) => Number(b.defaultTrackingType === 'QUANTITY') - Number(a.defaultTrackingType === 'QUANTITY'),
  );
  const subcategories = sorted.find((c) => c.id === categoryId)?.subcategories ?? [];

  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; name: string }>('/stock/items', {
        method: 'POST',
        body: {
          name: name.trim(),
          sku: sku.trim(),
          unit: unit.trim() || 'unit',
          categoryId,
          ...(subcategoryId ? { subcategoryId } : {}),
          ...(minStock.trim() !== '' ? { minStock: Number(minStock) } : {}),
          ...(canEnterCost && unitCost.trim() ? { unitCost: unitCost.trim(), currency: 'INR' } : {}),
        },
      }),
    onSuccess: (item) => {
      toast.success(`${item.name} added to the catalogue`);
      onCreated(item);
    },
    onError: (e) => {
      if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
      toast.error(e instanceof Error ? e.message : 'Could not create the item');
    },
  });

  const minStockBad = minStock.trim() !== '' && !(Number(minStock) >= 0);
  const costBad = canEnterCost && unitCost.trim() !== '' && !/^\d{1,12}(\.\d{1,2})?$/.test(unitCost.trim());
  const valid = name.trim().length >= 2 && sku.trim().length >= 2 && categoryId && !minStockBad && !costBad;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="New stock item">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl">
        <h2 className="text-[15px] font-semibold">New stock item</h2>
        <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
          Adds the item to the catalogue. You add the quantity on the shelf next, with a reason - every
          unit is recorded in the ledger.
        </p>
        <form
          className="mt-4 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) create.mutate();
          }}
        >
          <Field label="Name" htmlFor="ni-name" error={fieldErrors.name}>
            <input id="ni-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HDMI cable 2m" className={inputCls} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="SKU" htmlFor="ni-sku" hint="Unique in your company" error={fieldErrors.sku}>
              <input id="ni-sku" value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} placeholder="CAB-HDMI-2M" className={inputCls} />
            </Field>
            <Field label="Unit" htmlFor="ni-unit" hint="pcs, box, metre…" error={fieldErrors.unit}>
              <input id="ni-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Category" htmlFor="ni-cat" error={fieldErrors.categoryId}>
              <NativeSelect
                id="ni-cat"
                className="w-full"
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setSubcategoryId('');
                }}
              >
                <option value="">{categories.isPending ? 'Loading…' : 'Choose a category'}</option>
                {sorted.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </NativeSelect>
            </Field>
            {subcategories.length > 0 ? (
              <Field label="Subcategory" htmlFor="ni-sub">
                <NativeSelect id="ni-sub" className="w-full" value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)}>
                  <option value="">None</option>
                  {subcategories.map((sc) => (
                    <option key={sc.id} value={sc.id}>{sc.name}</option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            <Field
              label="Low-stock level"
              htmlFor="ni-min"
              hint="Alert when a location drops to this"
              error={minStockBad ? 'Enter zero or more' : fieldErrors.minStock}
            >
              <input id="ni-min" type="number" min={0} value={minStock} onChange={(e) => setMinStock(e.target.value)} placeholder="Optional" className={inputCls} />
            </Field>
            {canEnterCost ? (
              <Field
                label="Unit cost (INR)"
                htmlFor="ni-cost"
                hint="Visible to Finance and admins only"
                error={costBad ? 'A non-negative amount, at most two decimals' : fieldErrors.unitCost}
              >
                <input id="ni-cost" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0.00" className={inputCls} />
              </Field>
            ) : null}
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={create.isPending} disabled={!valid}>
              <Plus className="size-4" /> Create item
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NewLocationCard({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => apiFetch('/stock/locations', { method: 'POST', body: { code: code.trim(), name: name.trim() } }),
    onSuccess: () => {
      toast.success('Location created');
      setCode('');
      setName('');
      onCreated();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create'),
  });
  return (
    <Card className="grid gap-2 p-4">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
        New location
      </p>
      <Field label="Code" htmlFor="loc-code" hint="Short, uppercase — e.g. WH-BLR">
        <input id="loc-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={inputCls} />
      </Field>
      <Field label="Name" htmlFor="loc-name">
        <input id="loc-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </Field>
      <Button size="sm" loading={create.isPending} disabled={code.trim().length < 2 || name.trim().length < 2} onClick={() => create.mutate()}>
        <Plus className="size-3.5" /> Create
      </Button>
    </Card>
  );
}
