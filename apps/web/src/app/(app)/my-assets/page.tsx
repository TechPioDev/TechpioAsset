'use client';

import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ASSET_STATUS_TOKENS, CONDITION_TOKENS } from '@techpioasset/ui-tokens';
import type { AssetCondition, AssetStatus } from '@techpioasset/domain';
import { apiFetch, apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { AcknowledgeButton } from '@/components/assets/custody-panel';
import { HolderPhotoUpload } from '@/components/assets/holder-photo-upload';

interface AssetRow {
  id: string;
  assetTag: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  status: AssetStatus;
  condition: AssetCondition;
  assignmentDate: string | null;
  warrantyEndDate: string | null;
  office: { name: string } | null;
  category: { name: string } | null;
  /** The open assignment, if any - at most one row. */
  assignments: {
    id: string;
    acknowledgedAt: string | null;
    expectedReturnAt: string | null;
    assignedBy: { profile: { firstName: string; lastName: string } | null } | null;
  }[];
}

/** Shape returned by /stock/held-by/:userId - the item is flattened onto the row. */
interface HeldConsumable {
  inventoryItemId: string;
  name: string;
  sku: string;
  unit: string | null;
  quantity: number;
}

export default function MyAssetsPage() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <Suspense fallback={null}>
      <MyAssetsList />
    </Suspense>
  );
}

