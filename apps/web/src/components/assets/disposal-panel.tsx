'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive } from 'lucide-react';
import { PERMISSIONS, type AssetStatus } from '@techpioasset/domain';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { Button, Card } from '@/components/ui';
import { Input } from '@/components/ui/input';

/**
 * Disposal (v2.15, spec section 22: recorded, never a delete).
 *
 * Shown to holders of assets:dispose - Finance and admins - and only when the
 * state machine would accept the move. Once disposed, the same card flips to a
 * read-only summary of the record: a disposed asset's page should answer "where
 * did it go and why" without a trip to the audit log.
 */

const METHODS = [
  ['SOLD', 'Sold'],
  ['SCRAPPED', 'Scrapped'],
  ['RECYCLED', 'Recycled'],
  ['DONATED', 'Donated'],
  ['RETURNED_TO_VENDOR', 'Returned to vendor'],
  ['WRITTEN_OFF', 'Written off'],
] as const;

type Method = (typeof METHODS)[number][0];

export interface DisposalDto {
  method: Method;
  disposedAt: string;
  proceeds?: string | null;
  currency?: string | null;
  recipient: string | null;
  reason: string;
  approvedBy: { profile: { firstName: string; lastName: string } | null } | null;
}

/** Statuses the machine lets move to DISPOSED/DONATED. Kept in sync by tests. */
export const DISPOSABLE_FROM: readonly AssetStatus[] = ['AVAILABLE', 'IN_STORAGE', 'RETIRED'];

const selectCls =
  'h-9 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 text-sm';

const methodLabel = (m: Method) => METHODS.find(([k]) => k === m)?.[1] ?? m;

export function DisposalPanel({
  assetId,
  assetName,
  status,
  disposal,
}: {
  assetId: string;
  assetName: string;
  status: AssetStatus;
  disposal: DisposalDto | null;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<Method>('SCRAPPED');
  const [disposedAt, setDisposedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [proceeds, setProceeds] = useState('');
  const [recipient, setRecipient] = useState('');
  const [reason, setReason] = useState('');

  const dispose = useMutation({
    mutationFn: () =>
      apiFetch(`/assets/${assetId}/dispose`, {
        method: 'POST',
        body: {
          method,
          disposedAt,
          reason,
          ...(proceeds ? { proceeds } : {}),
          ...(recipient ? { recipient } : {}),
        },
      }),
    onSuccess: async () => {
      toast.success('Disposal recorded');
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ['asset', assetId] });
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not record disposal',
      ),
  });

  // The record, once it exists, renders for anyone who can see the asset.
  if (disposal) {
    return (
      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <Archive aria-hidden="true" className="size-4 text-[var(--color-content-subtle)]" />
          Disposed
        </h2>
        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-2 sm:block">
            <dt className="text-[var(--color-content-subtle)]">Method</dt>
            <dd className="font-medium">{methodLabel(disposal.method)}</dd>
          </div>
          <div className="flex justify-between gap-2 sm:block">
            <dt className="text-[var(--color-content-subtle)]">Date</dt>
            <dd className="font-medium">{new Date(disposal.disposedAt).toLocaleDateString()}</dd>
          </div>
          {disposal.recipient ? (
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-[var(--color-content-subtle)]">Went to</dt>
              <dd className="font-medium">{disposal.recipient}</dd>
            </div>
          ) : null}
          {/* Proceeds arrive only for viewers with cost visibility - absence
              here is the API's decision, not a rendering choice. */}
          {disposal.proceeds ? (
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-[var(--color-content-subtle)]">Proceeds</dt>
              <dd className="font-medium">
                {disposal.currency ?? ''} {disposal.proceeds}
              </dd>
            </div>
          ) : null}
          {disposal.approvedBy?.profile ? (
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-[var(--color-content-subtle)]">Recorded by</dt>
              <dd className="font-medium">
                {disposal.approvedBy.profile.firstName} {disposal.approvedBy.profile.lastName}
              </dd>
            </div>
          ) : null}
        </dl>
        <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-content-muted)]">
          {disposal.reason}
        </p>
      </Card>
    );
  }

  if (!can(PERMISSIONS.ASSETS_DISPOSE)) return null;
  if (!DISPOSABLE_FROM.includes(status)) return null;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">End of life</h2>
          <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
            Record how this asset left the company. The asset and its history stay on file.
          </p>
        </div>
        {!open ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <Archive aria-hidden="true" className="size-3.5" /> Record disposal
          </Button>
        ) : null}
      </div>

      {open ? (
        <form
          className="mt-4 grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await confirm({
              title: `Dispose of ${assetName}?`,
              body: 'This is final: a disposed asset cannot come back into service. Its record and history remain visible.',
              confirmLabel: 'Record disposal',
              destructive: true,
            });
            if (ok) dispose.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
              Method
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as Method)}
                className={selectCls}
              >
                {METHODS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
              Date
              <Input
                type="date"
                value={disposedAt}
                onChange={(e) => setDisposedAt(e.target.value)}
                required
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
              {method === 'SOLD' ? 'Sale proceeds' : 'Proceeds (if any)'}
              <Input
                inputMode="decimal"
                value={proceeds}
                onChange={(e) => setProceeds(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
              {method === 'DONATED'
                ? 'Donated to'
                : method === 'SOLD'
                  ? 'Buyer'
                  : 'Recipient (optional)'}
              <Input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Company, charity or person"
              />
            </label>
          </div>

          <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
            Reason
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Beyond economical repair after screen failure…"
              required
              minLength={10}
            />
          </label>

          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={dispose.isPending}>
              Record disposal
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={dispose.isPending}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
