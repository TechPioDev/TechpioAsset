import {
  AlertTriangle,
  CheckCircle2,
  LayoutDashboard,
  Search,
  ShieldAlert,
  Wrench,
} from 'lucide-react';

/**
 * Product showcase and analytics mock-ups for the marketing homepage. These
 * mirror the real PioAssets dashboard's shapes (KPIs, status composition bar,
 * department bars, alert lists) rather than generic dashboard clip-art, so
 * what the visitor sees is what the product actually looks like. Figures are
 * illustrative and labelled as such by context.
 */

const STATUS_SEGMENTS = [
  { label: 'In use', pct: 62, cls: 'bg-[#0040b0]' },
  { label: 'In stock', pct: 17, cls: 'bg-[#60a5fa]' },
  { label: 'Maintenance', pct: 8, cls: 'bg-[#f59e0b]' },
  { label: 'In transit', pct: 7, cls: 'bg-[#93c5fd]' },
  { label: 'Retired', pct: 6, cls: 'bg-[#cbd5e1]' },
];

const DEPARTMENTS = [
  { name: 'Engineering', count: 412, pct: 100 },
  { name: 'Operations', count: 268, pct: 65 },
  { name: 'Sales', count: 194, pct: 47 },
  { name: 'Finance', count: 121, pct: 29 },
  { name: 'HR', count: 84, pct: 20 },
];

