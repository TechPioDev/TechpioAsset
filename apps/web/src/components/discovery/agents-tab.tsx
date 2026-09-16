'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, EyeOff, Laptop, RefreshCw, ShieldOff, Trash2, X } from 'lucide-react';
import type { EnrolmentTokenStatus } from '@techpioasset/contracts';
import {
  LATEST_AGENT_VERSION,
  PERMISSIONS,
  buildAgentInstallCommand,
  type AgentStatus,
} from '@techpioasset/domain';
import { apiFetch, apiBaseUrl, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { Button, Card, EmptyState, Field, NativeSelect, Skeleton } from '@/components/ui';

/**
 * Discovery → Agents (v2.13, token persistence v2.60).
 *
 * Two things IT needs in one place: the enrolment token that installers carry,
 * and the truth about the laptops reporting. Both used to mislead. The token
 * was shown once and stored only as a hash, so an admin who lost it pressed
 * Generate — which silently broke every installer carrying the old one (six
 * times in production). And a laptop whose credential was being refused every
 * day looked exactly like one that was switched off. The token is now kept and
 * can be shown again; replacing it is a deliberate act with a grace period;
 * and a refused agent says so, with the command that fixes it.
 */

interface AgentRow {
  id: string;
  machineId: string;
  hostname: string | null;
  serialNumber: string | null;
  platform: string | null;
  agentVersion: string | null;
  enrolledAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  lastRejectedAt: string | null;
  rejectCount: number;
  status: AgentStatus;
  updateAvailable: boolean;
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  ACTIVE: 'Active',
  OFFLINE: 'Offline',
  CREDENTIAL_REJECTED: 'Credential rejected — reinstall',
  REVOKED: 'Revoked',
};

const STATUS_TONE: Record<AgentStatus, string> = {
  ACTIVE: 'success',
  OFFLINE: 'warning',
  CREDENTIAL_REJECTED: 'critical',
  REVOKED: 'neutral',
};

const GRACE_OPTIONS = [
  { days: 0, label: 'No grace — the old token stops working now' },
  { days: 1, label: '1 day' },
  { days: 7, label: '7 days (recommended)' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
];

/** "3 hours ago" — a device list is read for recency, not timestamps. */
function sinceLabel(value: string | null): string {
  if (!value) return 'never';
  const ms = Date.now() - new Date(value).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function dayLabel(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : fallback;
}

export function AgentsTab() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const canManage = can(PERMISSIONS.DISCOVERY_INGEST);
  const canRevoke = can(PERMISSIONS.DISCOVERY_RECONCILE);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [graceDays, setGraceDays] = useState(7);

  const agents = useQuery({
    queryKey: ['discovery-agents'],
    queryFn: () => apiFetch<AgentRow[]>('/discovery/agents'),
  });

  const token = useQuery({
    queryKey: ['discovery-enrolment-token'],
    queryFn: () => apiFetch<EnrolmentTokenStatus>('/discovery/agents/enrolment-token'),
    enabled: canManage,
  });

  // The install command is built HERE rather than taken from the API response:
  // this page knows the browser's own origin and API base, which is what the
  // laptop must reach. The builder is shared with the API so both agree.
  const scriptUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/downloads/TechpioAgent.ps1`
      : '/downloads/TechpioAgent.ps1';
  const installCommand = buildAgentInstallCommand({
    scriptUrl,
    portalUrl: apiBaseUrl,
    enrolmentToken: revealed ?? '<your-token>',
  });

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  };

  const refreshToken = () => qc.invalidateQueries({ queryKey: ['discovery-enrolment-token'] });

  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ token: string }>('/discovery/agents/enrolment-token', { method: 'POST', body: {} }),
    onSuccess: async (res) => {
      setRevealed(res.token);
      await refreshToken();
      toast.success('Enrolment token generated');
    },
    onError: (e) => toast.error(errorText(e, 'Could not generate a token')),
  });

  const reveal = useMutation({
    mutationFn: () =>
      apiFetch<{ token: string }>('/discovery/agents/enrolment-token/reveal', {
        method: 'POST',
        body: {},
      }),
    onSuccess: (res) => setRevealed(res.token),
    onError: (e) => toast.error(errorText(e, 'Could not show the token')),
  });

  const replace = useMutation({
    mutationFn: (days: number) =>
      apiFetch<{ token: string }>('/discovery/agents/enrolment-token/replace', {
        method: 'POST',
        body: { graceDays: days },
      }),
    onSuccess: async (res) => {
      setRevealed(res.token);
      setReplacing(false);
      await refreshToken();
      toast.success('New enrolment token in use');
    },
    onError: (e) => toast.error(errorText(e, 'Could not replace the token')),
  });

  const revokeToken = useMutation({
    mutationFn: () => apiFetch('/discovery/agents/enrolment-token', { method: 'DELETE' }),
    onSuccess: async () => {
      setRevealed(null);
      await refreshToken();
      toast.success('Enrolment disabled — no new laptop can enrol');
    },
    onError: () => toast.error('Could not disable enrolment'),
  });

  const revokeAgent = useMutation({
    mutationFn: (id: string) => apiFetch(`/discovery/agents/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Agent revoked — its credential stops working immediately');
      await qc.invalidateQueries({ queryKey: ['discovery-agents'] });
    },
    onError: () => toast.error('Could not revoke that agent'),
  });

  /** Show the fix command for one laptop: the same install line, revealed. */
  const copyFixCommand = async () => {
    try {
      const secret = revealed ?? (await reveal.mutateAsync()).token;
      await copy(
        buildAgentInstallCommand({ scriptUrl, portalUrl: apiBaseUrl, enrolmentToken: secret }),
        'Fix command',
      );
    } catch (e) {
      toast.error(errorText(e, 'Could not build the fix command'));
    }
  };

  const rows = agents.data ?? [];
  const counts = rows.reduce<Record<AgentStatus, number>>(
    (acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }),
    { ACTIVE: 0, OFFLINE: 0, CREDENTIAL_REJECTED: 0, REVOKED: 0 },
  );
  const summary = (['ACTIVE', 'CREDENTIAL_REJECTED', 'OFFLINE', 'REVOKED'] as AgentStatus[])
    .filter((status) => counts[status] > 0)
    .map((status) => `${counts[status]} ${STATUS_LABEL[status].replace(/ —.*$/, '').toLowerCase()}`)
    .join(' · ');
  const state = token.data;

  return (
    <div className="grid gap-4">
      {canManage ? (
        <Card className="grid gap-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Enrolment token</h2>
              <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
                Installers carry this to enrol a laptop. It can only be exchanged for a device
                credential — it cannot read or write anything on its own. It is kept, so you can
                show it again whenever you need it.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {state && !state.exists ? (
                <Button size="sm" loading={create.isPending} onClick={() => create.mutate()}>
                  <RefreshCw aria-hidden="true" className="size-3.5" /> Generate token
                </Button>
              ) : null}
              {state?.exists ? (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setReplacing(true)}
                  >
                    <RefreshCw aria-hidden="true" className="size-3.5" /> Replace token…
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={revokeToken.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Disable agent enrolment?',
                        body: 'The token and any grace token stop working, so no new laptop can enrol until you generate one again. Laptops already enrolled keep reporting.',
                        confirmLabel: 'Revoke',
                        destructive: true,
                      });
                      if (ok) revokeToken.mutate();
                    }}
                  >
                    <ShieldOff aria-hidden="true" className="size-3.5" /> Revoke…
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          {token.isPending ? <Skeleton className="h-10" /> : null}

          {state?.exists ? (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-3 py-2 font-mono text-xs">
                  {revealed ?? '••••••••••••••••••••••••••••'}
                </code>
                {state.revealable ? (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={reveal.isPending}
                      onClick={() => (revealed ? setRevealed(null) : reveal.mutate())}
                    >
                      {revealed ? (
                        <>
                          <EyeOff aria-hidden="true" className="size-3.5" /> Hide
                        </>
                      ) : (
                        <>
                          <Eye aria-hidden="true" className="size-3.5" /> Show
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!revealed}
                      onClick={() => revealed && copy(revealed, 'Token')}
                    >
                      <Copy aria-hidden="true" className="size-3.5" /> Copy token
                    </Button>
                  </>
                ) : null}
              </div>

              {!state.revealable && state.unrevealableMessage ? (
                <p
                  className="rounded-[var(--radius-control)] border px-3 py-2 text-xs"
                  style={{
                    color: 'var(--tone-warning-fg)',
                    backgroundColor: 'var(--tone-warning-bg)',
                    borderColor: 'var(--tone-warning-border)',
                  }}
                >
                  {state.unrevealableMessage}
                </p>
              ) : null}

              <p className="text-xs text-[var(--color-content-subtle)]">
                {state.createdAt ? `Created ${dayLabel(state.createdAt)}` : null}
                {state.createdBy ? ` by ${state.createdBy.name}` : ''}
                {` · last used to enrol a laptop ${sinceLabel(state.lastUsedAt)}`}
              </p>
              {state.graceToken ? (
                <p className="text-xs text-[var(--color-content-muted)]">
                  The previous token still enrols new laptops until{' '}
                  {dayLabel(state.graceToken.expiresAt)}.
                </p>
              ) : null}

              <div>
                <p className="text-xs font-medium text-[var(--color-content-subtle)]">
                  Run this on each laptop, elevated:
                </p>
                <div className="mt-1 flex items-start gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-3 py-2 text-xs">
                    {installCommand}
                  </code>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label="Copy install command"
                    disabled={!revealed}
                    onClick={() => copy(installCommand, 'Command')}
                  >
                    <Copy aria-hidden="true" className="size-3.5" />
                  </Button>
                </div>
                <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
                  {revealed
                    ? 'Downloads the agent from this portal and installs its scheduled task — one run per machine, from any folder.'
                    : 'Show the token to fill the command in.'}
                </p>
              </div>
            </div>
          ) : null}

          {state && !state.exists ? (
            <p className="text-xs text-[var(--color-content-muted)]">
              No token yet — generate one to enrol laptops. Laptops already enrolled keep reporting
              either way.
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-5 py-3">
          <h2 className="text-sm font-semibold">
            Enrolled laptops
            {summary ? (
              <span className="ml-2 text-xs font-normal text-[var(--color-content-subtle)]">
                {summary}
              </span>
            ) : null}
          </h2>
        </div>

        {agents.isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No laptops enrolled yet"
            description="Generate an enrolment token above and run the agent on a machine. It appears here within a minute of its first report."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-content-subtle)]">
                  <th className="px-5 py-2.5 font-medium">Laptop</th>
                  <th className="px-4 py-2.5 font-medium">Serial</th>
                  <th className="px-4 py-2.5 font-medium">Agent</th>
                  <th className="px-4 py-2.5 font-medium">Last reported</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  {canManage || canRevoke ? <th className="px-4 py-2.5" /> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const tone = STATUS_TONE[row.status];
                  const needsFix = row.status === 'CREDENTIAL_REJECTED' || row.updateAvailable;
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-sunken)]"
                    >
                      <td className="px-5 py-2.5">
                        <span className="flex items-center gap-2 font-medium">
                          <Laptop
                            aria-hidden="true"
                            className="size-3.5 text-[var(--color-content-subtle)]"
                          />
                          {row.hostname ?? 'Unnamed device'}
                        </span>
                        <span className="font-mono text-[11px] text-[var(--color-content-subtle)]">
                          {row.machineId.slice(0, 18)}…
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">{row.serialNumber ?? '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-[var(--color-content-muted)]">
                        {row.platform ?? '—'}
                        {row.agentVersion ? ` · v${row.agentVersion}` : ''}
                        {row.updateAvailable && !row.revokedAt ? (
                          <span className="ml-1.5 whitespace-nowrap text-[11px] font-medium text-[var(--tone-warning-fg)]">
                            Update available (v{LATEST_AGENT_VERSION})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[var(--color-content-muted)]">
                        {sinceLabel(row.lastSeenAt)}
                        {row.status === 'CREDENTIAL_REJECTED' && row.lastRejectedAt ? (
                          <span className="block text-[11px] text-[var(--tone-critical-fg)]">
                            refused {sinceLabel(row.lastRejectedAt)}
                            {row.rejectCount > 1 ? ` (${row.rejectCount}×)` : ''}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={
                            tone === 'neutral'
                              ? {
                                  background: 'var(--color-surface-sunken)',
                                  color: 'var(--color-content-muted)',
                                }
                              : {
                                  background: `var(--tone-${tone}-bg)`,
                                  color: `var(--tone-${tone}-fg)`,
                                }
                          }
                        >
                          {STATUS_LABEL[row.status]}
                        </span>
                      </td>
                      {canManage || canRevoke ? (
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canManage && needsFix && !row.revokedAt && state?.revealable ? (
                              <button
                                type="button"
                                onClick={copyFixCommand}
                                className="rounded px-2 py-1 text-[11px] font-medium text-[var(--color-content-muted)] hover:text-[var(--color-brand)]"
                              >
                                Copy fix command
                              </button>
                            ) : null}
                            {canRevoke && !row.revokedAt ? (
                              <button
                                type="button"
                                aria-label={`Revoke ${row.hostname ?? row.machineId}`}
                                onClick={async () => {
                                  const ok = await confirm({
                                    title: `Revoke ${row.hostname ?? 'this laptop'}?`,
                                    body: 'Its agent stops being able to report immediately. The enrolment history is kept, and the laptop can be enrolled again later.',
                                    confirmLabel: 'Revoke',
                                    destructive: true,
                                  });
                                  if (ok) revokeAgent.mutate(row.id);
                                }}
                                className="rounded p-1 text-[var(--color-content-subtle)] hover:text-[var(--tone-critical-fg)]"
                              >
                                <Trash2 aria-hidden="true" className="size-3.5" />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {replacing ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Replace enrolment token"
        >
          <div className="w-full max-w-lg rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Replace enrolment token</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setReplacing(false)}
                className="grid size-8 place-items-center rounded-lg hover:bg-[var(--color-surface-sunken)]"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
            <div className="mt-4 grid gap-4">
              <p className="text-sm text-[var(--color-content-muted)]">
                Laptops that are already enrolled keep working — this only affects enrolling new
                ones. Scripts and shortcuts carrying the old token keep enrolling until the grace
                period ends.
              </p>
              <Field label="Old token keeps enrolling for" htmlFor="grace-days">
                <NativeSelect
                  id="grace-days"
                  className="w-full"
                  value={String(graceDays)}
                  onChange={(e) => setGraceDays(Number(e.target.value))}
                >
                  {GRACE_OPTIONS.map((option) => (
                    <option key={option.days} value={option.days}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setReplacing(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  loading={replace.isPending}
                  onClick={() => replace.mutate(graceDays)}
                >
                  Replace token
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
