'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, UserCheck, UserMinus, UserPlus } from 'lucide-react';
import { PERMISSIONS, custodyOptions, type AssetCondition, type AssetStatus } from '@techpioasset/domain';
import { apiFetch, apiFetchPage, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card } from '@/components/ui';
import { Input } from '@/components/ui/input';

/**
 * Custody controls: assign, reassign, return (v2.15).
 *
 * These three endpoints have been correct and well-guarded on the server since
 * v1 and had no way to reach them from a browser — the central workflow of an
 * asset system was API-only. This is that surface.
 *
 * Reassign is a first-class action rather than "return then assign again",
 * because the server now does both halves in one transaction: doing it as two
 * clicks left a window where the device belonged to nobody.
 */

const CONDITIONS: AssetCondition[] = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'];

/** Where a returned asset may land. The server re-checks the state machine. */
const RETURN_STATUSES: AssetStatus[] = [
  'AVAILABLE',
  'IN_STORAGE',
  'UNDER_REPAIR',
  'DAMAGED',
  'RETIRED',
];

interface PersonOption {
  id: string;
  email: string;
  profile: { firstName: string; lastName: string } | null;
}

const personLabel = (p: PersonOption) =>
  p.profile ? `${p.profile.firstName} ${p.profile.lastName}` : p.email;

const selectCls =
  'h-9 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 text-sm';

