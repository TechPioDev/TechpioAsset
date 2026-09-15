'use client';

import { useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Download,
  Info,
  Lock,
  Minus,
  TriangleAlert,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  EXPENSE_SOURCE_LABELS,
  EXPENSE_SOURCES,
  formatMoneyText,
  type ExpensePeriodPreset,
} from '@techpioasset/domain';
import type {
  ExpenseGroupDto,
  ExpenseSeriesPointDto,
  ExpenseSummaryDto,
} from '@techpioasset/contracts';
import { API_BASE, ApiError, apiFetch, getAccessToken } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  NativeSelect,
  Skeleton,
  controlCls,
  linkButtonCls,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  EXPENSE_LEVEL_LABELS,
  EXPENSE_SEGMENTS,
  customRangeReady,
  describeChange,
  expenseLevelFill,
  expenseLineHref,
  expenseQueryString,
  filenameFromDisposition,
  formatMoneyShort,
  topWithOther,
  type ExpenseFilters,
} from '@/lib/expenses';

/**
 * Expenses (v2.59) - Super Admin only.
 *
 * Asset purchases (by purchase date), completed repairs (by closing date) and
 * software licences (by purchase date, plus renewals) for a period. The API
 * refuses anyone but a Super Admin on the role; the route guard and the menu
 * keep everyone else from ever seeing the page, and this component checks once
 * more so nothing financial is fetched for them.
 *
 * Most companies begin with no purchase prices recorded, so an empty report is
 * the usual first sight. It is written as a to-do list - the API's data-gap
 * notes and a way to fix them - rather than as a blank chart.
 */

interface NamedOption {
  id: string;
  name: string;
}

const tooltipBox = {
  background: 'var(--color-surface-raised)',
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  fontSize: 12,
  color: 'var(--color-content)',
  padding: '8px 10px',
} as const;

const axisTick = { fontSize: 11, fill: 'var(--color-content-subtle)' } as const;

const SHORT_SOURCE = { ASSET: 'Assets', MAINTENANCE: 'Repairs', LICENCE: 'Licences' } as const;

const SOURCE_FILL = {
  ASSET: 'var(--color-chart-1)',
  MAINTENANCE: 'var(--color-chart-3)',
  LICENCE: 'var(--color-chart-4)',
} as const;

export default function ExpensesPage() {
  const { user } = useAuth();
  if (!user?.roles?.includes('SUPER_ADMIN')) {
    return (
      <Card>
        <EmptyState
          title="Super Admin only"
          description="The expense report shows company-wide spending, so only a Super Admin can open it."
          action={<Lock aria-hidden="true" className="size-5 text-[var(--color-content-subtle)]" />}
        />
      </Card>
    );
  }
  return <ExpensesReport />;
}

