'use client';

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

export interface StatusDatum {
  label: string;
  count: number;
  /** A CSS colour (theme-aware var recommended, e.g. var(--tone-success-solid)). */
  fill: string;
}

/**
 * Assets-by-status distribution (spec section 5: dashboard). Colours come in as
 * CSS variables so the bars follow the light/dark theme without a re-render, and
 * axis/grid colours reuse the app's surface tokens for the same reason.
 */
export function StatusBarChart({ data }: { data: StatusDatum[] }) {
  return (
    <div className="h-64 w-full px-2 py-3">
      <ResponsiveContainer width="100%" height="100%">
        {/*
          left: 0, not -18. The negative margin pulled the axis off-canvas and
          the 32px-wide tick labels were clipped to their last character, so
          0/20/40/60/80 all rendered as "0" - five zeros down the side of a
          chart whose tallest bar was 79.
        */}
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="label"
            interval={0}
            angle={-20}
            textAnchor="end"
            height={54}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-border)' }}
            tick={{ fontSize: 11, fill: 'var(--color-content-subtle)' }}
          />
          <YAxis
            allowDecimals={false}
            width={38}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: 'var(--color-content-subtle)' }}
          />
          <Tooltip
            cursor={{ fill: 'var(--color-surface-sunken)' }}
            contentStyle={{
              background: 'var(--color-surface-raised)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: 'var(--color-content)' }}
            itemStyle={{ color: 'var(--color-content)' }}
          />
          <Bar dataKey="count" name="Assets" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
