'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { Button, Card, Field, Input, Skeleton } from '@/components/ui';

/**
 * Microsoft 365 licences (v3.12).
 *
 * The whole connection lives on this card so that nobody has to log in to a
 * server to set it up: three values from the Microsoft Entra admin centre go
 * in, and the subscriptions the company owns appear in Licences.
 *
 * The secret is a one-way door. It is typed here, encrypted on the server,
 * and never sent back - which is why the field is empty when you return, with
 * a line saying one is stored rather than a row of dots pretending to show it.
 *
 * "Test connection" comes before "Sync now" on purpose. It reads from
 * Microsoft and lists what WOULD be recorded without writing anything, so the
 * first time real data lands in Licences it is data somebody has already
 * looked at.
 */

interface SyncSummary {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  retired: number;
  revived: number;
  skipped: { free: number; empty: number; notPerUser: number; deleted: number };
  overAssigned: { name: string; by: number }[];
}

interface Status {
  connected: boolean;
  tenantId: string | null;
  clientId: string | null;
  hasSecret: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: 'ok' | 'failed' | null;
  lastSyncMessage: string | null;
  lastSyncSummary: SyncSummary | null;
  licences: number;
}

type TestResult =
  | {
      ok: true;
      licences: {
        name: string;
        seatsPurchased: number;
        seatsUsed: number;
        renewalDate: string | null;
      }[];
      skipped: SyncSummary['skipped'];
    }
  | { ok: false; message: string };

const KEY = ['integrations-m365-licences'];

const problem = (e: unknown, fallback: string) =>
  e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : fallback;

