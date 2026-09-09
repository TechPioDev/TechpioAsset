'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileSpreadsheet, Upload } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { API_BASE, getAccessToken } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui';

/**
 * Bulk import (v2.52).
 *
 * Two steps on purpose. The file is checked and reported on before anything is
 * written, so a supplier sees "95 of 100, and here are the other five" and can
 * decide - rather than finding out afterwards.
 */

interface ImportIssue {
  row: number;
  name: string;
  problem: string;
}

interface ImportReport {
  totalRows: number;
  valid: number;
  failed: number;
  imported: number;
  issues: ImportIssue[];
}

const COLUMNS = [
  ['Product name', 'required'],
  ['Category', 'required — must match one of yours'],
  ['Unit price', 'required'],
  ['Brand', 'optional'],
  ['Model', 'optional'],
  ['SKU', 'optional — must be unique among your products'],
  ['GST %', 'optional, defaults to 0'],
  ['Available quantity', 'optional, defaults to 0'],
  ['Minimum order', 'optional, defaults to 1'],
  ['Available from / Available until', 'optional, defaults to today and 90 days on'],
] as const;

export default function ImportProductsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (commit: boolean) => {
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('commit', commit ? 'true' : 'false');
      const response = await fetch(`${API_BASE}/vendor-products/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        body,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        // The server names the actual rule - no rows, too many, not a sheet.
        throw new Error(payload?.detail ?? payload?.title ?? 'Could not read that file');
      }
      setReport(payload.data as ImportReport);
      setCommitted(commit);
      if (commit) toast.success(`${payload.data.imported} product(s) imported as drafts`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read that file');
    } finally {
      setBusy(false);
    }
  };

  if (!user) return <Skeleton className="h-96" />;
  if (!user.permissions?.includes(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)) {
    return (
      <Card className="mx-auto mt-10 max-w-md p-6 text-sm text-[var(--color-content-muted)]">
        Importing products needs the catalogue permission. Ask your administrator.
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <div>
        <Link
          href="/catalogue"
          className="inline-flex items-center gap-1 text-sm text-[var(--color-content-muted)] hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4" /> Back to the catalogue
        </Link>
      </div>

      <header>
        <h1 className="text-xl font-semibold tracking-tight">Import products</h1>
        <p className="text-sm text-[var(--color-content-muted)]">
          Upload an Excel file or CSV. We check it first and tell you what would happen; nothing is
          saved until you say so. Everything arrives as a draft, so you still add pictures and send
          each one for review.
        </p>
      </header>

      <Card className="p-5">
        <h2 className="text-sm font-semibold">The columns we read</h2>
        <p className="mb-3 text-xs text-[var(--color-content-muted)]">
          The first row should name the columns. Spelling and spacing are forgiven; anything we do
          not recognise is ignored.
        </p>
        <dl className="grid gap-1.5 text-sm sm:grid-cols-2">
          {COLUMNS.map(([name, note]) => (
            <div key={name} className="flex justify-between gap-3 border-b border-[var(--color-border)] pb-1">
              <dt className="font-medium">{name}</dt>
              <dd className="text-right text-xs text-[var(--color-content-subtle)]">{note}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="p-5">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const chosen = e.target.files?.[0] ?? null;
            setFile(chosen);
            setReport(null);
            setCommitted(false);
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <FileSpreadsheet aria-hidden="true" className="mr-1 size-4" /> Choose a file
          </Button>
          <span className="text-sm text-[var(--color-content-muted)]">
            {file ? file.name : 'No file chosen'}
          </span>
          {file && !committed ? (
            <Button loading={busy} onClick={() => void send(false)}>
              Check the file
            </Button>
          ) : null}
        </div>
      </Card>

      {report ? (
        <Card className="p-5">
          <h2 className="text-sm font-semibold">
            {committed ? 'What was imported' : 'What would happen'}
          </h2>
          <p className="mt-1 text-sm">
            {report.totalRows} row{report.totalRows === 1 ? '' : 's'} read ·{' '}
            <span className="font-medium text-[var(--tone-success-fg)]">
              {committed ? report.imported : report.valid} ready
            </span>
            {report.failed > 0 ? (
              <>
                {' '}
                ·{' '}
                <span className="font-medium text-[var(--color-destructive)]">
                  {report.failed} cannot be imported
                </span>
              </>
            ) : null}
          </p>

          {report.issues.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-muted)]">
                Rows to fix
              </h3>
              <ul className="mt-2 grid gap-1 text-sm">
                {report.issues.map((issue) => (
                  <li
                    key={`${issue.row}-${issue.problem}`}
                    className="flex flex-wrap items-baseline gap-x-2 border-b border-[var(--color-border)] py-1.5 last:border-0"
                  >
                    <span className="font-mono text-xs text-[var(--color-content-subtle)]">
                      Row {issue.row}
                    </span>
                    <span className="font-medium">{issue.name}</span>
                    <span className="text-[var(--color-content-muted)]">— {issue.problem}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-[var(--color-content-subtle)]">
                The rows that pass can still be imported now. Fix these and upload them again.
              </p>
            </div>
          ) : null}

          {!committed && report.valid > 0 ? (
            <div className="mt-4 border-t border-[var(--color-border)] pt-4">
              <Button loading={busy} onClick={() => void send(true)}>
                <Upload aria-hidden="true" className="mr-1 size-4" /> Import {report.valid} product
                {report.valid === 1 ? '' : 's'}
              </Button>
            </div>
          ) : null}

          {committed ? (
            <div className="mt-4 border-t border-[var(--color-border)] pt-4">
              <Link href="/catalogue?status=DRAFT" className="text-sm text-[var(--color-brand)] hover:underline">
                See the drafts →
              </Link>
            </div>
          ) : null}
        </Card>
      ) : null}

      {!file ? (
        <Card>
          <EmptyState
            title="Nothing chosen yet"
            description="Pick an Excel file or CSV above and we will tell you what is in it before anything is saved."
          />
        </Card>
      ) : null}
    </div>
  );
}
