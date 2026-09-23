import { BarChart3, Monitor, ShieldCheck } from 'lucide-react';

/**
 * The panel beside the sign-in form (v2.24).
 *
 * A sign-in page is the one page every user sees and the first page a visitor
 * who followed a link sees, and it was a bare form on an empty screen. This
 * says what the product is while the form does its job.
 *
 * It is static by design. The marketing hero animates a 14-second lifecycle
 * loop; a person trying to type a password does not need that moving beside
 * them. Rendered from the design tokens rather than a screenshot, so it follows
 * the theme and stays sharp at any size - and cannot go stale the way a picture
 * of last year's dashboard does.
 */

const FEATURES = [
  {
    icon: Monitor,
    title: 'Asset Inventory',
    body: 'Real-time visibility of all your IT assets.',
  },
  {
    icon: ShieldCheck,
    title: 'Lifecycle Tracking',
    body: 'Track warranties, contracts and asset lifecycle.',
  },
  {
    icon: BarChart3,
    title: 'Cost & Compliance',
    body: 'Control spending and stay audit ready.',
  },
];

export function LoginShowcase() {
  return (
    <section
      aria-label="About PioAssets"
      className="relative isolate hidden overflow-hidden bg-[var(--color-surface-raised)] lg:block"
    >
      <Backdrop />

      {/* Height-based, not width-based. What runs out on a laptop is vertical
          room, and a width breakpoint cannot see that: 1366x768 and 1366x1050
          are the same screen to `lg:`. The gaps and padding tighten first, and
          only then does content drop. */}
      <div className="relative flex h-full flex-col justify-center gap-5 px-10 py-8 [@media(min-height:800px)]:gap-8 [@media(min-height:800px)]:py-14 xl:px-14">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-xs font-semibold text-[var(--color-content-muted)]">
            <ShieldCheck aria-hidden="true" className="size-3.5 text-[var(--color-brand)]" />
            IT Asset Lifecycle Management
          </span>

          <h2 className="mt-6 text-4xl font-bold leading-[1.12] tracking-tight text-balance xl:text-[2.75rem]">
            Manage Every <span className="text-[var(--color-brand)]">Asset</span>.
            <br />
            Control Every <span className="text-[var(--color-brand)]">Cost</span>.
          </h2>

          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[var(--color-content-muted)]">
            PioAssets helps IT teams manage hardware, software, users and lifecycle from one
            platform. Make smarter decisions. Reduce waste. Stay compliant.
          </p>
        </div>

        {/* Below this the three cards cannot fit without squeezing the heading
            and the form beside it; the heading says the same thing. */}
        <ul className="grid gap-3 sm:grid-cols-3 [@media(max-height:600px)]:hidden">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              <Icon aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
              <p className="mt-3 text-sm font-semibold">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--color-content-muted)]">
                {body}
              </p>
            </li>
          ))}
        </ul>

        {/* The mockup is taller than the space left over, and always was - it
            used to simply run off the bottom of the page, cut through the
            middle of a table row. It now bleeds off the panel behind a fade,
            which is the same crop made deliberate, and drops out entirely when
            there is not enough height left for it to read as anything. */}
        <div
          className="relative -mb-8 min-h-0 flex-1 [@media(max-height:720px)]:hidden"
          style={{
            maskImage: 'linear-gradient(to bottom, black 68%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 68%, transparent 100%)',
          }}
        >
          <DashboardPreview />
        </div>
      </div>
    </section>
  );
}

/** Soft blue wash, a dot grid, and the brand shape cropped at the bottom-left. */
function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div
        className="absolute inset-0 opacity-70 dark:opacity-40"
        style={{
          background:
            'linear-gradient(150deg, var(--color-surface) 0%, var(--color-tint-blue) 55%, var(--color-surface) 100%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'radial-gradient(circle, var(--color-border-strong) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          maskImage: 'radial-gradient(ellipse at 70% 0%, rgba(0,0,0,0.7), transparent 60%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 70% 0%, rgba(0,0,0,0.7), transparent 60%)',
        }}
      />
      {/* A corner accent, and it has to stay one. At 34rem it clears the copy
          on a tall panel, but the panel centres its content: shorten the window
          and the text comes down to meet the circle, which put the heading in
          dark blue on mid blue. It shrinks with the height so it stays in the
          corner it belongs to. */}
      <div
        className="absolute -bottom-24 -left-24 size-64 rounded-full opacity-90 [@media(min-height:760px)]:-bottom-40 [@media(min-height:760px)]:-left-40 [@media(min-height:760px)]:size-[34rem]"
        style={{ background: 'linear-gradient(135deg, #0040b0, #0052cc 60%, #3b82f6)' }}
      />
    </div>
  );
}

/**
 * A miniature of the dashboard, drawn rather than screenshotted.
 *
 * The figures are an example, and say so: this sits on a page where nobody is
 * signed in, so a number here is illustration and must not be mistaken for the
 * reader's own fleet.
 */