function MyAssetsList() {
  const { user } = useAuth();

  // A company can restrict raising requests to IT and HR. Offering three
  // buttons that all lead to a form the reader cannot submit is worse than not
  // offering them: the work is done before the refusal arrives.
  const raise = useQuery({
    queryKey: ['can-create-request'],
    queryFn: () => apiFetch<{ allowed: boolean; reason?: string }>('/requests/can-create'),
    staleTime: 60_000,
  });
  const mayRaise = raise.data?.allowed ?? true;
  // The header search sends OWN-scope users here with ?q=. The API already
  // matches name/tag/serial/brand/model and is scoped to the caller, so the
  // term simply rides along - no client-side filtering to drift out of step.
  const params = useSearchParams();
  const q = params.get('q')?.trim() ?? '';

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['my-assets', user?.id, q],
    enabled: Boolean(user),
    queryFn: () =>
      apiFetchPage<AssetRow>(
        `/assets?assignedUserId=${user!.id}&pageSize=100${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      ),
  });

  // v2.21 - cables, mice and headsets are stock, not serialised assets, so the
  // list above never shows them. The ledger says what this person holds; the
  // phone's My equipment reads the same endpoint.
  const consumables = useQuery({
    queryKey: ['held-consumables', user?.id],
    enabled: Boolean(user) && !q,
    queryFn: () => apiFetch<HeldConsumable[]>(`/stock/held-by/${user!.id}`),
  });

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">My assets</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          {q ? `Your equipment matching “${q}”.` : 'Equipment currently issued to you.'}
        </p>
        {q ? (
          <Link href="/my-assets" className="mt-1 inline-block text-sm text-[var(--color-brand)]">
            Clear search
          </Link>
        ) : null}
      </header>

      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState title="Could not load your assets" detail={(error as Error).message} />
      ) : data.data.length === 0 ? (
        <Card>
          <EmptyState
            title={q ? 'No equipment matches that search' : 'Nothing assigned to you'}
            description={
              q
                ? 'Try a different asset name, tag or serial number.'
                : 'When IT or the office team issues you equipment, it will appear here.'
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.data.map((asset) => (
            <Card key={asset.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/assets/${asset.id}`} className="font-medium hover:underline">
                    {asset.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-[var(--color-content-subtle)]">
                    {asset.assetTag}
                  </p>
                </div>
                <StatusBadge token={ASSET_STATUS_TOKENS[asset.status]} size="sm" />
              </div>

              <dl className="mt-3 grid gap-1 text-xs text-[var(--color-content-muted)]">
                {asset.brand || asset.model ? (
                  <div className="flex gap-1">
                    <dt className="sr-only">Model</dt>
                    <dd>
                      {[...new Set([asset.brand, asset.model].filter(Boolean))].join(' ')}
                    </dd>
                  </div>
                ) : null}
                {asset.serialNumber ? (
                  <div className="flex gap-1">
                    <dt>Serial:</dt>
                    <dd className="font-mono">{asset.serialNumber}</dd>
                  </div>
                ) : null}
                {asset.category ? (
                  <div className="flex gap-1">
                    <dt>Category:</dt>
                    <dd>{asset.category.name}</dd>
                  </div>
                ) : null}
                {asset.office ? (
                  <div className="flex gap-1">
                    <dt>Office:</dt>
                    <dd>{asset.office.name}</dd>
                  </div>
                ) : null}
                {asset.assignmentDate ? (
                  <div className="flex gap-1">
                    <dt>Issued:</dt>
                    <dd>
                      {new Date(asset.assignmentDate).toLocaleDateString()}
                      {asset.assignments[0]?.assignedBy?.profile
                        ? ` by ${asset.assignments[0].assignedBy.profile.firstName} ${asset.assignments[0].assignedBy.profile.lastName}`
                        : ''}
                    </dd>
                  </div>
                ) : null}
                {asset.warrantyEndDate ? (
                  <div className="flex gap-1">
                    <dt>Warranty ends:</dt>
                    <dd>{new Date(asset.warrantyEndDate).toLocaleDateString()}</dd>
                  </div>
                ) : null}
              </dl>

              {/* The full device record - Overview, Lifecycle, Hardware, OS,
                  Software, Health - lives on the tabbed detail page. */}
              <Link
                href={`/assets/${asset.id}`}
                className="mt-3 inline-block text-xs font-medium text-[var(--color-brand)]"
              >
                View device details →
              </Link>

              <div className="mt-3">
                <StatusBadge token={CONDITION_TOKENS[asset.condition]} size="sm" />
              </div>

              {/* Confirming receipt closes the loop on a handover: until the
                  holder does it, IT only knows the device left the shelf. */}
              {asset.assignments[0] && !asset.assignments[0].acknowledgedAt ? (
                <div
                  className="mt-3 rounded-[var(--radius-control)] border px-3 py-2.5"
                  style={{
                    color: 'var(--tone-warning-fg)',
                    backgroundColor: 'var(--tone-warning-bg)',
                    borderColor: 'var(--tone-warning-border)',
                  }}
                >
                  <p className="text-xs font-medium">Please confirm you received this.</p>
                  <div className="mt-2">
                    <AcknowledgeButton assignmentId={asset.assignments[0].id} />
                  </div>
                </div>
              ) : null}

              {/* On every asset, not just one awaiting confirmation: a mouse
                  or a monitor gets damaged long after it was issued, and the
                  person holding it is the only one looking at it. */}
              <HolderPhotoUpload assetId={asset.id} />

              {/* Self-service intents, pre-filled with this device so nobody
                  types an asset tag by hand. */}
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--color-border)] pt-3">
                {!mayRaise ? (
                  <p className="text-xs text-[var(--color-content-muted)]">
                    {raise.data?.reason ??
                      'Requests are raised by IT and HR. Contact them and they will raise one for you.'}
                  </p>
                ) : null}
                {mayRaise ? (
                  <>
                    <Link
                      href={`/requests/new?report=issue&about=${encodeURIComponent(`${asset.assetTag} ${asset.name}`)}`}
                      className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-2 py-1 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"
                    >
                      Report issue
                    </Link>
                    <Link
                      href={`/requests/new?type=REPLACEMENT&about=${encodeURIComponent(`${asset.assetTag} ${asset.name}`)}`}
                      className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-2 py-1 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"
                    >
                      Replacement
                    </Link>
                    <Link
                      href={`/requests/new?type=UPGRADE&about=${encodeURIComponent(`${asset.assetTag} ${asset.name}`)}`}
                      className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-2 py-1 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"
                    >
                      Upgrade
                    </Link>
                  </>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Not while searching: the search matches assets, and a consumables
          list under "matching X" would read as part of the results. */}
      {q ? null : (
        <section aria-labelledby="my-consumables" className="grid gap-2">
          <h2 id="my-consumables" className="text-base font-semibold">
            Consumables
          </h2>
          {consumables.isPending ? (
            <Skeleton className="h-16" />
          ) : consumables.isError ? (
            <ErrorState
              title="Could not load your consumables"
              detail={(consumables.error as Error).message}
            />
          ) : consumables.data.length === 0 ? (
            <Card className="px-4 py-3">
              <p className="text-sm text-[var(--color-content-muted)]">
                Nothing issued from stock — cables, mice and headsets would show here.
              </p>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-[var(--color-border)]">
                {consumables.data.map((item) => (
                  <li
                    key={item.inventoryItemId}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-[var(--color-content-subtle)]">{item.sku}</p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">
                      {item.quantity}
                      {item.unit ? ` ${item.unit}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}
