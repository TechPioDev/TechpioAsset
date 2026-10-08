'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WEBHOOK_EVENTS } from '@techpioasset/contracts';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { Button, Card, EmptyState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { Tone } from '@/components/assets/discovery-tabs';
import { M365LicencesCard } from '@/components/integrations/m365-licences-card';

/**
 * v2.6 A5 — the integrations hub. Secrets and tokens are shown exactly once,
 * in an amber "copy it now" panel; dead-lettered deliveries are surfaced, not
 * hidden. The API enforces integrations:manage regardless of what renders.
 */

interface Hub {
  sso: { provider: string; enabled: boolean };
  scim: { enabled: boolean; createdAt: string | null; lastUsedAt: string | null };
  webhooks: { events: string[]; deadDeliveries: number };
  teamAlerts: { webhookUrl: string | null };
  mail: { provider: string; from: string };
}

interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  deliveries: Record<string, number>;
}

interface DeliveryRow {
  id: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  lastAttemptAt: string | null;
}

const STATUS_TONE: Record<string, string> = {
  PENDING: 'neutral',
  DELIVERED: 'success',
  FAILED: 'warning',
  DEAD: 'critical',
};

function SecretPanel({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-[var(--radius-control)] border px-3 py-2.5 text-sm"
      style={{
        color: 'var(--tone-warning-fg)',
        backgroundColor: 'var(--tone-warning-bg)',
        borderColor: 'var(--tone-warning-border)',
      }}
    >
      <p className="font-semibold">{label} — shown once, copy it now:</p>
      <code className="mt-1 block select-all break-all text-xs">{value}</code>
    </div>
  );
}

