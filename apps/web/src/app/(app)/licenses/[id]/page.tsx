'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Eye, KeyRound, Plus, Trash2, UserMinus } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { ApiError, apiFetch, apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import {
  LicenseStatusPill,
  SeatsMeter,
  expiryLabel,
  inputCls,
  type LicenseRow,
  isSyncedLicense,
  SyncedBadge,
} from '@/components/licenses/shared';

interface Assignment {
  id: string;
  status: 'ACTIVE' | 'REVOKED';
  assignedAt: string;
  revokedAt: string | null;
  reason: string | null;
  user: { id: string; email: string; profile: { firstName: string; lastName: string } | null } | null;
  asset: { id: string; assetTag: string; name: string } | null;
}
interface Renewal {
  id: string;
  renewedAt: string;
  previousExpiry: string | null;
  newExpiry: string | null;
  seatsDelta: number;
  notes: string | null;
  costAmount?: string;
  costCurrency?: string;
}
interface LicenseDetail extends LicenseRow {
  notes: string | null;
  purchaseOrderNumber: string | null;
  autoRenewal: boolean;
  purchaseDate: string;
  renewalDate: string | null;
  costAmount?: string;
  costCurrency?: string;
  pools: { id: string; name: string; seatsAllocated: number; seatsReserved: number }[];
  assignments: Assignment[];
  renewals: Renewal[];
  keys: { id: string; masked: string; note: string | null; createdAt: string }[];
}

type Tab = 'overview' | 'seats' | 'keys' | 'renewals';

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const who = (a: Assignment) =>
  a.user
    ? a.user.profile
      ? `${a.user.profile.firstName} ${a.user.profile.lastName}`.trim() || a.user.email
      : a.user.email
    : a.asset
      ? `${a.asset.name} (${a.asset.assetTag})`
      : '—';

