'use client';

import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/** Shared Recharts tooltip styling, theme-aware via CSS variables. */
const tooltipStyle = {
  contentStyle: {
    background: 'var(--color-surface-raised)',
    border: '1px solid var(--color-border)',
    borderRadius: 10,
    fontSize: 12,
    boxShadow: 'var(--shadow, 0 8px 24px rgba(15,23,42,.10))',
  },
  labelStyle: { color: 'var(--color-content)' },
  itemStyle: { color: 'var(--color-content)' },
} as const;

export interface Slice {
  name: string;
  value: number;
  fill: string;
}

/** Donut with a value + label in the hole (asset distribution). */
export function DonutChart({
  data,
  centerValue,
  centerLabel,
}: {
  data: Slice[];
  centerValue: string | number;
  centerLabel: string;
}) {
  return (
    <div className="relative h-[184px] w-[184px] shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={60}
            outerRadius={84}
            paddingAngle={2}
            strokeWidth={0}
            startAngle={90}
            endAngle={-270}
          >
            {/* Keyed by position, not by name: two asset types in different
                categories can share a name, and React silently drops the
                second slice when two keys collide. */}
            {data.map((d, i) => (
              <Cell key={`${d.name}-${i}`} fill={d.fill} />
            ))}
          </Pie>
          <Tooltip {...tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-2xl font-bold tabular-nums tracking-tight">{centerValue}</div>
          <div className="text-xs text-[var(--color-content-subtle)]">{centerLabel}</div>
        </div>
      </div>
    </div>
  );
}

/** Solid pie (department / office allocation). */
export function AllocationPie({ data }: { data: Slice[] }) {
  return (
    <div className="h-[150px] w-[150px] shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            outerRadius={72}
            strokeWidth={1}
            stroke="var(--color-surface)"
          >
            {/* Keyed by position, not by name: two asset types in different
                categories can share a name, and React silently drops the
                second slice when two keys collide. */}
            {data.map((d, i) => (
              <Cell key={`${d.name}-${i}`} fill={d.fill} />
            ))}
          </Pie>
          <Tooltip {...tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Cumulative asset growth over time (real: derived from purchase dates). */
export function GrowthArea({ data }: { data: { label: string; value: number }[] }) {
  return (
    <div className="h-[196px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
          <defs>
            <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: 'var(--color-border)' }}
            tick={{ fontSize: 11, fill: 'var(--color-content-subtle)' }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={36}
            tick={{ fontSize: 11, fill: 'var(--color-content-subtle)' }}
            allowDecimals={false}
          />
          <Tooltip {...tooltipStyle} />
          <Area
            type="monotone"
            dataKey="value"
            name="Assets"
            stroke="var(--color-brand)"
            strokeWidth={2.5}
            fill="url(#growthFill)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Semicircular health gauge. Pure SVG so it reads crisply at any size and the
 * arc colour follows the value (green / amber / red).
 */
export function Gauge({ percent, label }: { percent: number; label: string }) {
  const LENGTH = 251.3; // π · r(80) for the semicircle path below
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = LENGTH - (clamped / 100) * LENGTH;
  const color =
    clamped >= 85
      ? 'var(--tone-success-solid)'
      : clamped >= 60
        ? 'var(--tone-warning-solid)'
        : 'var(--tone-critical-solid)';
  return (
    <div className="grid place-items-center pt-2">
      <div className="relative" style={{ width: 200, height: 122 }}>
        <svg viewBox="0 0 200 120" width="200" height="120" aria-label={`${label}: ${clamped}%`}>
          <path
            d="M20 104 A80 80 0 0 1 180 104"
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="16"
            strokeLinecap="round"
          />
          <path
            d="M20 104 A80 80 0 0 1 180 104"
            fill="none"
            stroke={color}
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={LENGTH}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)' }}
          />
        </svg>
        <div className="absolute inset-x-0 bottom-0 text-center">
          <div className="text-[32px] font-bold tabular-nums tracking-tight leading-none">
            {clamped}%
          </div>
          <div className="mt-1 text-xs text-[var(--color-content-subtle)]">{label}</div>
        </div>
      </div>
    </div>
  );
}

export interface WarrantyBucket {
  count: number;
  label: string;
  when: string;
  color: string;
}

/** Milestone timeline of upcoming warranty expiries (30 / 60 / 90 / covered). */
export function WarrantyTimeline({ buckets }: { buckets: WarrantyBucket[] }) {
  return (
    <div className="flex items-stretch">
      {buckets.map((b, i) => (
        <div key={b.label} className="relative flex-1 pt-8 text-center">
          <div
            className="absolute top-3 h-[3px] bg-[var(--color-border)]"
            style={{ left: i === 0 ? '50%' : 0, right: i === buckets.length - 1 ? '50%' : 0 }}
          />
          <span
            className="absolute left-1/2 top-1 z-10 size-[18px] -translate-x-1/2 rounded-full border-[3px] border-[var(--color-surface)]"
            style={{ background: b.color, boxShadow: '0 0 0 1px var(--color-border)' }}
          />
          <div className="text-[22px] font-bold tabular-nums tracking-tight">
            {b.count.toLocaleString()}
          </div>
          <div className="mt-0.5 text-xs text-[var(--color-content-muted)]">{b.label}</div>
          <div className="text-[11px] text-[var(--color-content-subtle)]">{b.when}</div>
        </div>
      ))}
    </div>
  );
}

/** Legend row shared by the donut and pie. */
export function Legend({
  items,
}: {
  items: { name: string; value?: string; pct?: string; fill: string }[];
}) {
  return (
    <div className="flex flex-1 flex-col gap-2">
      {/* Position, not name: the legend mirrors the slices, and two asset
          types in different categories can share a name. */}
      {items.map((it, i) => (
        <div key={`${it.name}-${i}`} className="flex items-center gap-2.5 text-[13px]">
          <span className="size-[9px] shrink-0 rounded-[3px]" style={{ background: it.fill }} />
          <span className="text-[var(--color-content-muted)]">{it.name}</span>
          {it.value ? <span className="ml-auto font-semibold tabular-nums">{it.value}</span> : null}
          {it.pct ? (
            <span
              className={`${it.value ? 'w-9' : 'ml-auto'} text-right text-xs tabular-nums text-[var(--color-content-subtle)]`}
            >
              {it.pct}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
