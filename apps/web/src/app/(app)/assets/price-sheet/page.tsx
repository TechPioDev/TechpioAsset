'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { PERMISSIONS, formatInr } from '@techpioasset/domain';
import { API_BASE, getAccessToken } from '@/lib/api-client';
import { downloadCsv } from '@/lib/download-csv';
import { formatInvoiceMoney } from '@/lib/invoice-entry';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, ErrorState, Field, NativeSelect, linkButtonCls } from '@/components/ui';

/**
 * Price sheet (v2.59): fill purchase price and purchase date for assets that
 * already exist, by Excel round-trip.
 *
 * Two uploads of the same file, deliberately. The first is a preview that
 * changes nothing; only "Apply" writes, and it re-checks every row on the
 * server, so a price recorded in between is reported rather than overwritten.
 */

type Outcome = 'WILL_SET_PRICE' | 'WILL_SET_DATE' | 'UNCHANGED' | 'ERROR';

interface RowResult {
  row: number;
  assetTag: string;
  assetId: string | null;
  assetName: string | null;
  outcomes: Outcome[];
  currentPrice: string | null;
  newPrice: string | null;
  currency: string | null;
  currentDate: string | null;
  newDate: string | null;
  messages: string[];
  applied: boolean;
}

interface SheetResult {
  dryRun: boolean;
  rows: number;
  counts: {
    toChange: number;
    pricesToSet: number;
    datesToSet: number;
    unchanged: number;
    blank: number;
    errors: number;
  };
  applied: { rows: number; prices: number; dates: number };
  results: RowResult[];
}

type Filter = 'all' | 'changes' | 'errors' | 'unchanged';

function money(amount: string | null, currency: string | null): string {
  if (amount === null) return '—';
  if (!currency || currency === 'INR') return formatInr(Number(amount), { paise: true });
  return formatInvoiceMoney(amount, currency);
}

/** "15 Mar 2024" from YYYY-MM-DD, read as a calendar day (no zone shift). */
function day(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

async function send(file: File, dryRun: boolean): Promise<SheetResult> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(`${API_BASE}/assets/price-sheet?dryRun=${dryRun}`, {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
    body,
  });
  const json = (await response.json()) as { data?: SheetResult; detail?: string; title?: string };
  if (!response.ok) {
    throw new Error(
      [json.title, json.detail].filter(Boolean).join(' — ') || 'The sheet could not be read',
    );
  }
  return json.data as SheetResult;
}

const tone = {
  critical: {
    color: 'var(--tone-critical-fg)',
    backgroundColor: 'var(--tone-critical-bg)',
    borderColor: 'var(--tone-critical-border)',
  },
  success: {
    color: 'var(--tone-success-fg)',
    backgroundColor: 'var(--tone-success-bg)',
    borderColor: 'var(--tone-success-border)',
  },
} as const;

function OutcomeBadge({ row }: { row: RowResult }) {
  if (row.outcomes.includes('ERROR')) {
    return (
      <span className="rounded-full border px-2 py-0.5 text-xs font-medium" style={tone.critical}>
        Error
      </span>
    );
  }
  if (row.outcomes.includes('UNCHANGED')) {
    return <span className="text-xs text-[var(--color-content-subtle)]">Unchanged</span>;
  }
  const parts = [
    row.outcomes.includes('WILL_SET_PRICE') ? 'price' : null,
    row.outcomes.includes('WILL_SET_DATE') ? 'date' : null,
  ].filter(Boolean);
  return (
    <span className="rounded-full border px-2 py-0.5 text-xs font-medium" style={tone.success}>
      {row.applied ? 'Saved' : 'Set'} {parts.join(' + ')}
    </span>
  );
}

