'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeftRight, CheckCircle2, Package, UserMinus, X } from 'lucide-react';
import {
  PERMISSIONS,
  offboardingExceptionProblem,
  offboardingFinishState,
  offboardingProgress,
  offboardingProgressLabel,
  type AssetCondition,
  type AssetStatus,
  type OffboardingAssetRef,
  type OffboardingRow,
} from '@techpioasset/domain';
import { apiFetch, ApiError } from '@/lib/api-client';
import { colleagueName, fetchColleagues, type Colleague } from '@/lib/colleagues';
import { offboardingRowActions } from '@/lib/offboarding';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, NativeSelect, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

/**
 * Offboarding a person, from their page.
 *
 * The routine has been on the server since section 13 was built - start,
 * chase the equipment, refuse to finish while anything is out - and had no
 * screen. This is that screen: one panel, two steps. Step 1 is the leaver's
 * kit with a return or a hand-over per row; step 2 is the sign-off, which
 * also closes their account. The server re-checks custody on Finish, so
 * nothing here is the gate - it only shows the gate honestly.
 */

interface Task {
  id: string;
  status: string;
  exceptionReason: string | null;
  checklist: OffboardingAssetRef[] | null;
  outstandingAssets: OffboardingAssetRef[];
  canComplete: boolean;
}

interface HeldConsumable {
  inventoryItemId: string;
  quantity: number;
  sku: string;
  name: string;
  unit: string;
}

interface StockLocation {
  id: string;
  code: string;
  name: string;
}

const CONDITIONS: AssetCondition[] = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'];
const RETURN_STATUSES: AssetStatus[] = [
  'AVAILABLE',
  'IN_STORAGE',
  'UNDER_REPAIR',
  'DAMAGED',
  'RETIRED',
];
const title = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');

const problemText = (e: unknown, fallback: string) =>
  e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : fallback;