function ExpensesReport() {
  const [preset, setPreset] = useState<ExpensePeriodPreset>('LAST_30_DAYS');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [officeId, setOfficeId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [downloading, setDownloading] = useState<'pdf' | 'xlsx' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const customPending = preset === 'CUSTOM' && !customRangeReady(from, to);
  const filters: ExpenseFilters = {
    preset,
    ...(preset === 'CUSTOM' ? { from, to } : {}),
    ...(officeId ? { officeId } : {}),
    ...(categoryId ? { categoryId } : {}),
  };
  const qs = expenseQueryString(filters);

  const summary = useQuery({
    queryKey: ['expenses-summary', qs],
    queryFn: () => apiFetch<ExpenseSummaryDto>(`/expenses/summary?${qs}`),
    enabled: !customPending,
    placeholderData: keepPreviousData,
  });
  const offices = useQuery({
    queryKey: ['offices'],
    queryFn: () => apiFetch<NamedOption[]>('/offices'),
  });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<NamedOption[]>('/categories'),
  });

  async function download(format: 'pdf' | 'xlsx') {
    setDownloading(format);
    setDownloadError(null);
    try {
      // A signed fetch to a blob: a bare link cannot carry the Authorization header.
      const response = await fetch(`${API_BASE}/expenses/export?${expenseQueryString(filters, format)}`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
      });
      if (!response.ok) {
        setDownloadError(
          response.status === 403
            ? 'Your account cannot download the expense report.'
            : 'The report could not be generated. Please try again.',
        );
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      // The server's filename, so the extension is decided in one place.
      anchor.download =
        filenameFromDisposition(response.headers.get('content-disposition')) ?? `expenses.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError('The report could not be downloaded. Check your connection and try again.');
    } finally {
      setDownloading(null);
    }
  }

  const data = summary.data;
  const filterOn = Boolean(officeId || categoryId);

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Expenses</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            Asset purchases, completed repairs and software licences - exact figures, Super Admin only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => void download('pdf')}
            loading={downloading === 'pdf'}
            disabled={downloading !== null || customPending}
          >
            {downloading === 'pdf' ? null : <Download aria-hidden="true" className="size-4" />}
            Download PDF
          </Button>
          <Button
            variant="secondary"
            onClick={() => void download('xlsx')}
            loading={downloading === 'xlsx'}
            disabled={downloading !== null || customPending}
          >
            {downloading === 'xlsx' ? null : <Download aria-hidden="true" className="size-4" />}
            Download Excel
          </Button>
        </div>
      </header>

      {downloadError ? (
        <p role="alert" className="text-sm text-[var(--tone-critical-fg)]">
          {downloadError}
        </p>
      ) : null}

      {/* ── Filters ───────────────────────────────────────────────────── */}
      <Card className="grid gap-3 p-3">
        <div
          role="radiogroup"
          aria-label="Period"
          className="flex flex-wrap gap-1 rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] p-1"
        >
          {EXPENSE_SEGMENTS.map((segment) => {
            const active = segment.preset === preset;
            return (
              <button
                key={segment.preset}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPreset(segment.preset)}
                className={cn(
                  'rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 text-sm transition-colors',
                  active
                    ? 'bg-[var(--color-surface)] font-semibold shadow-sm'
                    : 'text-[var(--color-content-muted)] hover:text-[var(--color-content)]',
                )}
              >
                {segment.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {preset === 'CUSTOM' ? (
            <>
              <label className="grid gap-1 text-xs">
                <span className="font-medium text-[var(--color-content-muted)]">From</span>
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
                  className={cn(controlCls, 'w-40')}
                />
              </label>
              <label className="grid gap-1 text-xs">
                <span className="font-medium text-[var(--color-content-muted)]">To</span>
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                  className={cn(controlCls, 'w-40')}
                />
              </label>
            </>
          ) : null}
          <label className="grid gap-1 text-xs">
            <span className="font-medium text-[var(--color-content-muted)]">Office</span>
            <NativeSelect value={officeId} onChange={(e) => setOfficeId(e.target.value)} className="w-44">
              <option value="">All offices</option>
              {(offices.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium text-[var(--color-content-muted)]">Category</span>
            <NativeSelect
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-44"
            >
              <option value="">All categories</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          {data && !customPending ? (
            <p className="ml-auto text-xs text-[var(--color-content-subtle)]">
              {data.period.label} · {data.period.rangeLabel} · {data.period.timezone}
              {summary.isFetching ? ' · updating…' : ''}
            </p>
          ) : null}
        </div>

        {filterOn ? (
          <p className="flex items-center gap-1.5 text-xs text-[var(--color-content-muted)]">
            <Info aria-hidden="true" className="size-3.5" />
            An office or category filter is on, so software licences (which have neither) are left out.
          </p>
        ) : null}
        {preset === 'CUSTOM' && customPending ? (
          <p className="text-xs text-[var(--color-content-muted)]">
            Choose a start and an end date (the end on or after the start) to see the report.
          </p>
        ) : null}
      </Card>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      {customPending ? null : summary.isPending ? (
        <LoadingSkeleton />
      ) : summary.isError ? (
        <Card>
          <ErrorState
            title="Could not load expenses"
            detail={
              summary.error instanceof ApiError && summary.error.status === 403
                ? 'Your account cannot open the expense report.'
                : (summary.error as Error).message
            }
          />
        </Card>
      ) : data ? (
        <Report data={data} />
      ) : null}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading expenses" className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-72" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

function Report({ data }: { data: ExpenseSummaryDto }) {
  const money = (amount: string) => formatMoneyText(amount, data.currency);
  const unit = data.period.granularity === 'DAY' ? 'day' : 'month';
  const empty = data.totals.count === 0;
  const change = describeChange(data.totals.changePct);
  const ChangeIcon =
    change.direction === 'up'
      ? ArrowUp
      : change.direction === 'down'
        ? ArrowDown
        : change.direction === 'flat'
          ? Minus
          : Info;
  const biggestType = data.byType[0] ?? null;

  return (
    <>
      {data.dataGaps.notes.length > 0 ? <MissingData data={data} emphasise={empty} /> : null}

      {/* ── KPIs ────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total spend" value={money(data.totals.total)}>
          {data.totals.count} {data.totals.count === 1 ? 'expense' : 'expenses'}
        </Kpi>
        <Kpi label="Vs previous period" value={money(data.totals.previousTotal)}>
          {/* Ink colour on purpose: spending more is not "bad", less is not "good". */}
          <span className="inline-flex items-center gap-1">
            <ChangeIcon aria-hidden="true" className="size-3.5" />
            {change.text}
          </span>
        </Kpi>
        <Kpi
          label={`Highest ${unit}`}
          value={data.highestBucket ? money(data.highestBucket.total) : '—'}
        >
          {data.highestBucket
            ? data.highestBucket.label
            : `No ${unit} with spend yet`}
        </Kpi>
        <Kpi label="Biggest type" value={biggestType ? money(biggestType.total) : '—'}>
          {biggestType ? `${biggestType.name} · ${biggestType.sharePct}%` : 'Nothing to rank yet'}
        </Kpi>
      </div>

      <SourceSplit data={data} />

      {empty ? (
        <Card>
          <EmptyState
            title="No expenses in this period"
            description={
              data.dataGaps.notes.length > 0
                ? 'Nothing with both a price and a date falls in this period. Filling in the missing data above is what brings this report to life.'
                : 'Nothing was bought, repaired or renewed in this period. Try a longer period.'
            }
          />
        </Card>
      ) : (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold">Spend by {unit}</h2>
              <LevelLegend />
            </div>
            <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
              High is at least 1.25× the usual (median) {unit} with spend; low is at most 0.75×. With
              fewer than three {unit}s of spend, every one is normal. A faded bar is only partly inside
              the period.
            </p>
            <SeriesChart data={data} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <GroupChart title="By type" rows={data.byType} currency={data.currency} />
            <GroupChart title="By category" rows={data.byCategory} currency={data.currency} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <GroupTable title="By office" rows={data.byOffice} currency={data.currency} />
            <GroupTable title="By vendor" rows={data.byVendor} currency={data.currency} />
          </div>

          <TopExpenses data={data} />
        </>
      )}

      {data.otherCurrencies.length > 0 ? (
        <Card className="p-4">
          <h2 className="text-sm font-semibold">Other currencies (not converted)</h2>
          <p className="mt-0.5 text-xs text-[var(--color-content-subtle)]">
            Not included in any total above - there is no exchange rate to convert with.
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
            {data.otherCurrencies.map((o) => (
              <li key={o.currency}>
                {formatMoneyText(o.total, o.currency)}{' '}
                <span className="text-[var(--color-content-subtle)]">· {o.count} items</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="text-xs text-[var(--color-content-subtle)]">
        Invoices are not counted - an invoice is the bill for a purchase already counted here. Figures
        read {new Date(data.generatedAt).toLocaleString()}.
      </p>
    </>
  );
}

function Kpi({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-[var(--color-content-subtle)]">{label}</p>
      <p className="mt-1.5 truncate text-2xl font-semibold tabular-nums tracking-tight" title={value}>
        {value}
      </p>
      {children ? (
        <p className="mt-1 text-xs text-[var(--color-content-muted)]">{children}</p>
      ) : null}
    </Card>
  );
}

function MissingData({ data, emphasise }: { data: ExpenseSummaryDto; emphasise: boolean }) {
  return (
    <section
      aria-labelledby="missing-data-title"
      className="rounded-[var(--radius-card)] border p-4"
      style={{
        color: 'var(--tone-warning-fg)',
        backgroundColor: 'var(--tone-warning-bg)',
        borderColor: 'var(--tone-warning-border)',
      }}
    >
      <h2 id="missing-data-title" className="flex items-center gap-2 text-[15px] font-semibold">
        <TriangleAlert aria-hidden="true" className="size-4" />
        {emphasise ? 'Missing data - why this report is empty' : 'Missing data'}
      </h2>
      <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm">
        {data.dataGaps.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      {data.dataGaps.assetsWithoutPrice > 0 || data.dataGaps.pricedAssetsWithoutDate > 0 ? (
        <Link href="/assets/price-sheet" className={cn(linkButtonCls.primary, 'mt-3')}>
          Fill purchase prices with the price sheet
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      ) : null}
    </section>
  );
}

function SourceSplit({ data }: { data: ExpenseSummaryDto }) {
  const total = Number(data.totals.total);
  return (
    <Card className="p-4">
      <h2 className="sr-only">Spend by source</h2>
      {total > 0 ? (
        <div
          className="flex h-2.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
          aria-hidden="true"
        >
          {EXPENSE_SOURCES.map((source) => {
            const part = Number(data.totals.bySource[source].total);
            return part > 0 ? (
              <div
                key={source}
                style={{ width: `${(part / total) * 100}%`, backgroundColor: SOURCE_FILL[source] }}
                className="h-full border-r-2 border-[var(--color-surface-raised)] last:border-r-0"
              />
            ) : null;
          })}
        </div>
      ) : null}
      <dl className={cn('grid gap-3 sm:grid-cols-3', total > 0 && 'mt-3')}>
        {EXPENSE_SOURCES.map((source) => (
          <div key={source} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-1 size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: SOURCE_FILL[source] }}
            />
            <div className="min-w-0">
              <dt className="text-xs text-[var(--color-content-muted)]" title={EXPENSE_SOURCE_LABELS[source]}>
                {SHORT_SOURCE[source]}
              </dt>
              <dd className="truncate font-semibold tabular-nums">
                {formatMoneyText(data.totals.bySource[source].total, data.currency)}
              </dd>
              <dd className="text-xs text-[var(--color-content-subtle)]">
                {data.totals.bySource[source].count} items
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function LevelLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-content-muted)]">
      {(['HIGH', 'NORMAL', 'LOW'] as const).map((level) => (
        <li key={level} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-[3px]"
            style={{ backgroundColor: expenseLevelFill(level) }}
          />
          {EXPENSE_LEVEL_LABELS[level]}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-2.5 rounded-[3px] opacity-40"
          style={{ backgroundColor: expenseLevelFill('NORMAL') }}
        />
        Partial
      </li>
    </ul>
  );
}

interface SeriesDatum extends ExpenseSeriesPointDto {
  value: number;
}

function SeriesChart({ data }: { data: ExpenseSummaryDto }) {
  const rows: SeriesDatum[] = data.series.map((p) => ({ ...p, value: Number(p.total) }));
  const summary = data.highestBucket
    ? `Bar chart of spend by ${data.period.granularity === 'DAY' ? 'day' : 'month'}, ${rows.length} bars. Highest ${data.highestBucket.label} at ${formatMoneyText(data.highestBucket.total, data.currency)}${data.lowestBucket ? `; lowest with spend ${data.lowestBucket.label} at ${formatMoneyText(data.lowestBucket.total, data.currency)}` : ''}.`
    : 'Bar chart of spend with no spend in the period.';

  return (
    <figure className="mt-3">
      <div role="img" aria-label={summary} className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: 'var(--color-border)' }}
              tick={axisTick}
              interval="preserveStartEnd"
              minTickGap={12}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={64}
              tick={axisTick}
              tickFormatter={(v: number) => formatMoneyShort(v, data.currency)}
            />
            <Tooltip
              cursor={{ fill: 'var(--color-surface-sunken)' }}
              content={({ active, payload }) => {
                const point = active ? (payload?.[0]?.payload as SeriesDatum | undefined) : undefined;
                if (!point) return null;
                return (
                  <div style={tooltipBox}>
                    <p className="font-semibold">{point.label}</p>
                    <p className="tabular-nums">{formatMoneyText(point.total, data.currency)}</p>
                    <p className="text-[var(--color-content-muted)]">
                      {point.count} {point.count === 1 ? 'expense' : 'expenses'} ·{' '}
                      {EXPENSE_LEVEL_LABELS[point.level]}
                      {point.partial ? ' · partly in the period' : ''}
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="value" name="Spend" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {rows.map((p) => (
                <Cell key={p.key} fill={expenseLevelFill(p.level)} fillOpacity={p.partial ? 0.4 : 1} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

function GroupChart({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: ExpenseGroupDto[];
  currency: string;
}) {
  const chartRows = topWithOther(rows, 10);
  const height = Math.max(120, chartRows.length * 30 + 24);
  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {chartRows.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--color-content-muted)]">Nothing in this period.</p>
      ) : (
        <div
          role="img"
          aria-label={`${title}: ${chartRows
            .map((r) => `${r.name} ${r.sharePct}%`)
            .join(', ')}`}
          className="mt-3 w-full"
          style={{ height }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartRows}
              layout="vertical"
              margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tick={axisTick}
                tickFormatter={(v: number) => formatMoneyShort(v, currency)}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={130}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12, fill: 'var(--color-content-muted)' }}
                tickFormatter={(name: string) => (name.length > 20 ? `${name.slice(0, 19)}…` : name)}
              />
              <Tooltip
                cursor={{ fill: 'var(--color-surface-sunken)' }}
                content={({ active, payload }) => {
                  const row = active
                    ? (payload?.[0]?.payload as (typeof chartRows)[number] | undefined)
                    : undefined;
                  if (!row) return null;
                  return (
                    <div style={tooltipBox}>
                      <p className="font-semibold">{row.name}</p>
                      <p className="tabular-nums">
                        {row.total ? formatMoneyText(row.total, currency) : formatMoneyShort(row.value, currency)}
                      </p>
                      <p className="text-[var(--color-content-muted)]">
                        {row.sharePct}% of spend · {row.count} {row.count === 1 ? 'expense' : 'expenses'}
                      </p>
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="value"
                name="Spend"
                fill="var(--color-brand)"
                radius={[0, 3, 3, 0]}
                barSize={18}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function GroupTable({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: ExpenseGroupDto[];
  currency: string;
}) {
  return (
    <Card>
      <h2 className="px-4 pt-4 text-[15px] font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 pt-2 text-sm text-[var(--color-content-muted)]">Nothing in this period.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-content-subtle)]">
                <th scope="col" className="px-4 py-2 font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Spend
                </th>
                <th scope="col" className="w-40 px-4 py-2 text-right font-medium">
                  Share
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map((row) => (
                <tr key={`${row.id ?? 'none'}-${row.name}`}>
                  <td className="px-4 py-2">
                    {row.name}
                    <span className="ml-1.5 text-xs text-[var(--color-content-subtle)]">· {row.count}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                    {formatMoneyText(row.total, currency)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <div
                        aria-hidden="true"
                        className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
                      >
                        <div
                          className="h-full rounded-full bg-[var(--color-brand)]"
                          style={{ width: `${Math.min(100, row.sharePct)}%` }}
                        />
                      </div>
                      <span className="w-12 text-right tabular-nums">{row.sharePct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function TopExpenses({ data }: { data: ExpenseSummaryDto }) {
  return (
    <Card>
      <h2 className="px-4 pt-4 text-[15px] font-semibold">Top expenses</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">The largest expenses in the period</caption>
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-content-subtle)]">
              <th scope="col" className="px-4 py-2 font-medium">
                Expense
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Source
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Date
              </th>
              <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">
                Type
              </th>
              <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">
                Vendor
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {data.topExpenses.map((line) => {
              const href = expenseLineHref(line);
              return (
                <tr key={`${line.source}-${line.id}`} className="hover:bg-[var(--color-surface-sunken)]">
                  <td className="max-w-[18rem] truncate px-4 py-2">
                    {href ? (
                      <Link href={href} className="font-medium text-[var(--color-brand)] hover:underline">
                        {line.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{line.title}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-[var(--color-content-muted)]">
                    {SHORT_SOURCE[line.source]}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 tabular-nums text-[var(--color-content-muted)]">
                    {line.localDate}
                  </td>
                  <td className="hidden px-4 py-2 text-[var(--color-content-muted)] md:table-cell">
                    {line.type ?? '—'}
                  </td>
                  <td className="hidden px-4 py-2 text-[var(--color-content-muted)] md:table-cell">
                    {line.vendor ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums">
                    {formatMoneyText(line.amount, line.currency)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