function DashboardPreview() {
  return (
    <figure className="m-0 overflow-hidden rounded-t-[var(--radius-card)] border border-b-0 border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_-1px_40px_-12px_rgba(15,23,42,0.25)]">
      <div className="flex" aria-hidden="true">
        <MiniSidebar />

        <div className="min-w-0 flex-1 p-3.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold">Dashboard Overview</p>
            <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[9px] font-medium text-[var(--color-content-subtle)]">
              Example data
            </span>
          </div>

          <div className="mt-2.5 grid grid-cols-4 gap-2">
            <Kpi label="Total Assets" value="2,548" delta="+12.5%" up />
            <Kpi label="Active Assets" value="2,152" delta="+10.3%" up />
            <Kpi label="Software" value="1,320" delta="+8.6%" up />
            <Kpi label="Total Cost" value="$98,430" delta="-4.7%" />
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <Panel title="Assets by Category">
              <div className="flex items-center gap-3">
                <Donut />
                <ul className="min-w-0 flex-1 grid gap-1">
                  {[
                    ['Laptops', '1,245', '#0040b0'],
                    ['Desktops', '862', '#3b82f6'],
                    ['Servers', '256', '#f59e0b'],
                    ['Mobile', '120', '#60a5fa'],
                  ].map(([name, count, colour]) => (
                    <li key={name} className="flex items-center gap-1.5 text-[9px]">
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ background: colour }}
                      />
                      <span className="truncate text-[var(--color-content-muted)]">{name}</span>
                      <span className="ml-auto font-medium tabular-nums">{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>

            <Panel title="Recent Alerts">
              <ul className="grid gap-1">
                {[
                  ['Warranty expired', '12', 'rose'],
                  ['Licence expiring soon', '18', 'amber'],
                  ['Assets offline', '7', 'blue'],
                  ['Compliance issue', '4', 'blue'],
                ].map(([label, count, tint]) => (
                  <li key={label} className="flex items-center gap-1.5 text-[9px]">
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: `var(--color-tint-${tint}-fg)` }}
                    />
                    <span className="truncate text-[var(--color-content-muted)]">{label}</span>
                    <span
                      className="ml-auto rounded px-1 font-medium tabular-nums"
                      style={{
                        background: `var(--color-tint-${tint})`,
                        color: `var(--color-tint-${tint}-fg)`,
                      }}
                    >
                      {count}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <Panel title="Recent Assets" className="mt-2">
            <table className="w-full border-collapse text-[9px]">
              <thead>
                <tr className="text-[8px] uppercase tracking-wide text-[var(--color-content-subtle)]">
                  <th className="pb-1 text-left font-medium">Asset</th>
                  <th className="pb-1 text-left font-medium">Type</th>
                  <th className="pb-1 text-left font-medium">User</th>
                  <th className="pb-1 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['LAP-1001', 'Laptop', 'A. Kaur'],
                  ['DESK-2050', 'Desktop', 'J. Smith'],
                  ['SRV-3001', 'Server', 'IT Department'],
                ].map(([tag, type, user]) => (
                  <tr key={tag} className="border-t border-[var(--color-border)]">
                    <td className="py-1 font-medium text-[var(--color-brand)]">{tag}</td>
                    <td className="py-1 text-[var(--color-content-muted)]">{type}</td>
                    <td className="py-1 text-[var(--color-content-muted)]">{user}</td>
                    <td className="py-1">
                      <span className="rounded px-1 font-medium text-[var(--color-tint-green-fg)] bg-[var(--color-tint-green)]">
                        Active
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>

      <figcaption className="sr-only">
        An illustration of the PioAssets dashboard, showing example totals for assets, software and
        cost, a breakdown by category, recent alerts and recently added equipment.
      </figcaption>
    </figure>
  );
}

function MiniSidebar() {
  const items = ['Dashboard', 'Assets', 'Software', 'Users', 'Contracts', 'Reports', 'Settings'];
  return (
    <div className="w-[7.5rem] shrink-0 bg-[#0b1a3a] p-2.5">
      <p className="px-1 text-[11px] font-bold text-white">PioAssets</p>
      <ul className="mt-2.5 grid gap-0.5">
        {items.map((item, i) => (
          <li
            key={item}
            className={
              i === 0
                ? 'rounded bg-[#0052cc] px-1.5 py-1 text-[9px] font-medium text-white'
                : 'rounded px-1.5 py-1 text-[9px] text-white/60'
            }
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Kpi({
  label,
  value,
  delta,
  up = false,
}: {
  label: string;
  value: string;
  delta: string;
  up?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-1.5">
      <p className="truncate text-[8px] text-[var(--color-content-subtle)]">{label}</p>
      <p className="mt-0.5 text-[13px] font-bold tabular-nums">{value}</p>
      <p
        className="text-[8px] font-medium"
        style={{ color: up ? 'var(--color-tint-green-fg)' : 'var(--color-tint-rose-fg)' }}
      >
        {up ? '↑' : '↓'} {delta}
      </p>
    </div>
  );
}

function Panel({
  title,
  className = '',
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border border-[var(--color-border)] p-2 ${className}`}>
      <p className="mb-1.5 text-[10px] font-semibold">{title}</p>
      {children}
    </div>
  );
}

/** Four arcs on one circle, drawn with stroke-dasharray rather than paths. */
function Donut() {
  const segments = [
    { value: 1245, colour: '#0040b0' },
    { value: 862, colour: '#3b82f6' },
    { value: 256, colour: '#f59e0b' },
    { value: 185, colour: '#60a5fa' },
  ];
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const circumference = 2 * Math.PI * 16;
  let offset = 0;

  return (
    <svg width="58" height="58" viewBox="0 0 40 40" className="shrink-0">
      <circle cx="20" cy="20" r="16" fill="none" stroke="var(--color-border)" strokeWidth="7" />
      {segments.map((s) => {
        const length = (s.value / total) * circumference;
        const dash = (
          <circle
            key={s.colour}
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke={s.colour}
            strokeWidth="7"
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 20 20)"
          />
        );
        offset += length;
        return dash;
      })}
      <text
        x="20"
        y="21"
        textAnchor="middle"
        fontSize="7"
        fontWeight="700"
        fill="var(--color-content)"
      >
        2,548
      </text>
    </svg>
  );
}