export default function PriceSheetPage() {
  const { can } = useAuth();
  const toast = useToast();
  const allowed =
    can(PERMISSIONS.ASSETS_COST_READ) &&
    (can(PERMISSIONS.ASSETS_IMPORT) || can(PERMISSIONS.ASSETS_UPDATE));

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SheetResult | null>(null);
  const [outcome, setOutcome] = useState<SheetResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [downloading, setDownloading] = useState(false);

  const check = useMutation({
    mutationFn: (f: File) => send(f, true),
    onSuccess: (result) => {
      setPreview(result);
      setError(null);
      setFilter(result.counts.errors > 0 ? 'errors' : 'all');
    },
    onError: (e) => {
      setPreview(null);
      setError(e instanceof Error ? e.message : 'The sheet could not be read');
    },
  });

  const apply = useMutation({
    mutationFn: (f: File) => send(f, false),
    onSuccess: (result) => {
      setOutcome(result);
      setPreview(null);
      setError(null);
      setFilter(result.counts.errors > 0 ? 'errors' : 'all');
      toast.success(
        `Saved ${result.applied.prices} price${result.applied.prices === 1 ? '' : 's'} and ${result.applied.dates} date${result.applied.dates === 1 ? '' : 's'}`,
      );
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'The sheet could not be saved'),
  });

  function onPick(picked: File | null | undefined) {
    if (!picked) return;
    setFile(picked);
    setPreview(null);
    setOutcome(null);
    setError(null);
    check.mutate(picked);
  }

  async function onDownload() {
    setDownloading(true);
    const ok = await downloadCsv(
      '/assets/price-sheet',
      `price-sheet-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
    setDownloading(false);
    if (ok) toast.success('Price sheet downloaded');
    else toast.error('Could not download the price sheet');
  }

  const shown = outcome ?? preview;
  const rows = useMemo(() => {
    const all = shown?.results ?? [];
    switch (filter) {
      case 'errors':
        return all.filter((r) => r.outcomes.includes('ERROR'));
      case 'unchanged':
        return all.filter((r) => r.outcomes.includes('UNCHANGED'));
      case 'changes':
        return all.filter(
          (r) => !r.outcomes.includes('ERROR') && !r.outcomes.includes('UNCHANGED'),
        );
      default:
        return all;
    }
  }, [shown, filter]);

  if (!allowed) {
    return (
      <ErrorState
        title="Finance and Super Admin only"
        detail="The price sheet needs permission to see asset prices and to import or update assets."
      />
    );
  }

  const toChange = preview?.counts.toChange ?? 0;
  const busy = check.isPending || apply.isPending;

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Price sheet</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Fill in purchase prices and purchase dates for assets you already have, in Excel. A price
          or date that is already recorded is never changed here — correct those from the asset
          itself.
        </p>
      </header>

      <Card className="grid gap-3 p-5">
        <h2 className="text-[15px] font-semibold">1. Download the price sheet</h2>
        <p className="text-sm text-[var(--color-content-muted)]">
          Every asset, with its current price and date. Fill the yellow columns — New purchase price
          and New purchase date (YYYY-MM-DD) — and leave the rest as they are. The Instructions tab
          explains the rules.
        </p>
        <div>
          <Button variant="secondary" size="sm" loading={downloading} onClick={onDownload}>
            <Download aria-hidden="true" className="size-4" />
            Download price sheet
          </Button>
        </div>
      </Card>

      <Card className="grid gap-4 p-5">
        <h2 className="text-[15px] font-semibold">2. Upload the filled sheet</h2>
        <label
          className="grid cursor-pointer place-items-center gap-2 rounded-xl border-2 border-dashed border-[var(--color-border-strong)] px-6 py-10 text-center transition hover:border-[var(--color-brand)] hover:bg-[var(--color-surface-sunken)]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onPick(e.dataTransfer.files?.[0]);
          }}
        >
          <FileSpreadsheet aria-hidden="true" className="size-8 text-[var(--color-brand)]" />
          <span className="text-sm font-semibold">
            {file?.name ?? 'Drop the filled .xlsx here, or click to choose'}
          </span>
          <span className="text-xs text-[var(--color-content-subtle)]">
            Up to 15 MB. Nothing is saved until you apply the preview.
          </span>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              // Cleared so choosing the same file again (after fixing it) fires.
              e.target.value = '';
              onPick(picked);
            }}
          />
        </label>

        {check.isPending ? (
          <p className="text-sm text-[var(--color-content-muted)]">
            <Upload aria-hidden="true" className="mr-1.5 inline size-4 animate-pulse" />
            Checking {file?.name}…
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] border px-3 py-2 text-sm"
            style={tone.critical}
          >
            {error}
          </p>
        ) : null}
      </Card>

      {shown ? (
        <Card className="grid gap-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold">
                {outcome ? (
                  <>
                    <CheckCircle2
                      aria-hidden="true"
                      className="mr-1.5 inline size-4 text-[var(--tone-success-fg)]"
                    />
                    Saved
                  </>
                ) : (
                  '3. Check the preview'
                )}
              </h2>
              <p className="mt-0.5 text-xs text-[var(--color-content-subtle)]">
                {file?.name} · {shown.rows.toLocaleString('en-IN')} rows read
              </p>
            </div>
            {preview ? (
              <Button
                size="sm"
                loading={apply.isPending}
                disabled={busy || toChange === 0 || !file}
                onClick={() => file && apply.mutate(file)}
              >
                Apply {toChange.toLocaleString('en-IN')} change{toChange === 1 ? '' : 's'}
              </Button>
            ) : null}
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            {outcome ? (
              <>
                <div>
                  <dt className="text-xs text-[var(--color-content-subtle)]">Prices saved</dt>
                  <dd className="font-semibold tabular-nums">{outcome.applied.prices}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-content-subtle)]">Dates saved</dt>
                  <dd className="font-semibold tabular-nums">{outcome.applied.dates}</dd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <dt className="text-xs text-[var(--color-content-subtle)]">To set</dt>
                  <dd className="font-semibold tabular-nums">
                    {shown.counts.pricesToSet} price{shown.counts.pricesToSet === 1 ? '' : 's'} ·{' '}
                    {shown.counts.datesToSet} date{shown.counts.datesToSet === 1 ? '' : 's'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-content-subtle)]">Assets changing</dt>
                  <dd className="font-semibold tabular-nums">{shown.counts.toChange}</dd>
                </div>
              </>
            )}
            <div>
              <dt className="text-xs text-[var(--color-content-subtle)]">Unchanged</dt>
              <dd className="font-semibold tabular-nums">{shown.counts.unchanged}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-content-subtle)]">Errors</dt>
              <dd
                className="font-semibold tabular-nums"
                style={shown.counts.errors > 0 ? { color: 'var(--tone-critical-fg)' } : undefined}
              >
                {shown.counts.errors}
              </dd>
            </div>
          </dl>

          {preview && preview.counts.errors > 0 ? (
            <p className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm">
              <span className="font-semibold">Rows with an error are skipped entirely.</span> You
              can apply the rest now, then fix those rows in the sheet and upload it again — rows
              already saved will show as unchanged.
            </p>
          ) : null}

          {shown.results.length > 0 ? (
            <>
              <div className="max-w-xs">
                <Field label="Show" htmlFor="ps-filter">
                  <NativeSelect
                    id="ps-filter"
                    className="w-full"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value as Filter)}
                  >
                    <option value="all">All filled rows ({shown.results.length})</option>
                    <option value="changes">
                      {outcome ? 'Saved' : 'Changes'} ({shown.counts.toChange})
                    </option>
                    <option value="errors">Errors ({shown.counts.errors})</option>
                    <option value="unchanged">
                      Unchanged ({shown.counts.unchanged - shown.counts.blank})
                    </option>
                  </NativeSelect>
                </Field>
              </div>

              <div className="overflow-x-auto rounded-[var(--radius-control)] border border-[var(--color-border)]">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-[var(--color-surface-sunken)] text-left text-xs text-[var(--color-content-subtle)]">
                    <tr>
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Asset</th>
                      <th className="px-3 py-2 font-medium">Price</th>
                      <th className="px-3 py-2 font-medium">Purchase date</th>
                      <th className="px-3 py-2 font-medium">Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.row} className="border-t border-[var(--color-border)] align-top">
                        <td className="px-3 py-2 tabular-nums text-[var(--color-content-subtle)]">
                          {r.row}
                        </td>
                        <td className="px-3 py-2">
                          {r.assetId ? (
                            <Link
                              href={`/assets/${r.assetId}`}
                              className="font-medium hover:underline"
                            >
                              {r.assetTag}
                            </Link>
                          ) : (
                            <span className="font-medium">{r.assetTag || '—'}</span>
                          )}
                          {r.assetName ? (
                            <span className="block text-xs text-[var(--color-content-subtle)]">
                              {r.assetName}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {r.newPrice !== null ? (
                            <>
                              {money(r.newPrice, r.currency)}
                              {r.currentPrice !== null ? (
                                <span className="block text-xs text-[var(--color-content-subtle)]">
                                  recorded {money(r.currentPrice, r.currency)}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-[var(--color-content-subtle)]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {r.newDate !== null ? (
                            <>
                              {day(r.newDate)}
                              {r.currentDate !== null ? (
                                <span className="block text-xs text-[var(--color-content-subtle)]">
                                  recorded {day(r.currentDate)}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-[var(--color-content-subtle)]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <OutcomeBadge row={r} />
                          {r.messages.length ? (
                            <ul className="mt-1 grid gap-0.5 text-xs text-[var(--color-content-muted)]">
                              {r.messages.map((m) => (
                                <li key={m}>{m}</li>
                              ))}
                            </ul>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-3 py-6 text-center text-sm text-[var(--color-content-subtle)]"
                        >
                          Nothing to show for this filter.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-[var(--color-content-muted)]">
              No row in this sheet has a new price or date filled in.
            </p>
          )}

          {outcome ? (
            <div className="flex gap-2">
              <Link href="/assets" className={linkButtonCls.primary}>
                View assets
              </Link>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