export default function IntegrationsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [alertUrl, setAlertUrl] = useState<string | null>(null);

  const hub = useQuery({ queryKey: ['integrations-hub'], queryFn: () => apiFetch<Hub>('/integrations') });
  const webhooks = useQuery({
    queryKey: ['integrations-webhooks'],
    queryFn: () => apiFetch<WebhookRow[]>('/integrations/webhooks'),
  });
  const deliveries = useQuery({
    queryKey: ['integrations-deliveries', expanded],
    queryFn: () => apiFetch<DeliveryRow[]>(`/integrations/webhooks/${expanded}/deliveries`),
    enabled: expanded !== null,
  });

  const saveTeamAlerts = useMutation({
    mutationFn: (webhookUrl: string | null) =>
      apiFetch<{ webhookUrl: string | null }>('/integrations/team-alerts', {
        method: 'PATCH',
        body: { webhookUrl },
      }),
    onSuccess: (data) => {
      toast.success(data.webhookUrl ? 'Team alerts configured' : 'Team alerts turned off');
      setAlertUrl(null);
      void queryClient.invalidateQueries({ queryKey: ['integrations-hub'] });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save'),
  });

  const testTeamAlerts = useMutation({
    mutationFn: () =>
      apiFetch<{ delivered: boolean; simulated?: boolean }>('/integrations/team-alerts/test', {
        method: 'POST',
        body: {},
      }),
    onSuccess: (r) =>
      r.delivered
        ? toast.success('Test alert posted — check the channel')
        : toast.error(
            r.simulated
              ? 'Chat delivery is simulated on this server (CHAT_PROVIDER is not "webhook")'
              : 'The webhook refused the test message — check the URL',
          ),
    onError: (e) =>
      toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Test failed'),
  });

  const testMail = useMutation({
    mutationFn: () =>
      apiFetch<{ provider: string; delivered: boolean; to: string }>('/integrations/mail/test', {
        method: 'POST',
        body: {},
      }),
    onSuccess: (r) =>
      r.delivered
        ? toast.success(`Test email sent to ${r.to}`)
        : toast.error('Email is SIMULATED on this server — configure SMTP to actually deliver'),
    onError: (e) =>
      toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Test failed'),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['integrations-hub'] });
    void queryClient.invalidateQueries({ queryKey: ['integrations-webhooks'] });
  };

  const onError = (caught: unknown) =>
    toast.error(
      caught instanceof ApiError ? (caught.problem.detail ?? caught.problem.title) : 'The action failed.',
    );

  const createWebhook = useMutation({
    mutationFn: () => apiFetch<{ secret: string }>('/integrations/webhooks', { method: 'POST', body: { url: url.trim(), events } }),
    onSuccess: (data) => {
      setNewSecret(data.secret);
      setUrl('');
      setEvents([]);
      refresh();
    },
    onError,
  });
  const toggleWebhook = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      apiFetch(`/integrations/webhooks/${input.id}`, { method: 'PATCH', body: { isActive: input.isActive } }),
    onSuccess: refresh,
    onError,
  });
  const removeWebhook = useMutation({
    mutationFn: (id: string) => apiFetch(`/integrations/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError,
  });
  const mintToken = useMutation({
    mutationFn: () => apiFetch<{ token: string; endpoint: string }>('/integrations/scim/token', { method: 'POST', body: {} }),
    onSuccess: (data) => {
      setNewToken(data.token);
      refresh();
    },
    onError,
  });
  const revokeToken = useMutation({
    mutationFn: () => apiFetch('/integrations/scim/token', { method: 'DELETE' }),
    onSuccess: () => {
      setNewToken(null);
      toast.success('SCIM token revoked.');
      refresh();
    },
    onError,
  });

  if (hub.isPending) return <Skeleton className="h-80" />;
  if (hub.isError) {
    return <ErrorState title="Could not load integrations" detail={(hub.error as Error).message} />;
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Integrations</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Webhooks out, SCIM provisioning in, SSO status. Secrets appear exactly once.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium text-[var(--color-content-subtle)]">Single sign-on</p>
          <p className="mt-1 text-sm font-semibold">
            {hub.data.sso.enabled ? `Enabled (${hub.data.sso.provider})` : 'Disabled'}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-content-subtle)]">
            Configured via ENTRA_* environment variables.
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-[var(--color-content-subtle)]">SCIM provisioning</p>
          <p className="mt-1 text-sm font-semibold">{hub.data.scim.enabled ? 'Token active' : 'No token'}</p>
          <p className="mt-0.5 text-xs text-[var(--color-content-subtle)]">
            {hub.data.scim.lastUsedAt
              ? `Last used ${new Date(hub.data.scim.lastUsedAt).toLocaleString()}`
              : hub.data.scim.enabled
                ? 'Never used yet'
                : 'Mint a token to enable /scim/v2'}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-[var(--color-content-subtle)]">Dead-lettered deliveries</p>
          <p
            className="mt-1 text-sm font-semibold"
            style={hub.data.webhooks.deadDeliveries > 0 ? { color: 'var(--tone-critical-fg)' } : undefined}
          >
            {hub.data.webhooks.deadDeliveries}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-content-subtle)]">
            Gave up after 5 attempts — inspect below.
          </p>
        </Card>
      </div>

      {/* v3.12 - its own component with its own queries, so a Microsoft outage
          cannot stop the rest of this page from loading. */}
      <M365LicencesCard />

      <Card className="grid gap-3 p-5">
        <h2 className="text-sm font-semibold">SCIM token</h2>
        {newToken ? <SecretPanel label="SCIM bearer token" value={newToken} /> : null}
        <p className="text-xs text-[var(--color-content-subtle)]">
          Point your identity provider at <code>/api/v1/scim/v2</code> with this bearer token.
          Minting again rotates it; the old token stops working immediately.
        </p>
        <div className="flex gap-2">
          <Button size="sm" loading={mintToken.isPending} onClick={() => mintToken.mutate()}>
            {hub.data.scim.enabled ? 'Rotate token' : 'Mint token'}
          </Button>
          {hub.data.scim.enabled ? (
            <Button
              size="sm"
              variant="secondary"
              loading={revokeToken.isPending}
              onClick={() => {
                void confirm({
                  title: 'Revoke the SCIM token?',
                  body: 'Provisioning from your IdP stops until a new token is minted.',
                  destructive: true,
                }).then((ok) => ok && revokeToken.mutate());
              }}
            >
              Revoke
            </Button>
          ) : null}
        </div>
      </Card>

      <Card className="grid gap-3 p-5">
        <h2 className="text-sm font-semibold">Team alerts (Teams / Slack)</h2>
        <p className="text-xs text-[var(--color-content-subtle)]">
          Paste an incoming-webhook URL from a Teams or Slack channel. High-signal events —
          overdue approvals, low stock, licence expiry, security alerts — are posted there, once
          per event. Personal notifications never go to the channel.
        </p>
        <Field label="Incoming webhook URL (https)" htmlFor="ta-url">
          <Input
            id="ta-url"
            value={alertUrl ?? hub.data.teamAlerts.webhookUrl ?? ''}
            onChange={(e) => setAlertUrl(e.target.value)}
            placeholder="https://outlook.office.com/webhook/… or https://hooks.slack.com/services/…"
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            loading={saveTeamAlerts.isPending}
            disabled={alertUrl === null || alertUrl === (hub.data.teamAlerts.webhookUrl ?? '')}
            onClick={() => saveTeamAlerts.mutate(alertUrl?.trim() ? alertUrl.trim() : null)}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={testTeamAlerts.isPending}
            disabled={!hub.data.teamAlerts.webhookUrl}
            onClick={() => testTeamAlerts.mutate()}
          >
            Send test alert
          </Button>
          {hub.data.teamAlerts.webhookUrl ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={saveTeamAlerts.isPending}
              onClick={() => saveTeamAlerts.mutate(null)}
            >
              Turn off
            </Button>
          ) : null}
        </div>
      </Card>

      <Card className="grid gap-3 p-5">
        <h2 className="text-sm font-semibold">Email delivery</h2>
        <p className="text-sm">
          Provider:{' '}
          <span
            className="font-semibold"
            style={
              hub.data.mail.provider === 'mock' ? { color: 'var(--tone-warning-fg)' } : undefined
            }
          >
            {hub.data.mail.provider === 'mock' ? 'Simulated (no real email is sent)' : 'SMTP'}
          </span>
          {'  ·  from '}
          <code className="text-xs">{hub.data.mail.from}</code>
        </p>
        <p className="text-xs text-[var(--color-content-subtle)]">
          {hub.data.mail.provider === 'mock'
            ? 'Invitations and notification emails are written to a file on the server instead of being delivered. To send real email, set MAIL_PROVIDER=smtp plus SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD / MAIL_FROM in the server environment and restart the API.'
            : 'Emails are delivered through the configured SMTP server.'}
        </p>
        <div>
          <Button size="sm" variant="secondary" loading={testMail.isPending} onClick={() => testMail.mutate()}>
            Send me a test email
          </Button>
        </div>
      </Card>

      <Card className="grid gap-3 p-5">
        <h2 className="text-sm font-semibold">Register a webhook</h2>
        {newSecret ? <SecretPanel label="Signing secret" value={newSecret} /> : null}
        <Field label="Endpoint URL (https)" htmlFor="wh-url">
          <Input
            id="wh-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/hooks/pioassets"
          />
        </Field>
        <div>
          <p className="mb-1.5 text-xs font-medium text-[var(--color-content-muted)]">Events</p>
          <div className="flex flex-wrap gap-1.5">
            {WEBHOOK_EVENTS.map((event) => {
              const active = events.includes(event);
              return (
                <button
                  key={event}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setEvents((prev) => (active ? prev.filter((e) => e !== event) : [...prev, event]))
                  }
                  className={
                    active
                      ? 'rounded-full bg-[var(--color-brand)] px-3 py-1 text-xs font-semibold text-white'
                      : 'rounded-full border border-[var(--color-border-strong)] px-3 py-1 text-xs font-medium text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]'
                  }
                >
                  <span aria-hidden="true">{active ? '✓ ' : '+ '}</span>
                  {event}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            loading={createWebhook.isPending}
            disabled={!url.trim() || events.length === 0}
            onClick={() => createWebhook.mutate()}
          >
            Register webhook
          </Button>
          {!url.trim() || events.length === 0 ? (
            <p className="text-xs text-[var(--color-content-muted)]">
              {!url.trim() && events.length === 0
                ? 'Enter the endpoint URL and pick at least one event.'
                : !url.trim()
                  ? 'Enter the endpoint URL.'
                  : 'Pick at least one event to subscribe to.'}
            </p>
          ) : null}
        </div>
      </Card>

      <Card>
        <h2 className="border-b border-[var(--color-border)] px-4 py-3 text-sm font-semibold">Webhooks</h2>
        {webhooks.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-10" />
          </div>
        ) : webhooks.isError || !webhooks.data || webhooks.data.length === 0 ? (
          <EmptyState title="No webhooks" description="Register one above to push events out." />
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {webhooks.data.map((row) => (
              <div key={row.id} className="grid gap-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-sm font-medium">{row.url}</code>
                  {!row.isActive ? <Tone tone="muted">paused</Tone> : null}
                  {(row.deliveries.DEAD ?? 0) > 0 ? (
                    <Tone tone="critical">{row.deliveries.DEAD} dead</Tone>
                  ) : null}
                  <span className="ml-auto flex gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      {expanded === row.id ? 'Hide deliveries' : 'Deliveries'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={toggleWebhook.isPending}
                      onClick={() => toggleWebhook.mutate({ id: row.id, isActive: !row.isActive })}
                    >
                      {row.isActive ? 'Pause' : 'Resume'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={removeWebhook.isPending}
                      onClick={() => removeWebhook.mutate(row.id)}
                    >
                      Delete
                    </Button>
                  </span>
                </div>
                <p className="text-xs text-[var(--color-content-subtle)]">
                  {row.events.join(' · ')} — delivered {row.deliveries.DELIVERED ?? 0}, failed{' '}
                  {row.deliveries.FAILED ?? 0}, dead {row.deliveries.DEAD ?? 0}
                </p>
                {expanded === row.id ? (
                  deliveries.isPending ? (
                    <Skeleton className="h-16" />
                  ) : deliveries.data && deliveries.data.length > 0 ? (
                    <div className="grid gap-1 rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] p-2.5">
                      {deliveries.data.map((d) => (
                        <div key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
                          <Tone tone={STATUS_TONE[d.status] ?? 'neutral'}>{d.status.toLowerCase()}</Tone>
                          <span className="font-medium">{d.event}</span>
                          <span className="text-[var(--color-content-subtle)]">
                            {d.attempts} attempt(s)
                            {d.responseStatus ? ` · HTTP ${d.responseStatus}` : ''}
                            {d.lastError ? ` · ${d.lastError}` : ''}
                            {d.lastAttemptAt ? ` · ${new Date(d.lastAttemptAt).toLocaleString()}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--color-content-subtle)]">No deliveries yet.</p>
                  )
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
