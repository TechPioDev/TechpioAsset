'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { AUDIT_ACTIONS } from '@techpioasset/contracts';
import { apiFetchPage } from '@/lib/api-client';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  /** Server-resolved human name for the entity (user, asset tag, role...). */
  entityLabel: string | null;
  previousValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
  actor: {
    id: string;
    email: string;
    profile: { firstName: string; lastName: string } | null;
  } | null;
}

function actionLabel(action: string): string {
  return action
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Actions get a tone so the eye can triage the stream at a glance.
function actionTone(action: string): string {
  if (/REJECTED|FAILED|DISABLED|ARCHIVED|DISPOSAL/.test(action)) return 'critical';
  if (/CREATED|APPROVED|ENROLLED|SUBMITTED/.test(action)) return 'success';
  if (/CHANGED|UPDATED|ADJUSTED|CORRECTION|TRANSFERRED|RETURNED/.test(action)) return 'warning';
  return 'info';
}

function fmtTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Compact "field: a → b" summary of what changed on a row. */
function changeSummary(row: AuditRow): string {
  const before = row.previousValues ?? {};
  const after = row.newValues ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  if (keys.length === 0) return row.reason ?? '—';
  return keys
    .slice(0, 3)
    .map((k) => {
      const a = before[k as keyof typeof before];
      const b = after[k as keyof typeof after];
      const fmt = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v == null ? '∅' : String(v));
      return a !== undefined && b !== undefined ? `${k}: ${fmt(a)} → ${fmt(b)}` : `${k}: ${fmt(b)}`;
    })
    .join(' · ');
}

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [entityType, setEntityType] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setEntityType(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ page: String(page), pageSize: '30' });
  if (action) params.set('action', action);
  if (entityType) params.set('entityType', entityType);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['audit', action, entityType, page],
    queryFn: () => apiFetchPage<AuditRow>(`/audit?${params.toString()}`),
  });

  const hasFilters = action !== '' || entityType !== '';

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          An append-only record of every sensitive action. Entries can’t be edited or deleted.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--color-content-subtle)]"
          />
          <Input
            type="search"
            aria-label="Filter by entity type"
            placeholder="Filter by entity (Asset, User, Request…)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          aria-label="Filter by action"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-sm"
        >
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {actionLabel(a)}
            </option>
          ))}
        </select>
        {hasFilters ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSearch('');
              setEntityType('');
              setAction('');
              setPage(1);
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>

      <Card>
        {isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Could not load the audit log" detail={(error as Error).message} />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="No matching entries"
            description={
              hasFilters ? 'Try clearing the filters.' : 'Nothing has been recorded yet.'
            }
          />
        ) : (
          <>
          {/* v2.71 - on a phone each entry is a card: what happened and when on
              one line, to what and by whom under it, then what changed. Five
              columns made this the widest page in the product on a phone. */}
          <ul className="divide-y divide-[var(--color-border)] sm:hidden">
            {data.data.map((row) => {
              const tone = actionTone(row.action);
              const actorName = row.actor
                ? row.actor.profile
                  ? `${row.actor.profile.firstName} ${row.actor.profile.lastName}`
                  : row.actor.email
                : 'System';
              const changes = changeSummary(row);
              return (
                <li key={row.id} className="px-4 py-3">
                  <p className="flex items-start justify-between gap-2">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{
                        color: `var(--tone-${tone}-fg)`,
                        backgroundColor: `var(--tone-${tone}-bg)`,
                      }}
                    >
                      {actionLabel(row.action)}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--color-content-subtle)]">
                      {fmtTime(row.createdAt)}
                    </span>
                  </p>
                  <p className="mt-1.5 text-sm">
                    <span className="text-[var(--color-content-muted)]">{row.entityType}</span>{' '}
                    <span className="font-medium">
                      {row.entityLabel ?? row.entityId.slice(0, 8)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">by {actorName}</p>
                  {changes ? (
                    <div className="mt-1.5 text-xs break-words text-[var(--color-content-muted)]">
                      {changes}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Audit entries, {data.meta.page.totalItems} in total
              </caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    When
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Action
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Entity
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Actor
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.data.map((row) => {
                  const tone = actionTone(row.action);
                  const actorName = row.actor
                    ? row.actor.profile
                      ? `${row.actor.profile.firstName} ${row.actor.profile.lastName}`
                      : row.actor.email
                    : 'System';
                  return (
                    <tr key={row.id} className="align-top hover:bg-[var(--color-surface-sunken)]">
                      <td className="px-4 py-2.5 whitespace-nowrap text-[var(--color-content-muted)] tabular-nums">
                        {fmtTime(row.createdAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
                          style={{
                            color: `var(--tone-${tone}-fg)`,
                            backgroundColor: `var(--tone-${tone}-bg)`,
                          }}
                        >
                          {actionLabel(row.action)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                        <span className="whitespace-nowrap">{row.entityType}</span>
                        {row.entityLabel ? (
                          <span className="ml-1.5 font-medium text-[var(--color-content)]">
                            {row.entityLabel}
                          </span>
                        ) : (
                          <span className="ml-1 font-mono text-xs text-[var(--color-content-subtle)]">
                            {row.entityId.slice(0, 8)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{actorName}</td>
                      <td className="max-w-md px-4 py-2.5 text-xs text-[var(--color-content-muted)]">
                        {changeSummary(row)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      {data && data.meta.page.totalPages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          <p className="text-[var(--color-content-subtle)]">
            Page {data.meta.page.page} of {data.meta.page.totalPages} · {data.meta.page.totalItems}{' '}
            entries
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= data.meta.page.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