export function ProductShowcase() {
  return (
    <div className="overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl">
      {/* window chrome */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#f87171]" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-[#fbbf24]" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-[#34d399]" aria-hidden="true" />
        <span className="ml-3 hidden rounded-md bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-content-subtle)] sm:block">
          pioassets.com/dashboard
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr]">
        {/* sidebar */}
        <aside className="hidden border-r border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-xs md:block" aria-hidden="true">
          <div className="flex items-center gap-2 px-2 py-1.5 font-semibold">
            <LayoutDashboard className="size-3.5 text-[var(--color-brand)]" /> Dashboard
          </div>
          {['Assets', 'Licences', 'Maintenance', 'People', 'Reports', 'Audit log'].map((item) => (
            <p key={item} className="rounded-md px-2 py-1.5 text-[var(--color-content-muted)]">
              {item}
            </p>
          ))}
        </aside>

        {/* main pane */}
        <div className="min-w-0 p-4 sm:p-5">
          {/* search / filter row */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-8 flex-1 basis-48 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-2.5 text-xs text-[var(--color-content-subtle)]">
              <Search className="size-3.5" aria-hidden="true" /> Search assets, serials, people…
            </div>
            {['Status: All', 'Department: All'].map((f) => (
              <span key={f} className="hidden rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-content-muted)] sm:block">
                {f}
              </span>
            ))}
          </div>

          {/* KPI row */}
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ShowKpi label="Total assets" value="1,248" sub="+18 this month" />
            <ShowKpi label="Asset value" value="$1.84M" sub="book value" />
            <ShowKpi label="Warranty alerts" value="43" sub="expiring ≤ 90 days" warn />
            <ShowKpi label="Maintenance open" value="34" sub="12 due this week" warn />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* status composition */}
            <div className="rounded-2xl border border-[var(--color-border)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                Assets by status
              </p>
              <div className="mt-3 flex h-3.5 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Status composition: in use 62%, in stock 17%, maintenance 8%, in transit 7%, retired 6%">
                {STATUS_SEGMENTS.map((s) => (
                  <span key={s.label} className={`${s.cls} h-full`} style={{ width: `${s.pct}%` }} />
                ))}
              </div>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                {STATUS_SEGMENTS.map((s) => (
                  <li key={s.label} className="flex items-center gap-1.5 text-[var(--color-content-muted)]">
                    <span className={`size-2.5 rounded-sm ${s.cls}`} aria-hidden="true" />
                    {s.label} · {s.pct}%
                  </li>
                ))}
              </ul>

              <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                Assets by department
              </p>
              <ul className="mt-2 grid grid-cols-1 gap-2">
                {DEPARTMENTS.map((d) => (
                  <li key={d.name} className="grid grid-cols-[88px_1fr_40px] items-center gap-2 text-xs">
                    <span className="truncate text-[var(--color-content-muted)]">{d.name}</span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
                      <span className="block h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${d.pct}%` }} />
                    </span>
                    <span className="text-right font-semibold tabular-nums">{d.count}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* alerts + activity */}
            <div className="grid grid-cols-1 gap-4">
              <div className="rounded-2xl border border-[var(--color-border)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                  Needs attention
                </p>
                <ul className="mt-2.5 grid grid-cols-1 gap-2 text-xs">
                  <AlertRow icon={<ShieldAlert className="size-3.5 text-[var(--tone-warning-fg)]" />} text="43 warranties expire within 90 days" pill="Review" />
                  <AlertRow icon={<Wrench className="size-3.5 text-[var(--tone-warning-fg)]" />} text="12 maintenance jobs due this week" pill="Schedule" />
                  <AlertRow icon={<AlertTriangle className="size-3.5 text-[var(--tone-critical-fg)]" />} text="3 assets unaccounted for at stock-take" pill="Investigate" critical />
                </ul>
              </div>
              <div className="rounded-2xl border border-[var(--color-border)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                  Recent activity
                </p>
                <ul className="mt-2.5 grid grid-cols-1 gap-1.5 text-xs text-[var(--color-content-muted)]">
                  {[
                    'MacBook Pro 14″ assigned to Alex M. — receipt confirmed',
                    'Dell Latitude 5540 warranty synced from vendor',
                    'HP ProBook 450 sent for battery replacement',
                    'Licence renewal recorded: 25 × productivity suite',
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 size-3.5 flex-none text-[var(--tone-success-fg)]" aria-hidden="true" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShowKpi({ label, value, sub, warn = false }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] p-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-content-subtle)]">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${warn ? 'text-[var(--tone-warning-fg)]' : ''}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-[var(--color-content-subtle)]">{sub}</p>
    </div>
  );
}

function AlertRow({ icon, text, pill, critical = false }: { icon: React.ReactNode; text: string; pill: string; critical?: boolean }) {
  return (
    <li className="flex items-center gap-2 rounded-xl bg-[var(--color-surface-sunken)] px-2.5 py-2">
      <span className="flex-none" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[var(--color-content-muted)]">{text}</span>
      <span
        className={`flex-none rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          critical
            ? 'bg-[var(--color-tint-rose)] text-[var(--color-tint-rose-fg)]'
            : 'bg-[var(--color-tint-amber)] text-[var(--color-tint-amber-fg)]'
        }`}
      >
        {pill}
      </span>
    </li>
  );
}

/* ── Reporting & analytics ─────────────────────────────────────────────── */

const SPEND = [42, 58, 36, 71, 64, 89, 53, 77, 95, 68, 84, 110];
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const CATEGORIES = [
  { label: 'Laptops', pct: 46, color: '#0040b0' },
  { label: 'Monitors', pct: 22, color: '#60a5fa' },
  { label: 'Mobile', pct: 14, color: '#93c5fd' },
  { label: 'Servers & network', pct: 11, color: '#a5b4fc' },
  { label: 'Other', pct: 7, color: '#cbd5e1' },
];

export function AnalyticsShowcase() {
  const max = Math.max(...SPEND);
  // Donut geometry: circumference slices proportional to pct.
  const R = 40;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 lg:col-span-2">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold">IT spend by month</p>
          <p className="text-xs text-[var(--color-content-subtle)]">illustrative year, $k</p>
        </div>
        <div className="mt-4 flex h-40 items-end gap-1.5" role="img" aria-label="Bar chart of monthly IT spending across a year, peaking in December">
          {SPEND.map((v, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <span
                className="w-full rounded-t-md bg-[var(--color-brand)]"
                style={{ height: `${(v / max) * 100}%`, opacity: i === SPEND.length - 1 ? 1 : 0.45 + (v / max) * 0.4 }}
              />
              <span className="text-[10px] text-[var(--color-content-subtle)]">{MONTHS[i]}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Total asset value" value="$1.84M" />
          <MiniStat label="Depreciation YTD" value="$212k" />
          <MiniStat label="Maintenance cost" value="$18.4k" />
          <MiniStat label="Replacement forecast" value="61 devices" />
        </div>
      </div>

      <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <p className="text-sm font-semibold">Assets by category</p>
        <div className="mt-4 flex items-center justify-center">
          <svg width="140" height="140" viewBox="0 0 100 100" role="img" aria-label="Donut chart: laptops 46%, monitors 22%, mobile 14%, servers and network 11%, other 7%">
            {CATEGORIES.map((c) => {
              const len = (c.pct / 100) * C;
              const el = (
                <circle
                  key={c.label}
                  cx="50"
                  cy="50"
                  r={R}
                  fill="none"
                  stroke={c.color}
                  strokeWidth="14"
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 50 50)"
                />
              );
              offset += len;
              return el;
            })}
            <text x="50" y="48" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--color-content)">
              1,248
            </text>
            <text x="50" y="60" textAnchor="middle" fontSize="6.5" fill="var(--color-content-subtle)">
              tracked assets
            </text>
          </svg>
        </div>
        <ul className="mt-3 grid gap-1.5 text-xs">
          {CATEGORIES.map((c) => (
            <li key={c.label} className="flex items-center gap-2 text-[var(--color-content-muted)]">
              <span className="size-2.5 rounded-sm" style={{ background: c.color }} aria-hidden="true" />
              <span className="flex-1">{c.label}</span>
              <span className="font-semibold tabular-nums">{c.pct}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-content-subtle)]">{label}</p>
      <p className="mt-0.5 text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}
