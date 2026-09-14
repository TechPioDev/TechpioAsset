'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import {
  ASSET_DETAIL_COPY,
  HEALTH_GRADE_TONE,
  hardwareRows,
  healthDimensionLabel,
  healthSubScoreTone,
  osRows,
  securityPostureRows,
  type DetailRow,
  type HardwareSnapshot,
  type OsSnapshot,
} from '@techpioasset/domain';
import { apiFetch, apiFetchPage } from '@/lib/api-client';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui';
import { ReportedFreshness } from './reported-freshness';

/**
 * v2.5 H5 — the discovery-backed asset tabs (Hardware / OS & Security /
 * Software / Health). Every tab renders honestly when discovery has not seen
 * the machine yet: an empty state, never invented values.
 */

// Every label and badge below comes from the domain package (asset-detail.ts),
// which the phone's asset screen renders too - so the two cannot drift.

export interface HardwareProfileDto extends HardwareSnapshot {
  source: string;
  lastDiscoveredAt: string;
}

export interface OsInfoDto extends OsSnapshot {
  source: string;
  lastDiscoveredAt: string;
}

export interface HealthDto {
  overall: number;
  grade: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'CRITICAL';
  subScores: { key: string; score: number; weight: number }[];
  recommendations: string[];
  capped: boolean;
  computedAt: string;
}

export function Tone({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{
        color: `var(--tone-${tone}-fg)`,
        backgroundColor: `var(--tone-${tone}-bg)`,
        borderColor: `var(--tone-${tone}-border)`,
      }}
    >
      {children}
    </span>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-content-subtle)]">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value ?? '—'}</dd>
    </div>
  );
}

/** A shared detail row: a badge when it carries a tone, plain text otherwise. */
function DetailRows({ rows }: { rows: DetailRow[] }) {
  return rows.map((row) => (
    <Row
      key={row.label}
      label={row.label}
      value={row.tone && row.value != null ? <Tone tone={row.tone}>{row.value}</Tone> : row.value}
    />
  ));
}

const NOT_DISCOVERED = ASSET_DETAIL_COPY.notDiscovered;

export function HardwareTab({ hw }: { hw: HardwareProfileDto | null }) {
  if (!hw) return <EmptyState {...NOT_DISCOVERED} />;
  return (
    <Card className="p-5">
      {/* Ahead of the data, not under it: you should know how old a snapshot is
          before you start reading it as fact. */}
      <ReportedFreshness source={hw.source} at={hw.lastDiscoveredAt} />
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <DetailRows rows={hardwareRows(hw)} />
      </dl>
    </Card>
  );
}

export function OsTab({ os }: { os: OsInfoDto | null }) {
  if (!os) return <EmptyState {...NOT_DISCOVERED} />;
  return (
    <div className="grid gap-4">
      {/* Once for the whole tab: both cards below are the same snapshot, and
          repeating the warning would train people to ignore it. */}
      <ReportedFreshness source={os.source} at={os.lastDiscoveredAt} />
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">Operating system</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <DetailRows rows={osRows(os, (at) => new Date(at).toLocaleString())} />
        </dl>
      </Card>
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">Security posture</h2>
        <div className="mt-2 divide-y divide-[var(--color-border)]">
          {securityPostureRows(os).map((row) => (
            <div key={row.label} className="flex items-center justify-between py-2">
              <span className="text-sm">{row.label}</span>
              {row.state === null ? (
                <span className="text-xs text-[var(--color-content-subtle)]">not reported</span>
              ) : (
                <Tone tone={row.state.tone}>{row.state.text}</Tone>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

interface SoftwareRow {
  id: string;
  name: string;
  version: string | null;
  publisher: string | null;
  installedAt: string | null;
}

export function SoftwareTab({ assetId }: { assetId: string }) {
  const [page, setPage] = useState(1);
  const { data, isPending } = useQuery({
    queryKey: ['asset-software', assetId, page],
    queryFn: () => apiFetchPage<SoftwareRow>(`/assets/${assetId}/software?page=${page}&pageSize=25`),
  });

  if (isPending) return <Skeleton className="h-48" />;
  if (!data || data.data.length === 0) {
    return (
      <EmptyState {...ASSET_DETAIL_COPY.noSoftware} />
    );
  }
  const { totalItems, totalPages } = data.meta.page as { totalItems: number; totalPages?: number };
  const pages = totalPages ?? Math.ceil(totalItems / 25);
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Installed software, {totalItems} in total</caption>
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left">
              <th scope="col" className="px-4 py-2.5 font-medium">Application</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Version</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Publisher</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {data.data.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-2.5 font-medium">{row.name}</td>
                <td className="px-4 py-2.5 text-[var(--color-content-muted)]">{row.version ?? '—'}</td>
                <td className="px-4 py-2.5 text-[var(--color-content-muted)]">{row.publisher ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div className="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-2.5 text-sm">
          <span className="text-[var(--color-content-subtle)]">
            Page {page} of {pages} · {totalItems} applications
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </span>
        </div>
      ) : null}
    </Card>
  );
}

export function HealthTab({
  assetId,
  health,
  canRecompute,
}: {
  assetId: string;
  health: HealthDto | null;
  canRecompute: boolean;
}) {
  const queryClient = useQueryClient();
  const recompute = useMutation({
    mutationFn: () => apiFetch(`/assets/${assetId}/health/recompute`, { method: 'POST', body: {} }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['asset', assetId] }),
  });

  if (!health) {
    return (
      <EmptyState {...ASSET_DETAIL_COPY.noHealth} />
    );
  }

  const tone = HEALTH_GRADE_TONE[health.grade];
  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-4xl font-bold tabular-nums" style={{ color: `var(--tone-${tone}-fg)` }}>
            {health.overall}
            <span className="text-base font-medium text-[var(--color-content-subtle)]"> / 100</span>
          </p>
          <Tone tone={tone}>{health.grade.toLowerCase()}</Tone>
          {canRecompute ? (
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              loading={recompute.isPending}
              onClick={() => recompute.mutate()}
            >
              <RefreshCw aria-hidden="true" className="size-3.5" /> Recompute
            </Button>
          ) : null}
        </div>
        {health.capped ? (
          <p
            className="mt-3 rounded-[var(--radius-control)] border px-3 py-2 text-sm"
            style={{
              color: 'var(--tone-critical-fg)',
              backgroundColor: 'var(--tone-critical-bg)',
              borderColor: 'var(--tone-critical-border)',
            }}
          >
            {ASSET_DETAIL_COPY.healthCapped}
          </p>
        ) : null}
        <div className="mt-4 grid gap-2.5">
          {health.subScores.map((sub) => (
            <div key={sub.key} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 text-sm">
              <span className="text-[var(--color-content-muted)]">
                {healthDimensionLabel(sub.key)}
              </span>
              <div
                className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
                role="img"
                aria-label={`${healthDimensionLabel(sub.key)}: ${sub.score} out of 100`}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${sub.score}%`,
                    backgroundColor: `var(--tone-${healthSubScoreTone(sub.score)}-fg)`,
                  }}
                />
              </div>
              <span className="text-right tabular-nums">{sub.score}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-content-subtle)]">
          Computed {new Date(health.computedAt).toLocaleString()} · {ASSET_DETAIL_COPY.healthExcluded}
        </p>
      </Card>

      {health.recommendations.length > 0 ? (
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Recommendations</h2>
          <ul className="mt-3 grid gap-2">
            {health.recommendations.map((rec) => (
              <li key={rec} className="flex gap-2.5 text-sm">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--tone-warning-fg)]" />
                {rec}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