export default function LicenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  // The honest refusal, surfaced exactly as the API words it (LIC-004 adapted).
  const [seatLimitError, setSeatLimitError] = useState<string | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['license', id],
    queryFn: () => apiFetch<LicenseDetail>(`/licenses/${id}`),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['license', id] });

  const revoke = useMutation({
    mutationFn: (assignmentId: string) =>
      apiFetch(`/licenses/${id}/revoke`, { method: 'POST', body: { assignmentId } }),
    onSuccess: () => {
      toast.success('Seat revoked');
      setSeatLimitError(null);
      void refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not revoke'),
  });

  const remove = useMutation({
    mutationFn: () => apiFetch(`/licenses/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('License deleted');
      router.push('/licenses');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not delete'),
  });

  if (isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (isError) {
    return <ErrorState title="Could not load the license" detail={(error as Error).message} />;
  }

  const l = data;
  const activeSeats = l.assignments.filter((a) => a.status === 'ACTIVE');
  /*
    v3.12 - a licence synced from Microsoft 365 is changed THERE.

    Its seats are assigned in the Microsoft 365 admin centre and its dates come
    from Microsoft, so the server refuses to assign, renew or delete it here.
    Offering those buttons anyway would mean every one of them ends in an
    error, so they are not offered, and the page says where to go instead.
  */
  const synced = isSyncedLicense(l);
  const seatsInUse = synced ? (l.externalSeatsUsed ?? l.seatsReserved) : activeSeats.length;
  const canAssign =
    !synced &&
    can(PERMISSIONS.LICENSES_ASSIGN) &&
    l.status !== 'RETIRED' &&
    l.status !== 'EXPIRED';

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    // For a synced licence the count is Microsoft's: "Seats (0)" over a
    // subscription with 42 people on it would be this page contradicting its
    // own meter.
    { key: 'seats', label: `Seats (${seatsInUse})` },
    { key: 'keys', label: `Keys (${l.keys.length})` },
    { key: 'renewals', label: `Renewals (${l.renewals.length})` },
  ];

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/licenses" className="text-xs font-semibold text-[var(--color-brand)]">
            ← Licenses
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-[24px] font-bold tracking-tight">
            <KeyRound className="size-6 text-[var(--color-brand)]" /> {l.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--color-content-muted)]">
            <LicenseStatusPill status={l.status} />
            {synced ? <SyncedBadge /> : null}
            <span>{l.edition ?? ''}</span>
            <span>· {l.unitOfAssignment === 'USER' ? 'per user' : 'per device'}</span>
            <span>· {expiryLabel(l.expiryDate)}</span>
            {l.vendor ? <span>· {l.vendor.name}</span> : null}
          </div>
        </div>
        <div className="w-52">
          <SeatsMeter purchased={l.seatsPurchased} reserved={l.seatsReserved} />
        </div>
      </header>

      {synced ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-4 text-sm">
          <p className="font-semibold">Synced from Microsoft 365</p>
          <p className="mt-1 text-[var(--color-content-muted)]">
            The seats, dates and status on this page come from Microsoft and refresh every night
            {l.externalSyncedAt
              ? ` (last read ${new Date(l.externalSyncedAt).toLocaleString()})`
              : ''}
            . To give or take away a seat, or to change the subscription, use the Microsoft 365
            admin centre; the change appears here after the next sync. Cost, vendor and notes are
            kept here and are never overwritten.
          </p>
          {(l.externalSeatsUsed ?? 0) > l.seatsPurchased ? (
            <p className="mt-2 font-medium" style={{ color: 'var(--tone-warning-fg)' }}>
              Microsoft reports {l.externalSeatsUsed} seats in use against {l.seatsPurchased} owned
              - {(l.externalSeatsUsed ?? 0) - l.seatsPurchased} more than the subscription covers.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* The refusal banner: honest numbers, no override. */}
      {seatLimitError ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-[var(--radius-card)] border border-[var(--tone-critical-fg)]/30 bg-[var(--tone-critical-bg)] p-4"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--tone-critical-fg)]" />
          <div>
            <p className="text-sm font-bold text-[var(--tone-critical-fg)]">License limit exceeded</p>
            <p className="mt-0.5 text-sm text-[var(--tone-critical-fg)]">{seatLimitError}</p>
            <p className="mt-1 text-xs text-[var(--tone-critical-fg)]/80">
              There is no override: add seats through a renewal or revoke an existing one.
            </p>
          </div>
        </div>
      ) : null}

      <div role="tablist" aria-label="License sections" className="flex gap-1 border-b border-[var(--color-border)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              tab === t.key
                ? 'border-[var(--color-brand)] text-[var(--color-brand)]'
                : 'border-transparent text-[var(--color-content-muted)] hover:text-[var(--color-content)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? <OverviewTab l={l} onDelete={async () => {
        const ok = await confirm({
          title: `Delete ${l.name}?`,
          body: 'Only a licence with no active seats can be deleted. Its history is kept.',
          confirmLabel: 'Delete',
          destructive: true,
        });
        if (ok) remove.mutate();
      }} canDelete={!synced && can(PERMISSIONS.LICENSES_DELETE)} /> : null}

      {tab === 'seats' ? (
        <SeatsTab
          licenseId={l.id}
          unit={l.unitOfAssignment}
          assignments={l.assignments}
          canAssign={canAssign}
          syncedSeats={synced ? { used: seatsInUse, purchased: l.seatsPurchased } : null}
          canRevoke={can(PERMISSIONS.LICENSES_REVOKE)}
          onRevoke={(aid) => revoke.mutate(aid)}
          onAssigned={() => {
            setSeatLimitError(null);
            void refresh();
          }}
          onSeatLimit={(message) => setSeatLimitError(message)}
        />
      ) : null}

      {tab === 'keys' ? (
        <KeysTab licenseId={l.id} keys={l.keys} canAdd={can(PERMISSIONS.LICENSES_UPDATE)} canReveal={can(PERMISSIONS.LICENSES_KEYS_REVEAL)} onChanged={() => void refresh()} />
      ) : null}

      {tab === 'renewals' ? (
        <RenewalsTab licenseId={l.id} renewals={l.renewals} canRenew={!synced && can(PERMISSIONS.LICENSES_RENEW)} onChanged={() => void refresh()} />
      ) : null}
    </div>
  );
}

function OverviewTab({ l, onDelete, canDelete }: { l: LicenseDetail; onDelete: () => void; canDelete: boolean }) {
  const rows: [string, string][] = [
    ['Family', l.family.replace(/_/g, ' ').toLowerCase()],
    ['Subscription', l.subscriptionType.toLowerCase()],
    ['Purchased', fmtDate(l.purchaseDate)],
    // "Perpetual" is what a missing date means for a licence somebody entered.
    // For a synced one it means Microsoft sent no date, which is not the same
    // claim and must not be dressed up as it.
    [
      'Expiry',
      l.expiryDate ? fmtDate(l.expiryDate) : isSyncedLicense(l) ? 'No date from Microsoft' : 'Perpetual',
    ],
    ['Renewal date', fmtDate(l.renewalDate)],
    // Microsoft does not say whether a subscription renews by itself, so for a
    // synced licence the row is left out rather than answering "No".
    ...(isSyncedLicense(l)
      ? ([
          ['In use (Microsoft 365)', `${l.externalSeatsUsed ?? 0} / ${l.seatsPurchased} seats`],
          ['Microsoft status', l.externalStatus ?? '—'],
        ] as [string, string][])
      : ([['Auto-renew', l.autoRenewal ? 'Yes' : 'No']] as [string, string][])),
    ['PO number', l.purchaseOrderNumber ?? '—'],
    ...(l.costAmount ? ([['Cost', `${Number(l.costAmount).toLocaleString()} ${l.costCurrency ?? ''}`]] as [string, string][]) : []),
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-0">
        {rows.map(([label, value], i) => (
          <div
            key={label}
            className={`flex justify-between px-4 py-3 text-sm ${i ? 'border-t border-[var(--color-border)]' : ''}`}
          >
            <span className="text-[var(--color-content-muted)]">{label}</span>
            <span className="font-medium capitalize">{value}</span>
          </div>
        ))}
      </Card>
      <div className="grid content-start gap-4">
        {l.notes ? (
          <Card className="p-4">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
              Notes
            </h3>
            <p className="mt-2 whitespace-pre-wrap text-sm">{l.notes}</p>
          </Card>
        ) : null}
        {canDelete ? (
          <Card className="p-4">
            <h3 className="text-[13px] font-semibold text-[var(--color-content-muted)]">Danger zone</h3>
            <Button variant="danger" size="sm" className="mt-3" onClick={onDelete}>
              <Trash2 className="size-3.5" /> Delete license
            </Button>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function SeatsTab({
  licenseId,
  unit,
  assignments,
  canAssign,
  syncedSeats,
  canRevoke,
  onRevoke,
  onAssigned,
  onSeatLimit,
}: {
  licenseId: string;
  unit: 'USER' | 'DEVICE';
  assignments: Assignment[];
  canAssign: boolean;
  /** Set when Microsoft 365 holds the seat list; null for a licence managed here. */
  syncedSeats: { used: number; purchased: number } | null;
  canRevoke: boolean;
  onRevoke: (assignmentId: string) => void;
  onAssigned: () => void;
  onSeatLimit: (message: string) => void;
}) {
  const toast = useToast();
  const [principalId, setPrincipalId] = useState('');

  const principals = useQuery({
    queryKey: ['license-principals', unit],
    queryFn: () =>
      unit === 'USER'
        ? apiFetchPage<{ id: string; email: string }>('/users?pageSize=100').then((r) =>
            r.data.map((u) => ({ id: u.id, label: u.email })),
          )
        : apiFetchPage<{ id: string; assetTag: string; name: string }>('/assets?pageSize=100').then((r) =>
            r.data.map((a) => ({ id: a.id, label: `${a.name} (${a.assetTag})` })),
          ),
  });

  const assign = useMutation({
    mutationFn: () =>
      apiFetch(`/licenses/${licenseId}/assign`, {
        method: 'POST',
        body: unit === 'USER' ? { userId: principalId } : { assetId: principalId },
      }),
    onSuccess: () => {
      toast.success('Seat assigned');
      setPrincipalId('');
      onAssigned();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'SEAT_LIMIT_EXCEEDED') {
        onSeatLimit(e.message);
      } else {
        toast.error(e instanceof Error ? e.message : 'Could not assign');
      }
    },
  });

  const active = assignments.filter((a) => a.status === 'ACTIVE');
  const past = assignments.filter((a) => a.status !== 'ACTIVE').slice(0, 10);

  return (
    <div className="grid gap-4">
      {canAssign ? (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-64 flex-1">
            <label htmlFor="seat-principal" className="mb-1 block text-[13px] font-medium">
              Assign a seat to a {unit === 'USER' ? 'person' : 'device'}
            </label>
            <select
              id="seat-principal"
              value={principalId}
              onChange={(e) => setPrincipalId(e.target.value)}
              className={inputCls}
            >
              <option value="">Choose…</option>
              {(principals.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <Button loading={assign.isPending} disabled={!principalId} onClick={() => assign.mutate()}>
            <Plus className="size-4" /> Assign seat
          </Button>
        </Card>
      ) : null}

      <Card className="p-0">
        {active.length === 0 ? (
          syncedSeats ? (
            // Not "no active seats": there are, and Microsoft knows who has them.
            <EmptyState
              title={`${syncedSeats.used} of ${syncedSeats.purchased} seats in use`}
              description="Who holds each seat is managed in the Microsoft 365 admin centre, so the list is not kept here."
            />
          ) : (
            <EmptyState title="No active seats" description="Assigned seats appear here." />
          )
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {active.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{who(a)}</p>
                  <p className="text-xs text-[var(--color-content-subtle)]">
                    since {fmtDate(a.assignedAt)}
                    {a.reason ? ` · ${a.reason}` : ''}
                  </p>
                </div>
                {canRevoke ? (
                  <Button variant="ghost" size="sm" onClick={() => onRevoke(a.id)}>
                    <UserMinus className="size-3.5" /> Revoke
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {past.length > 0 ? (
        <Card className="p-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
            Recently revoked
          </h3>
          <ul className="mt-2 grid gap-1.5">
            {past.map((a) => (
              <li key={a.id} className="text-sm text-[var(--color-content-muted)]">
                {who(a)} · revoked {fmtDate(a.revokedAt)}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function KeysTab({
  licenseId,
  keys,
  canAdd,
  canReveal,
  onChanged,
}: {
  licenseId: string;
  keys: LicenseDetail['keys'];
  canAdd: boolean;
  canReveal: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [newKey, setNewKey] = useState('');
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const add = useMutation({
    mutationFn: () =>
      apiFetch(`/licenses/${licenseId}/keys`, { method: 'POST', body: { key: newKey.trim() } }),
    onSuccess: () => {
      toast.success('Key stored (encrypted)');
      setNewKey('');
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not store the key'),
  });

  const reveal = useMutation({
    mutationFn: (keyId: string) =>
      apiFetch<{ id: string; key: string }>(`/licenses/${licenseId}/keys/${keyId}/reveal`, {
        method: 'POST',
      }),
    onSuccess: (r) => setRevealed((m) => ({ ...m, [r.id]: r.key })),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not reveal'),
  });

  return (
    <div className="grid gap-4">
      {canAdd ? (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-64 flex-1">
            <label htmlFor="new-key" className="mb-1 block text-[13px] font-medium">
              Store a licence key
            </label>
            <input
              id="new-key"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="Paste the key — it is encrypted at rest"
              className={inputCls}
            />
          </div>
          <Button loading={add.isPending} disabled={newKey.trim().length < 4} onClick={() => add.mutate()}>
            <Plus className="size-4" /> Store key
          </Button>
        </Card>
      ) : null}

      <Card className="p-0">
        {keys.length === 0 ? (
          <EmptyState title="No keys stored" description="Keys are encrypted and always served masked." />
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm">{revealed[k.id] ?? k.masked}</p>
                  <p className="text-xs text-[var(--color-content-subtle)]">
                    added {fmtDate(k.createdAt)}
                    {k.note ? ` · ${k.note}` : ''}
                  </p>
                </div>
                {canReveal && !revealed[k.id] ? (
                  <Button variant="ghost" size="sm" loading={reveal.isPending} onClick={() => reveal.mutate(k.id)}>
                    <Eye className="size-3.5" /> Reveal
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-[var(--color-content-subtle)]">
        Every reveal is written to the audit log.
      </p>
    </div>
  );
}

function RenewalsTab({
  licenseId,
  renewals,
  canRenew,
  onChanged,
}: {
  licenseId: string;
  renewals: Renewal[];
  canRenew: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [newExpiry, setNewExpiry] = useState('');
  const [seatsDelta, setSeatsDelta] = useState(0);

  const renew = useMutation({
    mutationFn: () =>
      apiFetch(`/licenses/${licenseId}/renewals`, {
        method: 'POST',
        body: { ...(newExpiry ? { newExpiry } : {}), seatsDelta },
      }),
    onSuccess: () => {
      toast.success('Renewal recorded');
      setNewExpiry('');
      setSeatsDelta(0);
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not renew'),
  });

  return (
    <div className="grid gap-4">
      {canRenew ? (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <label htmlFor="renew-expiry" className="mb-1 block text-[13px] font-medium">
              New expiry
            </label>
            <input
              id="renew-expiry"
              type="date"
              value={newExpiry}
              onChange={(e) => setNewExpiry(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="renew-delta" className="mb-1 block text-[13px] font-medium">
              Seats +/−
            </label>
            <input
              id="renew-delta"
              type="number"
              value={seatsDelta}
              onChange={(e) => setSeatsDelta(Number(e.target.value))}
              className={`${inputCls} w-28`}
            />
          </div>
          <Button
            loading={renew.isPending}
            disabled={!newExpiry && seatsDelta === 0}
            onClick={() => renew.mutate()}
          >
            Record renewal
          </Button>
        </Card>
      ) : null}

      <Card className="p-0">
        {renewals.length === 0 ? (
          <EmptyState title="No renewals yet" description="Renewals are the only way seat counts change." />
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {renewals.map((r) => (
              <li key={r.id} className="px-4 py-3 text-sm">
                <p className="font-medium">
                  {fmtDate(r.renewedAt)}
                  {r.seatsDelta ? ` · ${r.seatsDelta > 0 ? '+' : ''}${r.seatsDelta} seats` : ''}
                </p>
                <p className="text-xs text-[var(--color-content-subtle)]">
                  {r.previousExpiry || r.newExpiry
                    ? `expiry ${fmtDate(r.previousExpiry)} → ${fmtDate(r.newExpiry)}`
                    : ''}
                  {r.costAmount ? ` · ${Number(r.costAmount).toLocaleString()} ${r.costCurrency ?? ''}` : ''}
                  {r.notes ? ` · ${r.notes}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