/** "2 added, 1 updated, 5 unchanged" - only the parts that are not zero. */
function describe(s: SyncSummary): string {
  const parts = [
    s.created ? `${s.created} added` : '',
    s.updated ? `${s.updated} updated` : '',
    s.retired ? `${s.retired} retired` : '',
    s.unchanged ? `${s.unchanged} unchanged` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'nothing to record';
}

function skippedNote(skipped: SyncSummary['skipped']): string | null {
  const n = skipped.free + skipped.empty + skipped.notPerUser + skipped.deleted;
  if (n === 0) return null;
  // Said out loud so that "we recorded six" is never read as "you own six".
  return `${n} Microsoft product${n === 1 ? ' was' : 's were'} left out on purpose: free plans, tenant-wide entitlements and products with no seats.`;
}

export function M365LicencesCard() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const [tenantId, setTenantId] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState('');
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const status = useQuery({
    queryKey: KEY,
    queryFn: () => apiFetch<Status>('/integrations/m365-licences'),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: KEY });
    // The licence list and the dashboard tiles read what a sync writes.
    void queryClient.invalidateQueries({ queryKey: ['licenses'] });
  };

  const save = useMutation({
    mutationFn: (body: { tenantId: string; clientId: string; clientSecret?: string }) =>
      apiFetch<Status>('/integrations/m365-licences', { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('Microsoft 365 connection saved');
      setTenantId(null);
      setClientId(null);
      setClientSecret('');
      setTestResult(null);
      refresh();
    },
    onError: (e) => toast.error(problem(e, 'Could not save the connection')),
  });

  const test = useMutation({
    mutationFn: () => apiFetch<TestResult>('/integrations/m365-licences/test', { method: 'POST' }),
    onSuccess: (data) => setTestResult(data),
    onError: (e) => toast.error(problem(e, 'Could not test the connection')),
  });

  const sync = useMutation({
    mutationFn: () => apiFetch<SyncSummary>('/integrations/m365-licences/sync', { method: 'POST' }),
    onSuccess: (data) => {
      toast.success(`Microsoft 365 synced: ${describe(data)}`);
      setTestResult(null);
      refresh();
    },
    onError: (e) => {
      toast.error(problem(e, 'The sync did not complete'));
      // The failure is recorded on the connection; show it without a reload.
      refresh();
    },
  });

  const disconnect = useMutation({
    mutationFn: () => apiFetch<Status>('/integrations/m365-licences', { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Microsoft 365 disconnected');
      setTestResult(null);
      refresh();
    },
    onError: (e) => toast.error(problem(e, 'Could not disconnect')),
  });

  if (status.isPending) return <Skeleton className="h-56" />;
  if (status.isError) {
    return (
      <Card className="grid gap-2 p-5">
        <h2 className="text-sm font-semibold">Microsoft 365 licences</h2>
        <p className="text-sm text-[var(--tone-critical-fg)]">
          Could not load this connection: {(status.error as Error).message}
        </p>
      </Card>
    );
  }

  const s = status.data;
  const tenantValue = tenantId ?? s.tenantId ?? '';
  const clientValue = clientId ?? s.clientId ?? '';
  const idsChanged =
    tenantValue.trim() !== (s.tenantId ?? '') || clientValue.trim() !== (s.clientId ?? '');
  const canSave =
    tenantValue.trim() !== '' &&
    clientValue.trim() !== '' &&
    // First time, all three are needed. After that the secret is only sent
    // when it is being replaced.
    (s.connected ? idsChanged || clientSecret.trim() !== '' : clientSecret.trim() !== '');

  return (
    <Card className="grid gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Microsoft 365 licences</h2>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={
            s.connected
              ? { color: 'var(--tone-success-fg)', backgroundColor: 'var(--tone-success-bg)' }
              : {
                  color: 'var(--color-content-muted)',
                  backgroundColor: 'var(--color-surface-sunken)',
                }
          }
        >
          {s.connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <p className="text-xs text-[var(--color-content-subtle)]">
        Reads the Microsoft 365 subscriptions your company owns into{' '}
        <Link href="/licenses" className="underline">
          Licences
        </Link>
        : the product, seats bought, seats in use and the next renewal date. It refreshes every
        night. Microsoft does not share prices this way, so cost is still entered by Finance.
      </p>

      {/* The last result first: if last night's sync failed, that is the
          reason somebody opened this page. */}
      {s.lastSyncStatus === 'failed' ? (
        <div
          role="alert"
          className="rounded-[var(--radius-control)] border px-3 py-2.5 text-sm"
          style={{
            color: 'var(--tone-critical-fg)',
            backgroundColor: 'var(--tone-critical-bg)',
            borderColor: 'var(--tone-critical-border)',
          }}
        >
          <p className="font-semibold">The last sync did not complete.</p>
          <p className="mt-0.5">{s.lastSyncMessage}</p>
          {s.lastSyncAt ? (
            <p className="mt-1 text-xs">
              Licences still show what was read on {new Date(s.lastSyncAt).toLocaleString()}.
            </p>
          ) : null}
        </div>
      ) : s.lastSyncAt && s.lastSyncSummary ? (
        <div className="rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-3 py-2.5 text-sm">
          <p>
            <span className="font-semibold">
              {s.licences} licence{s.licences === 1 ? '' : 's'} synced.
            </span>{' '}
            Last read {new Date(s.lastSyncAt).toLocaleString()} ({describe(s.lastSyncSummary)}).
          </p>
          {skippedNote(s.lastSyncSummary.skipped) ? (
            <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
              {skippedNote(s.lastSyncSummary.skipped)}
            </p>
          ) : null}
          {s.lastSyncSummary.overAssigned.length > 0 ? (
            <p className="mt-1 text-xs" style={{ color: 'var(--tone-warning-fg)' }}>
              Microsoft reports more seats in use than owned for:{' '}
              {s.lastSyncSummary.overAssigned.map((o) => `${o.name} (over by ${o.by})`).join(', ')}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tenant ID" htmlFor="m365-tenant">
          <Input
            id="m365-tenant"
            value={tenantValue}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Client ID (application ID)" htmlFor="m365-client">
          <Input
            id="m365-client"
            value={clientValue}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      </div>
      <Field
        label={s.hasSecret ? 'Client secret (leave empty to keep the stored one)' : 'Client secret'}
        htmlFor="m365-secret"
      >
        <Input
          id="m365-secret"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder={s.hasSecret ? 'A secret is stored. It is never shown again.' : ''}
          autoComplete="new-password"
        />
      </Field>
      <p className="text-xs text-[var(--color-content-subtle)]">
        In the Microsoft Entra admin centre: create an app registration, add the application
        permission <code>Organization.Read.All</code>, grant admin consent, then create a client
        secret. The secret is stored encrypted and is never shown again; when it expires in Entra,
        paste the new one here.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          loading={save.isPending}
          disabled={!canSave}
          onClick={() =>
            save.mutate({
              tenantId: tenantValue.trim(),
              clientId: clientValue.trim(),
              ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
            })
          }
        >
          {s.connected ? 'Save changes' : 'Connect'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={test.isPending}
          disabled={!s.connected}
          onClick={() => test.mutate()}
        >
          Test connection
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={sync.isPending}
          disabled={!s.connected}
          onClick={() => sync.mutate()}
        >
          Sync now
        </Button>
        {s.connected ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={disconnect.isPending}
            onClick={() => {
              void confirm({
                title: 'Disconnect Microsoft 365?',
                body: 'Syncing stops and the stored secret is deleted. Licences already recorded stay as they are, with their cost and notes.',
                destructive: true,
              }).then((ok) => ok && disconnect.mutate());
            }}
          >
            Disconnect
          </Button>
        ) : null}
      </div>

      {testResult ? (
        testResult.ok ? (
          <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 py-2.5 text-sm">
            <p className="font-semibold">
              Microsoft answered. A sync would record {testResult.licences.length} licence
              {testResult.licences.length === 1 ? '' : 's'}:
            </p>
            {testResult.licences.length > 0 ? (
              <ul className="mt-1.5 grid gap-1 text-[13px]">
                {testResult.licences.map((l, i) => (
                  // By position: two Microsoft products can share a display name.
                  <li key={`${l.name}-${i}`} className="flex flex-wrap justify-between gap-x-4">
                    <span>{l.name}</span>
                    <span className="tabular-nums text-[var(--color-content-muted)]">
                      {l.seatsUsed} of {l.seatsPurchased} seats in use
                      {l.renewalDate
                        ? ` · renews ${new Date(l.renewalDate).toLocaleDateString()}`
                        : ' · no renewal date from Microsoft'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {skippedNote(testResult.skipped) ? (
              <p className="mt-1.5 text-xs text-[var(--color-content-subtle)]">
                {skippedNote(testResult.skipped)}
              </p>
            ) : null}
            <p className="mt-1.5 text-xs text-[var(--color-content-subtle)]">
              Nothing has been written yet. Press Sync now to record these.
            </p>
          </div>
        ) : (
          <div
            role="alert"
            className="rounded-[var(--radius-control)] border px-3 py-2.5 text-sm"
            style={{
              color: 'var(--tone-critical-fg)',
              backgroundColor: 'var(--tone-critical-bg)',
              borderColor: 'var(--tone-critical-border)',
            }}
          >
            <p className="font-semibold">The connection did not work.</p>
            <p className="mt-0.5">{testResult.message}</p>
          </div>
        )
      ) : null}
    </Card>
  );
}
