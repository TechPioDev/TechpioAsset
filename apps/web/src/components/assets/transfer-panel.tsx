'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Truck } from 'lucide-react';
import { PERMISSIONS, type AssetStatus } from '@techpioasset/domain';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card } from '@/components/ui';
import { Input } from '@/components/ui/input';

/**
 * Office transfers (v2.15 Phase 2d).
 *
 * Dispatch puts the asset IN_TRANSIT; it stays attributed to the origin office
 * until someone at the destination confirms arrival. A laptop in a courier van
 * is not "at" either site, and pretending it has already arrived hides exactly
 * the window where kit goes missing.
 */

export interface OpenTransferDto {
  id: string;
  transferredAt: string;
  reason: string | null;
  fromOffice: { id: string; name: string } | null;
  toOffice: { id: string; name: string } | null;
}

/** Unheld, on-site statuses the state machine lets move to IN_TRANSIT. */
export const DISPATCHABLE_FROM: readonly AssetStatus[] = ['AVAILABLE', 'RESERVED', 'IN_STORAGE'];

const selectCls =
  'h-9 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 text-sm';

export function TransferPanel({
  assetId,
  status,
  officeId,
  holderId,
  openTransfer,
}: {
  assetId: string;
  status: AssetStatus;
  officeId: string | null;
  holderId: string | null;
  openTransfer: OpenTransferDto | null;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const canTransfer = can(PERMISSIONS.ASSETS_TRANSFER);
  const [open, setOpen] = useState(false);
  const [toOfficeId, setToOfficeId] = useState('');
  const [reason, setReason] = useState('');
  const [landing, setLanding] = useState<'AVAILABLE' | 'IN_STORAGE'>('AVAILABLE');

  const offices = useQuery({
    queryKey: ['offices'],
    enabled: open,
    queryFn: () => apiFetch<{ id: string; name: string }[]>('/offices'),
    staleTime: 60_000,
  });

  const done = async (message: string) => {
    toast.success(message);
    setOpen(false);
    setToOfficeId('');
    setReason('');
    await qc.invalidateQueries({ queryKey: ['asset', assetId] });
  };
  const fail = (caught: unknown, fallback: string) =>
    toast.error(
      caught instanceof ApiError ? (caught.problem.detail ?? caught.problem.title) : fallback,
    );

  const dispatch = useMutation({
    mutationFn: () =>
      apiFetch(`/assets/${assetId}/transfer`, {
        method: 'POST',
        body: { toOfficeId, ...(reason ? { reason } : {}) },
      }),
    onSuccess: () => done('Dispatched — waiting for the destination to confirm arrival'),
    onError: (e) => fail(e, 'Could not dispatch this asset'),
  });

  const receive = useMutation({
    mutationFn: () =>
      apiFetch(`/assets/${assetId}/transfer/receive`, {
        method: 'POST',
        body: { resultingStatus: landing },
      }),
    onSuccess: () => done('Arrival confirmed'),
    onError: (e) => fail(e, 'Could not confirm arrival'),
  });

  if (!canTransfer) return null;

  // On the road: the only sensible action is confirming it arrived.
  if (status === 'IN_TRANSIT' && openTransfer) {
    return (
      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <Truck aria-hidden="true" className="size-4 text-[var(--color-content-subtle)]" />
          In transit
        </h2>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          {openTransfer.fromOffice?.name ?? 'Unknown office'} →{' '}
          <span className="font-medium">{openTransfer.toOffice?.name ?? 'Unknown office'}</span>,
          dispatched {new Date(openTransfer.transferredAt).toLocaleDateString()}
          {openTransfer.reason ? ` — ${openTransfer.reason}` : ''}
        </p>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            receive.mutate();
          }}
        >
          <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
            Where it lands
            <select
              value={landing}
              onChange={(e) => setLanding(e.target.value as 'AVAILABLE' | 'IN_STORAGE')}
              className={selectCls}
            >
              <option value="AVAILABLE">Available</option>
              <option value="IN_STORAGE">In storage</option>
            </select>
          </label>
          <Button type="submit" size="sm" loading={receive.isPending}>
            Confirm arrival
          </Button>
        </form>
      </Card>
    );
  }

  // Dispatch is offered only for unheld, on-site assets.
  if (holderId || !DISPATCHABLE_FROM.includes(status)) return null;

  const destinations = (offices.data ?? []).filter((o) => o.id !== officeId);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Office transfer</h2>
          <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
            Send this asset to another office. It stays attributed here until the destination
            confirms arrival.
          </p>
        </div>
        {!open ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <Truck aria-hidden="true" className="size-3.5" /> Send to another office
          </Button>
        ) : null}
      </div>

      {open ? (
        <form
          className="mt-4 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            dispatch.mutate();
          }}
        >
          <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
            Destination office
            <select
              value={toOfficeId}
              onChange={(e) => setToOfficeId(e.target.value)}
              className={selectCls}
              required
            >
              <option value="">Choose an office…</option>
              {destinations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
            Reason (optional)
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="New starter in the Berlin office…"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={dispatch.isPending} disabled={!toOfficeId}>
              Dispatch
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={dispatch.isPending}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