export function OffboardingPanel({
  personId,
  personName,
  onClose,
  onCompleted,
}: {
  personId: string;
  personName: string;
  onClose: () => void;
  /** Called after the server accepts the completion - the caller refreshes the page. */
  onCompleted: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  // v2.85 - opening this panel used to START the offboarding: a row appeared,
  // the person was told to hand everything back, and nothing could undo it.
  // Now it opens on a preview that writes nothing, and only the button below
  // starts anything.
  const [taskId, setTaskId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ['offboarding-preview', personId],
    queryFn: () =>
      apiFetch<{ task: Task | null; outstanding: OffboardingAssetRef[] }>(
        `/lifecycle/offboarding/preview/${personId}`,
      ),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const open = preview.data?.task;
    if (open && !taskId) {
      setTaskId(open.id);
      qc.setQueryData(['offboarding-task', open.id], open);
    }
  }, [preview.data, taskId, qc]);

  const start = useMutation({
    mutationFn: () =>
      apiFetch<Task>('/lifecycle/offboarding', {
        method: 'POST',
        body: { subjectUserId: personId },
      }),
    onSuccess: (t) => {
      setStartError(null);
      setTaskId(t.id);
      qc.setQueryData(['offboarding-task', t.id], t);
      void qc.invalidateQueries({ queryKey: ['offboarding-open'] });
      void qc.invalidateQueries({ queryKey: ['offboarding-preview', personId] });
      toast.success(`Offboarding started - ${personName} has been asked to return their equipment`);
    },
    onError: (e) => setStartError(problemText(e, 'Could not start offboarding')),
  });

  const cancel = useMutation({
    mutationFn: (reason?: string) =>
      apiFetch<{ status: string }>(`/lifecycle/offboarding/${taskId}/cancel`, {
        method: 'POST',
        body: reason ? { reason } : {},
      }),
    onSuccess: () => {
      toast.success(`Offboarding called off - ${personName} keeps their equipment`);
      void qc.invalidateQueries({ queryKey: ['offboarding-open'] });
      onCompleted();
    },
    onError: (e) => toast.error(problemText(e, 'Could not call off the offboarding')),
  });

  const task = useQuery({
    queryKey: ['offboarding-task', taskId],
    queryFn: () => apiFetch<Task>(`/lifecycle/tasks/${taskId}`),
    enabled: Boolean(taskId),
    refetchOnWindowFocus: false,
  });

  const consumables = useQuery({
    queryKey: ['held-consumables', personId],
    queryFn: () => apiFetch<HeldConsumable[]>(`/stock/held-by/${personId}`),
    retry: false,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['offboarding-task', taskId] });
    await qc.invalidateQueries({ queryKey: ['equipment-kit', personId] });
    await qc.invalidateQueries({ queryKey: ['held-consumables', personId] });
  };

  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [exceptionReason, setExceptionReason] = useState('');

  const complete = useMutation({
    mutationFn: (reason?: string) =>
      apiFetch<Task>(`/lifecycle/offboarding/${taskId}/complete`, {
        method: 'POST',
        body: reason ? { exceptionReason: reason } : {},
      }),
    onSuccess: (t, reason) => {
      qc.setQueryData(['offboarding-task', t.id], t);
      toast.success(
        reason
          ? `${personName} offboarded with a documented exception - account deactivated`
          : `${personName} offboarded - account deactivated`,
      );
      onCompleted();
    },
    onError: (e) => toast.error(problemText(e, 'Could not complete the offboarding')),
  });

  const progress = offboardingProgress(task.data?.checklist, task.data?.outstandingAssets);
  const finish = offboardingFinishState({
    taskStatus: task.data?.status,
    blocking: progress.blocking,
  });
  const canAssign = can(PERMISSIONS.ASSETS_ASSIGN);
  const canReturn = can(PERMISSIONS.ASSETS_RETURN);
  const canReturnStock = can(PERMISSIONS.INVENTORY_ADJUST);
  const exceptionProblem = offboardingExceptionProblem(exceptionReason);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="offboarding-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={trapRef}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-[var(--color-surface)] shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="offboarding-title" className="text-base font-semibold">
              Offboarding {personName}
            </h2>
            <p className="mt-0.5 text-sm text-[var(--color-content-muted)]">
              {taskId
                ? 'Take back what they hold, then close the account. They have been told what has to come back.'
                : 'Nothing has started. This is what offboarding would involve.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-lg text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="grid gap-5 overflow-y-auto p-5">
          {startError ? (
            <p role="alert" className="text-sm text-[var(--tone-critical-fg)]">
              {startError}
            </p>
          ) : null}

          {/* v2.85 - start it deliberately, or call off one started by mistake. */}
          {taskId ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-4 py-3">
              <p className="text-sm text-[var(--color-content-muted)]">
                Offboarding is in progress for {personName}.
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const reason = window.prompt(
                    `Call off the offboarding for ${personName}? They will be told they keep their equipment.\n\nReason (optional):`,
                  );
                  if (reason === null) return;
                  cancel.mutate(reason.trim() || undefined);
                }}
                disabled={cancel.isPending}
              >
                Call it off
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--tone-warning-fg)] bg-[var(--tone-warning-bg)] px-4 py-3">
              <p className="text-sm">
                {preview.isPending
                  ? 'Checking what they hold…'
                  : `${preview.data?.outstanding.length ?? 0} item(s) are still with ${personName}. Starting will ask them to return everything.`}
              </p>
              <Button
                size="sm"
                onClick={() => start.mutate()}
                disabled={start.isPending || preview.isPending}
              >
                {start.isPending ? 'Starting…' : 'Start offboarding'}
              </Button>
            </div>
          )}

          {/* Step 1 */}
          <section aria-labelledby="offboarding-step-1">
            <div className="flex flex-wrap items-center gap-3">
              <h3 id="offboarding-step-1" className="text-sm font-semibold">
                <span className="mr-2 inline-grid size-5 place-items-center rounded-full bg-[var(--color-brand)] text-[11px] text-[var(--color-brand-contrast)]">
                  1
                </span>
                Return equipment
              </h3>
              {task.data ? (
                <span className="rounded-full bg-[var(--color-surface-sunken)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-content-muted)]">
                  {offboardingProgressLabel(progress)}
                </span>
              ) : null}
            </div>

            {!task.data ? (
              <div className="mt-3 grid gap-2">
                {Array.from({ length: 2 }, (_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : progress.total === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-content-muted)]">
                No equipment is assigned to {personName}. Nothing blocks completion.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)]">
                {progress.rows.map((row) => (
                  <AssetRow
                    key={row.assetId}
                    row={row}
                    holderName={personName}
                    holderId={personId}
                    actions={offboardingRowActions({ canAssign, canReturn, status: row.status })}
                    onDone={refresh}
                  />
                ))}
              </ul>
            )}

            {task.data && progress.blocking > 0 && !canReturn ? (
              // HR may run the offboarding but not touch custody; say who can,
              // rather than showing rows with nothing on them.
              <p className="mt-2 text-xs text-[var(--color-content-muted)]">
                Recording a return needs the assets:return permission - ask IT or an office admin.
                This list updates as they record each one.
              </p>
            ) : null}

            {(consumables.data?.length ?? 0) > 0 ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                  Consumables held
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">
                  Stock items do not block completion, but a return here keeps the ledger honest.
                </p>
                <ul className="mt-2 divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)]">
                  {consumables.data!.map((c) => (
                    <ConsumableRow
                      key={c.inventoryItemId}
                      item={c}
                      holderId={personId}
                      canReturn={canReturnStock}
                      onDone={refresh}
                    />
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="mt-3 text-xs text-[var(--color-content-subtle)]">
              Licence seats are not listed here: the register has no per-person seat view for
              administrators yet. Reclaim them from the licence itself.
            </p>
          </section>

          {/* Step 2 */}
          <section
            aria-labelledby="offboarding-step-2"
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-4"
          >
            <h3 id="offboarding-step-2" className="text-sm font-semibold">
              <span className="mr-2 inline-grid size-5 place-items-center rounded-full bg-[var(--color-brand)] text-[11px] text-[var(--color-brand-contrast)]">
                2
              </span>
              Finish
            </h3>

            {finish === 'completed' ? (
              <p
                className="mt-2 flex items-center gap-2 text-sm"
                style={{ color: 'var(--tone-success-fg)' }}
              >
                <CheckCircle2 aria-hidden="true" className="size-4" />
                Offboarding completed. {personName}&apos;s account is deactivated.
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm text-[var(--color-content-muted)]">
                  {task.data ? offboardingProgressLabel(progress) : 'Loading…'}
                  {finish === 'blocked'
                    ? ` - ${progress.blocking} still ${progress.blocking === 1 ? 'blocks' : 'block'} completion.`
                    : finish === 'ready'
                      ? ' - nothing blocks completion.'
                      : ''}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    disabled={finish !== 'ready' || complete.isPending}
                    loading={complete.isPending && !exceptionOpen}
                    onClick={() => complete.mutate(undefined)}
                  >
                    <UserMinus aria-hidden="true" className="size-4" />
                    Complete offboarding and deactivate account
                  </Button>
                  {finish === 'blocked' && !exceptionOpen ? (
                    <Button variant="secondary" onClick={() => setExceptionOpen(true)}>
                      Complete with exception…
                    </Button>
                  ) : null}
                </div>

                {finish === 'blocked' && exceptionOpen ? (
                  <form
                    className="mt-4 grid gap-3 rounded-xl border border-[var(--tone-warning-border)] bg-[var(--color-surface)] p-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!exceptionProblem) complete.mutate(exceptionReason.trim());
                    }}
                  >
                    <p
                      className="flex items-start gap-2 text-sm"
                      style={{ color: 'var(--tone-warning-fg)' }}
                    >
                      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 flex-none" />
                      <span>
                        The {progress.blocking} outstanding{' '}
                        {progress.blocking === 1 ? 'asset stays' : 'assets stay'} recorded against{' '}
                        {personName} after their account is closed. Your name is recorded as having
                        approved this.
                      </span>
                    </p>
                    <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
                      Reason (required, at least 10 characters)
                      <Textarea
                        value={exceptionReason}
                        onChange={(e) => setExceptionReason(e.target.value)}
                        placeholder="Laptop reported stolen; police report PR-2026-4471 filed."
                        maxLength={1000}
                        aria-invalid={exceptionReason.length > 0 && Boolean(exceptionProblem)}
                      />
                    </label>
                    {exceptionReason.length > 0 && exceptionProblem ? (
                      <p className="text-xs text-[var(--tone-critical-fg)]">{exceptionProblem}</p>
                    ) : null}
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        variant="danger"
                        size="sm"
                        disabled={Boolean(exceptionProblem) || complete.isPending}
                        loading={complete.isPending}
                      >
                        Complete with exception and deactivate
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={complete.isPending}
                        onClick={() => {
                          setExceptionOpen(false);
                          setExceptionReason('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : null}
              </>
            )}
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <Button variant="secondary" onClick={onClose}>
            {finish === 'completed' ? 'Done' : 'Close for now'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * One asset on the list. A returned row is a tick; an outstanding one offers
 * the two custody moves, each opening the same form the asset page uses and
 * calling the same endpoint.
 */
function AssetRow({
  row,
  holderId,
  holderName,
  actions,
  onDone,
}: {
  row: OffboardingRow;
  holderId: string;
  holderName: string;
  actions: { handOver: boolean; recordReturn: boolean };
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'return' | 'reassign' | null>(null);
  const [conditionIn, setConditionIn] = useState<AssetCondition>('GOOD');
  const [resultingStatus, setResultingStatus] = useState<AssetStatus>('AVAILABLE');
  const [damageNotes, setDamageNotes] = useState('');
  const [userId, setUserId] = useState('');

  const people = useQuery({
    queryKey: ['assignable-people-all'],
    queryFn: fetchColleagues,
    enabled: mode === 'reassign',
    staleTime: 60_000,
  });

  const act = useMutation({
    mutationFn: () =>
      mode === 'return'
        ? apiFetch(`/assets/${row.assetId}/return`, {
            method: 'POST',
            body: { conditionIn, resultingStatus, ...(damageNotes ? { damageNotes } : {}) },
          })
        : apiFetch(`/assets/${row.assetId}/reassign`, {
            method: 'POST',
            body: {
              userId,
              conditionIn,
              // Handed straight on in the state it came back in (custody-panel).
              conditionOut: conditionIn,
              ...(damageNotes ? { damageNotes } : {}),
            },
          }),
    onSuccess: async () => {
      toast.success(mode === 'return' ? `${row.name} returned` : `${row.name} handed over`);
      setMode(null);
      setDamageNotes('');
      setUserId('');
      await onDone();
    },
    onError: (e) => toast.error(problemText(e, 'That did not go through')),
  });

  const colleagues = (people.data ?? []).filter((p: Colleague) => p.id !== holderId);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`grid size-8 flex-none place-items-center rounded-lg ${
            row.returned
              ? 'bg-[var(--tone-success-bg)] text-[var(--tone-success-fg)]'
              : 'bg-[var(--color-brand)]/10 text-[var(--color-brand)]'
          }`}
        >
          {row.returned ? (
            <CheckCircle2 aria-hidden="true" className="size-4" />
          ) : (
            <Package aria-hidden="true" className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{row.name}</p>
          <p className="text-xs text-[var(--color-content-muted)]">
            {row.assetTag} · {row.returned ? 'Returned' : title(row.status)}
          </p>
        </div>
        {row.returned ? (
          <span className="text-xs font-medium" style={{ color: 'var(--tone-success-fg)' }}>
            Done
          </span>
        ) : mode === null ? (
          <div className="flex flex-wrap gap-2">
            {actions.recordReturn ? (
              <Button size="sm" variant="secondary" onClick={() => setMode('return')}>
                <UserMinus aria-hidden="true" className="size-3.5" /> Record return
              </Button>
            ) : null}
            {actions.handOver ? (
              <Button size="sm" variant="secondary" onClick={() => setMode('reassign')}>
                <ArrowLeftRight aria-hidden="true" className="size-3.5" /> Hand over to…
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {mode !== null ? (
        <form
          className="mt-3 grid gap-3 rounded-xl bg-[var(--color-surface-sunken)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            act.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {mode === 'reassign' ? (
              <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
                Hand over to
                <NativeSelect value={userId} onChange={(e) => setUserId(e.target.value)} required>
                  <option value="">
                    {people.isPending ? 'Loading people…' : 'Choose a person…'}
                  </option>
                  {colleagues.map((p) => (
                    <option key={p.id} value={p.id}>
                      {colleagueName(p)}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            ) : null}
            <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
              Condition coming back from {holderName}
              <NativeSelect
                value={conditionIn}
                onChange={(e) => setConditionIn(e.target.value as AssetCondition)}
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {title(c)}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {mode === 'return' ? (
              <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
                Where it goes next
                <NativeSelect
                  value={resultingStatus}
                  onChange={(e) => setResultingStatus(e.target.value as AssetStatus)}
                >
                  {RETURN_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {title(s)}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            ) : null}
          </div>
          <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
            Damage or missing items (optional)
            <Input
              value={damageNotes}
              onChange={(e) => setDamageNotes(e.target.value)}
              placeholder="Cracked hinge, charger not returned…"
            />
          </label>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              loading={act.isPending}
              disabled={mode === 'reassign' && !userId}
            >
              {mode === 'return' ? 'Record return' : 'Hand over'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setMode(null)}
              disabled={act.isPending}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/** A consumable the leaver holds. Back to a stock location, in a stated quantity. */
function ConsumableRow({
  item,
  holderId,
  canReturn,
  onDone,
}: {
  item: HeldConsumable;
  holderId: string;
  canReturn: boolean;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState(String(item.quantity));

  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => apiFetch<StockLocation[]>('/stock/locations'),
    enabled: open,
    staleTime: 60_000,
  });

  const act = useMutation({
    mutationFn: () =>
      apiFetch('/stock/return', {
        method: 'POST',
        body: {
          inventoryItemId: item.inventoryItemId,
          stockLocationId: locationId,
          quantity: Number(quantity),
          returnedByUserId: holderId,
          reason: 'Offboarding',
        },
      }),
    onSuccess: async () => {
      toast.success(`${item.name} returned to stock`);
      setOpen(false);
      await onDone();
    },
    onError: (e) => toast.error(problemText(e, 'Could not return that to stock')),
  });

  const qty = Number(quantity);
  const qtyOk = Number.isInteger(qty) && qty >= 1 && qty <= item.quantity;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-8 flex-none place-items-center rounded-lg bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]">
          <Package aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{item.name}</p>
          <p className="text-xs text-[var(--color-content-muted)]">
            {item.sku} · holds {item.quantity} {item.unit}
          </p>
        </div>
        {canReturn && !open ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <UserMinus aria-hidden="true" className="size-3.5" /> Return to stock
          </Button>
        ) : null}
      </div>
      {open ? (
        <form
          className="mt-3 grid gap-3 rounded-xl bg-[var(--color-surface-sunken)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            act.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
              Back to
              <NativeSelect
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                required
              >
                <option value="">
                  {locations.isPending ? 'Loading locations…' : 'Choose a location…'}
                </option>
                {(locations.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} · {l.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
              Quantity (of {item.quantity})
              <Input
                type="number"
                min={1}
                max={item.quantity}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              loading={act.isPending}
              disabled={!locationId || !qtyOk}
            >
              Return to stock
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={act.isPending}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}
