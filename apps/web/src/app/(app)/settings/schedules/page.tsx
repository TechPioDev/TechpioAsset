'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, EmptyState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { Breadcrumbs } from '@/components/breadcrumbs';

/**
 * v2.6 A2 — scheduled-report management. The list shows the honest outcome of
 * the last run (SUCCESS or the recorded failure reason) and the next due time;
 * pausing stops the runner, resuming re-arms from now.
 */

interface ScheduleRow {
  id: string;
  name: string;
  resource: string;
  format: string;
  cron: string;
  recipients: string[];
  isActive: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  nextRunAt: string | null;
  /** The company zone the schedule's times are read in. */
  timezone: string;
}

const REPORTS = [
  { type: 'ASSET_INVENTORY', label: 'Asset inventory', financial: false },
  { type: 'WARRANTY_EXPIRY', label: 'Warranty expiry', financial: false },
  { type: 'SPENDING_BY_VENDOR', label: 'Spending by vendor', financial: true },
  { type: 'SPENDING_BY_CATEGORY', label: 'Spending by category', financial: true },
  { type: 'SPENDING_BY_DEPARTMENT', label: 'Spending by department', financial: true },
  { type: 'DEPRECIATION', label: 'Depreciation', financial: true },
  { type: 'MAINTENANCE_COST', label: 'Maintenance cost', financial: true },
] as const;

const CRON_PRESETS = [
  { label: 'Every Monday 08:00', value: '0 8 * * 1' },
  { label: 'Daily 07:00', value: '0 7 * * *' },
  { label: 'First of the month 06:00', value: '0 6 1 * *' },
] as const;

function fmt(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

export default function SchedulesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = can(PERMISSIONS.REPORTS_EXPORT);
  const canSeeCost = can(PERMISSIONS.ASSETS_COST_READ);

  const [name, setName] = useState('');
  const [type, setType] = useState('ASSET_INVENTORY');
  const [format, setFormat] = useState('CSV');
  const [cron, setCron] = useState<string>(CRON_PRESETS[0].value);
  const [recipients, setRecipients] = useState('');

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['schedules'],
    queryFn: () => apiFetch<ScheduleRow[]>('/scheduled/reports'),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['schedules'] });

  const create = useMutation({
    mutationFn: () =>
      apiFetch('/scheduled/reports', {
        method: 'POST',
        body: {
          name: name.trim(),
          type,
          format,
          cron,
          recipients: recipients
            .split(/[,;\s]+/)
            .map((r) => r.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      toast.success('Schedule created.');
      setName('');
      setRecipients('');
      void refresh();
    },
    onError: (caught) =>
      toast.error(
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title)
          : 'Could not create the schedule.',
      ),
  });

  const toggle = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      apiFetch(`/scheduled/reports/${input.id}`, {
        method: 'PATCH',
        body: { isActive: input.isActive },
      }),
    onSuccess: () => void refresh(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/scheduled/reports/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Schedule deleted.');
      void refresh();
    },
  });

  const available = REPORTS.filter((r) => !r.financial || canSeeCost);

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <div>
        <Breadcrumbs items={[{ label: 'Reports', href: '/reports' }, { label: 'Schedules' }]} />
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Scheduled reports</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Recurring reports delivered by email. The last-run column shows the honest outcome —
          a failed run says so and notifies the owner.
        </p>
      </div>

      {canManage ? (
        <Card className="grid gap-3 p-5">
          <h2 className="text-sm font-semibold">New schedule</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="sch-name">
              <Input
                id="sch-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Weekly asset inventory"
              />
            </Field>
            <Field label="Report" htmlFor="sch-type">
              <select
                id="sch-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 text-sm"
              >
                {available.map((r) => (
                  <option key={r.type} value={r.type}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Format" htmlFor="sch-format">
              <select
                id="sch-format"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 text-sm"
              >
                <option value="CSV">CSV</option>
                <option value="EXCEL">Excel</option>
              </select>
            </Field>
            <Field label="Schedule" htmlFor="sch-cron">
              <select
                id="sch-cron"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 text-sm"
              >
                {CRON_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
                {data?.[0]?.timezone
                  ? `Times are in the company timezone, ${data[0].timezone}.`
                  : 'Times are in the company timezone, set under Settings › Organisation.'}
              </p>
            </Field>
          </div>
          <Field label="Recipients (comma-separated emails)" htmlFor="sch-rcpt">
            <Input
              id="sch-rcpt"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder="finance@example.com, it@example.com"
            />
          </Field>
          <Button
            className="justify-self-start"
            loading={create.isPending}
            disabled={!name.trim() || !recipients.trim()}
            onClick={() => create.mutate()}
          >
            Create schedule
          </Button>
        </Card>
      ) : null}

      <Card>
        {isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Could not load schedules" detail={(error as Error).message} />
        ) : data.length === 0 ? (
          <EmptyState
            title="No scheduled reports"
            description="Create one above — it is generated and emailed on the schedule."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Scheduled reports</caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th scope="col" className="px-4 py-2.5 font-medium">Schedule</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Last run</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Next due</th>
                  {canManage ? (
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.map((row) => {
                  const failed = row.lastRunStatus?.startsWith('FAILURE');
                  return (
                    <tr key={row.id} className={row.isActive ? '' : 'opacity-60'}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{row.name}</p>
                        <p className="text-xs text-[var(--color-content-subtle)]">
                          {row.resource.replace(/_/g, ' ').toLowerCase()} · {row.format} ·{' '}
                          {row.recipients.length} recipient(s)
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-[var(--color-content-muted)]">{fmt(row.lastRunAt)}</p>
                        {row.lastRunStatus ? (
                          <p
                            className="text-xs"
                            style={{
                              color: failed ? 'var(--tone-critical-fg)' : 'var(--tone-success-fg)',
                            }}
                          >
                            {row.lastRunStatus}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                        {row.isActive ? fmt(row.nextRunAt) : 'Paused'}
                      </td>
                      {canManage ? (
                        <td className="px-4 py-2.5">
                          <span className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={toggle.isPending}
                              onClick={() => toggle.mutate({ id: row.id, isActive: !row.isActive })}
                            >
                              {row.isActive ? 'Pause' : 'Resume'}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={remove.isPending}
                              onClick={() => remove.mutate(row.id)}
                            >
                              Delete
                            </Button>
                          </span>
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
    </div>
  );
}
