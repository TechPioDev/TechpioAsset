'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { expiryLabel, LicenseStatusPill, type LicenseRow } from '@/components/licenses/shared';

/**
 * The software seats issued to the signed-in user - the web twin of the phone's
 * My licenses screen, reading the same `/licenses/mine` endpoint (active seats
 * only, newest first). The endpoint needs no permission: it only ever returns
 * the caller's own seats.
 */

interface MySeat {
  id: string;
  assignedAt: string;
  license: {
    id: string;
    name: string;
    edition: string | null;
    expiryDate: string | null;
    status: LicenseRow['status'];
  };
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function MyLicensesPage() {
  const { user, can } = useAuth();
  // The licence record itself is a licences:read page; without it the name is
  // plain text rather than a link into a guard redirect.
  const mayOpen = can(PERMISSIONS.LICENSES_READ);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['my-licenses', user?.id],
    enabled: Boolean(user),
    queryFn: () => apiFetch<MySeat[]>('/licenses/mine'),
  });

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">My licences</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Software seats currently issued to you.
        </p>
      </header>

      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState title="Could not load your licences" detail={(error as Error).message} />
      ) : (data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            title="No licences assigned"
            description="Software seats issued to you appear here."
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data!.map((seat) => (
            <Card key={seat.id} className="flex items-center gap-3 p-4">
              <span className="grid size-9 flex-none place-items-center rounded-lg bg-[var(--color-brand)]/10 text-[var(--color-brand)]">
                <KeyRound aria-hidden="true" className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  {mayOpen ? (
                    <Link
                      href={`/licenses/${seat.license.id}`}
                      className="truncate font-medium hover:underline"
                    >
                      {seat.license.name}
                    </Link>
                  ) : (
                    <p className="truncate font-medium">{seat.license.name}</p>
                  )}
                  <LicenseStatusPill status={seat.license.status} />
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--color-content-muted)]">
                  {[
                    seat.license.edition,
                    expiryLabel(seat.license.expiryDate),
                    `yours since ${fmtDate(seat.assignedAt)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
