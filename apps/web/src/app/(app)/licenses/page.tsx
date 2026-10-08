'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Plus, Search } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Card, EmptyState, ErrorState, NativeSelect, Skeleton } from '@/components/ui';
import { useSearchParams } from 'next/navigation';
import {
  LicenseStatusPill,
  SeatsMeter,
  expiryLabel,
  type LicenseRow,
  isSyncedLicense,
  SyncedBadge,
} from '@/components/licenses/shared';

export default function LicensesPage() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  // Seeded from the URL: the dashboard's expiring tile links here with it.
  const [status, setStatus] = useState(useSearchParams().get('status') ?? '');

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['licenses', q, status],
    queryFn: () =>
      apiFetchPage<LicenseRow>(
        `/licenses?pageSize=100${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}`,
      ),
  });

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--color-content-subtle)]">
            Software
          </span>
          <h1 className="mt-1 flex items-center gap-2 text-[24px] font-bold tracking-tight">
            <KeyRound className="size-6 text-[var(--color-brand)]" /> Licenses
          </h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            Seats are enforced, not suggested: a full licence refuses the next assignment.
          </p>
        </div>
        {can(PERMISSIONS.LICENSES_CREATE) ? (
          <Link
            href="/licenses/new"
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-brand-contrast)] shadow-sm transition hover:bg-[var(--color-brand-hover)]"
          >
            <Plus className="size-4" /> New license
          </Link>
        ) : null}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--color-content-subtle)]" />
          <input
            type="search"
            aria-label="Search licenses"
            placeholder="Search name or edition…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 w-64 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] pl-8 text-sm"
          />
        </div>
        <NativeSelect
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="EXPIRING">Expiring</option>
          <option value="EXPIRED">Expired</option>
          <option value="RETIRED">Retired</option>
        </NativeSelect>
      </div>

      {isPending ? (
        <div className="grid gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState title="Could not load licenses" detail={(error as Error).message} />
      ) : data.data.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            title="No licenses yet"
            description="Register the software your team pays for and its seats become enforceable."
          />
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-content-subtle)]">
                <th className="px-4 py-3 font-semibold">License</th>
                <th className="px-4 py-3 font-semibold">Vendor</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Expiry</th>
                <th className="px-4 py-3 font-semibold">Seats</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {data.data.map((l) => (
                <tr key={l.id} className="hover:bg-[var(--color-surface-sunken)]">
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={`/licenses/${l.id}`} className="font-medium hover:underline">
                        {l.name}
                      </Link>
                      {isSyncedLicense(l) ? <SyncedBadge /> : null}
                    </span>
                    <p className="text-xs text-[var(--color-content-subtle)]">
                      {[l.edition, l.unitOfAssignment === 'USER' ? 'per user' : 'per device']
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-content-muted)]">
                    {l.vendor?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <LicenseStatusPill status={l.status} />
                  </td>
                  <td className="px-4 py-3 text-[var(--color-content-muted)] tabular-nums">
                    {expiryLabel(l.expiryDate)}
                  </td>
                  <td className="px-4 py-3">
                    <SeatsMeter purchased={l.seatsPurchased} reserved={l.seatsReserved} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
