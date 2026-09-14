'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FilePlus2, Upload } from 'lucide-react';
import { VERIFICATION_STATUS_TOKENS } from '@techpioasset/ui-tokens';
import { PERMISSIONS, type VerificationStatus } from '@techpioasset/domain';
import { apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  currency: string;
  total: string;
  paymentStatus: string;
  verificationStatus: VerificationStatus;
  vendor: { id: string; name: string } | null;
  _count: { documents: number; lines: number };
}

function InvoicesTable() {
  const [page, setPage] = useState(1);
  const { can } = useAuth();
  // Scanning/uploading a bill is a Finance (and Super Admin) capability; others
  // with read access still see the ledger but not the capture action.
  const canUpload = can(PERMISSIONS.INVOICES_UPLOAD);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['invoices', page],
    queryFn: () => apiFetchPage<InvoiceRow>(`/invoices?page=${page}&pageSize=25`),
  });

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Invoices</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {canUpload ? (
              <>
                Scan a bill or{' '}
                <Link
                  href="/invoices/new"
                  className="font-medium text-[var(--color-brand)] hover:underline"
                >
                  enter it manually
                </Link>
                , then verify against the record.
              </>
            ) : (
              'Bills captured by Finance, verified against asset and purchase records.'
            )}
          </p>
        </div>
        {canUpload ? (
          <div className="flex flex-wrap gap-2">
            <Link
              href="/invoices/new"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-4 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
            >
              <FilePlus2 aria-hidden="true" className="size-4" />
              Add invoice
            </Link>
            <Link
              href="/invoices/upload"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-brand-contrast)] hover:bg-[var(--color-brand-hover)]"
            >
              <Upload aria-hidden="true" className="size-4" />
              Scan a bill
            </Link>
          </div>
        ) : null}
      </header>

      <Card>
        {isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Could not load invoices" detail={(error as Error).message} />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            description={
              canUpload
                ? 'Scan your first bill or add one manually to get started.'
                : 'No bills have been captured yet.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Invoices, {data.meta.page.totalItems} in total</caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Invoice
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Vendor
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Verification
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.data.map((row) => (
                  <tr key={row.id} className="hover:bg-[var(--color-surface-sunken)]">
                    <td className="px-4 py-2.5">
                      <Link href={`/invoices/${row.id}`} className="font-medium hover:underline">
                        {row.invoiceNumber}
                      </Link>
                      <p className="text-xs text-[var(--color-content-subtle)]">
                        {new Date(row.invoiceDate).toLocaleDateString()} · {row._count.lines} lines
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {row.vendor?.name ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge
                        token={VERIFICATION_STATUS_TOKENS[row.verificationStatus]}
                        size="sm"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {row.currency} {Number(row.total).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data && data.meta.page.totalPages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          <p className="text-[var(--color-content-subtle)]">
            Page {data.meta.page.page} of {data.meta.page.totalPages}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= data.meta.page.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <InvoicesTable />
    </Suspense>
  );
}