export function CustodyPanel({
  assetId,
  status,
  holderName,
  holderId,
  ask,
}: {
  assetId: string;
  status: AssetStatus;
  holderName: string | null;
  holderId: string | null;
  /**
   * v2.71 - the phone's bottom action bar asking for one of the forms. A new
   * `nonce` is a new request, so pressing the same button twice opens the
   * form again after it was cancelled. The bar only offers what
   * custodyOptions allows, so nothing is re-checked here.
   */
  ask?: { mode: 'assign' | 'reassign' | 'return'; nonce: number } | null;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const canAssign = can(PERMISSIONS.ASSETS_ASSIGN);
  const canReturn = can(PERMISSIONS.ASSETS_RETURN);
  const [mode, setMode] = useState<'assign' | 'reassign' | 'return' | null>(null);
  const askedMode = ask?.mode;
  const askedNonce = ask?.nonce;
  useEffect(() => {
    if (!askedMode || !askedNonce) return;
    setMode(askedMode);
    // After the form has rendered, so the scroll lands on its real height.
    const t = setTimeout(() => {
      document.getElementById('asset-custody')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => clearTimeout(t);
  }, [askedMode, askedNonce]);

  // Who can receive it. Only loaded once a form is open — the picker is not
  // worth a request on every asset page view.
  const people = useQuery({
    queryKey: ['assignable-people'],
    enabled: mode === 'assign' || mode === 'reassign',
    queryFn: () => apiFetchPage<PersonOption>('/users?pageSize=100'),
    staleTime: 60_000,
  });

  const [userId, setUserId] = useState('');
  const [conditionOut, setConditionOut] = useState<AssetCondition>('GOOD');
  const [conditionIn, setConditionIn] = useState<AssetCondition>('GOOD');
  const [expectedReturnAt, setExpectedReturnAt] = useState('');
  const [accessories, setAccessories] = useState('');
  const [damageNotes, setDamageNotes] = useState('');
  const [resultingStatus, setResultingStatus] = useState<AssetStatus>('AVAILABLE');
  const [notes, setNotes] = useState('');

  const reset = () => {
    setMode(null);
    setUserId('');
    setExpectedReturnAt('');
    setAccessories('');
    setDamageNotes('');
    setNotes('');
    setConditionOut('GOOD');
    setConditionIn('GOOD');
    setResultingStatus('AVAILABLE');
  };

  const done = async (message: string) => {
    toast.success(message);
    reset();
    await qc.invalidateQueries({ queryKey: ['asset', assetId] });
    await qc.invalidateQueries({ queryKey: ['my-assets'] });
  };

  const fail = (caught: unknown, fallback: string) =>
    toast.error(
      caught instanceof ApiError ? (caught.problem.detail ?? caught.problem.title) : fallback,
    );

  const assign = useMutation({
    mutationFn: () =>
      apiFetch(`/assets/${assetId}/assign`, {
        method: 'POST',
        body: {
          userId,
          conditionOut,
          ...(expectedReturnAt ? { expectedReturnAt } : {}),
          ...(accessories ? { accessoriesIssued: accessories } : {}),
          ...(notes ? { notes } : {}),
        },
      }),
    onSuccess: () => done('Assigned'),
    onError: (e) => fail(e, 'Could not assign this asset'),
  });

  const reassign = useMutation({
    mutationFn: () =>
      apiFetch(`/assets/${assetId}/reassign`, {
        method: 'POST',
        body: {
          userId,
          conditionIn,
          conditionOut,
          ...(expectedReturnAt ? { expectedReturnAt } : {}),
          ...(accessories ? { accessoriesIssued: accessories } : {}),
          ...(damageNotes ? { damageNotes } : {}),
          ...(notes ? { notes } : {}),
        },
      }),
    onSuccess: () => done('Handed over to the new holder'),
    onError: (e) => fail(e, 'Could not reassign this asset'),
  });

  const returnAsset = useMutation({
    mutationFn: () =>
      apiFetch(`/assets/${assetId}/return`, {
        method: 'POST',
        body: {
          conditionIn,
          resultingStatus,
          ...(damageNotes ? { damageNotes } : {}),
          ...(notes ? { notes } : {}),
        },
      }),
    onSuccess: () => done('Return recorded'),
    onError: (e) => fail(e, 'Could not record the return'),
  });

  const isHeld = Boolean(holderId);
  const busy = assign.isPending || reassign.isPending || returnAsset.isPending;

  // Nothing to offer: no permission, or the asset is in a state where custody
  // cannot move (under repair, disposed…). Saying nothing beats a dead button.
  // The same rule decides the phone's custody card (domain asset-detail.ts).
  const offer = custodyOptions({ canAssign, canReturn, status, isHeld });
  if (!offer.show) return null;

  const peopleOptions = (people.data?.data ?? []).filter((p) => p.id !== holderId);

  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-semibold">Custody</h2>
      <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
        {isHeld
          ? `Currently with ${holderName ?? 'someone'}.`
          : 'Not assigned to anyone right now.'}
      </p>

      {mode === null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {offer.assign ? (
            <Button size="sm" onClick={() => setMode('assign')}>
              <UserPlus aria-hidden="true" className="size-3.5" /> Assign
            </Button>
          ) : null}
          {offer.handOver ? (
            <Button size="sm" variant="secondary" onClick={() => setMode('reassign')}>
              <ArrowLeftRight aria-hidden="true" className="size-3.5" /> Hand over
            </Button>
          ) : null}
          {offer.recordReturn ? (
            <Button size="sm" variant="secondary" onClick={() => setMode('return')}>
              <UserMinus aria-hidden="true" className="size-3.5" /> Record return
            </Button>
          ) : null}
        </div>
      ) : null}

      {mode === 'assign' || mode === 'reassign' ? (
        <form
          className="mt-4 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === 'assign') assign.mutate();
            else reassign.mutate();
          }}
        >
          <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
            {mode === 'reassign' ? 'Hand over to' : 'Assign to'}
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className={selectCls}
              required
            >
              <option value="">Choose a person…</option>
              {peopleOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {personLabel(p)}
                </option>
              ))}
            </select>
          </label>

          {mode === 'reassign' ? (
            <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
              Condition coming back from {holderName ?? 'the current holder'}
              <select
                value={conditionIn}
                onChange={(e) => {
                  const next = e.target.value as AssetCondition;
                  setConditionIn(next);
                  // A device handed straight on goes out in the state it came
                  // back in. Leaving these independent let someone record "came
                  // back damaged, issued as new" without noticing - still
                  // possible, but now it has to be chosen deliberately.
                  setConditionOut(next);
                }}
                className={selectCls}
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0) + c.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
              Condition when issued
              <select
                value={conditionOut}
                onChange={(e) => setConditionOut(e.target.value as AssetCondition)}
                className={selectCls}
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0) + c.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
              Expected back (optional)
              <Input
                type="date"
                value={expectedReturnAt}
                onChange={(e) => setExpectedReturnAt(e.target.value)}
              />
            </label>
          </div>

          <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
            Accessories issued (optional)
            <Input
              value={accessories}
              onChange={(e) => setAccessories(e.target.value)}
              placeholder="Charger, sleeve, dock…"
            />
          </label>

          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={busy} disabled={!userId}>
              {mode === 'reassign' ? 'Hand over' : 'Assign'}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={reset} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {mode === 'return' ? (
        <form
          className="mt-4 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            returnAsset.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
              Condition it came back in
              <select
                value={conditionIn}
                onChange={(e) => setConditionIn(e.target.value as AssetCondition)}
                className={selectCls}
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0) + c.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
              Where it goes next
              <select
                value={resultingStatus}
                onChange={(e) => setResultingStatus(e.target.value as AssetStatus)}
                className={selectCls}
              >
                {RETURN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
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
            <Button type="submit" size="sm" loading={busy}>
              Record return
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={reset} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

/**
 * The employee's side of a handover: "yes, I have this."
 *
 * The endpoint has existed since v1 and was reachable only from the mobile app,
 * so a receipt could never be confirmed from a desk.
 */
export function AcknowledgeButton({
  assignmentId,
  onDone,
}: {
  assignmentId: string;
  onDone?: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const ack = useMutation({
    mutationFn: () =>
      apiFetch(`/assets/assignments/${assignmentId}/acknowledge`, { method: 'POST', body: {} }),
    onSuccess: async () => {
      toast.success('Receipt confirmed — thank you');
      await qc.invalidateQueries({ queryKey: ['my-assets'] });
      // Confirming is what locks the holder's photos, so the photo control has
      // to be told. Without this it went on offering "confirming receipt locks
      // what you add" to somebody who had just confirmed - advice that was
      // already spent, and only corrected by a page refresh.
      await qc.invalidateQueries({ queryKey: ['asset-photos'] });
      onDone?.();
    },
    onError: () => toast.error('Could not confirm receipt'),
  });

  return (
    <Button size="sm" loading={ack.isPending} onClick={() => ack.mutate()}>
      <UserCheck aria-hidden="true" className="mr-1 size-3.5" /> Confirm I have this
    </Button>
  );
}
