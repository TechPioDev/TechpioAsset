import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  FileSpreadsheet,
  Mail,
  Minus,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import { HeroAccent, HeroBackdrop, HeroBadge } from '@/components/marketing/hero-backdrop';
import { Reveal } from '@/components/marketing/motion';
import {
  AlertsStrip,
  AssetRecord,
  FeatureNav,
  FieldPhone,
  HeroPanels,
  LifecycleExplorer,
  QrScanStory,
  SearchDemo,
  ServiceTimeline,
} from '@/components/marketing/features-visuals';

export const metadata: Metadata = {
  title: { absolute: 'PioAssets Features | IT Asset Management Software' },
  description:
    'Explore PioAssets features for IT asset management, lifecycle tracking, warranty management, maintenance, reporting, QR scanning, audit history and more.',
  openGraph: {
    title: 'PioAssets Features | IT Asset Management Software',
    description:
      'The complete PioAssets capability catalog: inventory, assignment, lifecycle, warranty, maintenance, QR scanning, reporting, audit and access control.',
    url: 'https://pioassets.com/features',
    siteName: 'PioAssets',
    type: 'website',
    images: [
      {
        url: 'https://pioassets.com/marketing/og-card.jpg',
        width: 1200,
        height: 630,
        alt: 'PioAssets — track, manage and optimize IT assets',
      },
    ],
  },
  alternates: { canonical: 'https://pioassets.com/features' },
};

/**
 * Features page (2026-08): a long-form product catalog. Every capability shown
 * here exists in the product today unless explicitly labelled "Coming soon" -
 * the honesty labels are part of the design, not an afterthought.
 */

function Head({ kicker, title, body, id }: { kicker: string; title: string; body?: string; id?: string }) {
  return (
    <Reveal className="max-w-2xl">
      {id ? <span id={id} className="block scroll-mt-28" aria-hidden="true" /> : null}
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-brand)]">{kicker}</p>
      <h2 className="mt-3 text-2xl font-bold tracking-tight text-balance sm:text-3xl">{title}</h2>
      {body ? <p className="mt-3 leading-relaxed text-[var(--color-content-muted)]">{body}</p> : null}
    </Reveal>
  );
}

const SECTION = 'mx-auto max-w-6xl px-5 py-16 sm:py-20';
const SECTION_ALT = 'border-y border-[var(--color-border)] bg-[var(--color-surface-sunken)]';

export default function FeaturesPage() {
  return (
    <>
      {/* ── 1 · HERO ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <HeroBackdrop />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:py-20 lg:grid-cols-2 lg:py-24">
          <div>
            <HeroBadge>PioAssets Features</HeroBadge>
            <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance text-white sm:text-5xl lg:leading-[1.05]">
              Everything you need to manage your <HeroAccent>IT assets.</HeroAccent>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-white/80">
              From discovery and assignment to maintenance, warranty, reporting and retirement,
              PioAssets brings the complete asset lifecycle into one connected platform.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/login"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-[#0040b0] shadow-lg shadow-blue-950/30 transition-all hover:bg-[#e8f0ff] hover:shadow-xl"
              >
                Get Started <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
              <Link
                href="/#demo"
                className="inline-flex h-12 items-center rounded-full border border-white/35 px-6 text-sm font-semibold text-white transition-colors hover:border-white/70 hover:bg-white/10"
              >
                Book a Demo
              </Link>
            </div>
          </div>
          <HeroPanels />
        </div>
      </section>

      {/* ── 2 · FEATURE NAV ──────────────────────────────────────────── */}
      <FeatureNav />

      {/* ── 3 · ASSET MANAGEMENT ─────────────────────────────────────── */}
      <section id="assets" className={`${SECTION} scroll-mt-24`}>
        <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
          <Head
            kicker="Asset management"
            title="Know exactly what you own."
            body="Maintain a centralized record of the technology your organization owns, manages or operates — identity, ownership, money and condition in one place. Every field below is a real column in the product, and hovering shows how the record is organised."
          />
          <Reveal delay={120}><AssetRecord /></Reveal>
        </div>
      </section>

      {/* ── 4 · DISCOVERY & IMPORT ───────────────────────────────────── */}
      <section id="discovery" className={`${SECTION_ALT} scroll-mt-24`}>
        <div className={SECTION}>
          <Head
            kicker="Discovery & import"
            title="Bring your asset data into one place."
            body="Start from the register you already have: import it from Excel, or let the Windows discovery agent report hardware directly from your machines — serials, specs and installed software included."
          />
          <div className="mt-10 grid gap-8 lg:grid-cols-2">
            <Reveal delay={100}>
              <ol className="grid grid-cols-1 gap-0">
                {[
                  ['Import', 'Excel / CSV — bulk-load your existing register'],
                  ['Discover', 'Windows agent reports machines automatically'],
                  ['Validate', 'Clean, match and review records before they land'],
                  ['Register', 'Structured PioAssets records with QR labels'],
                  ['Manage', 'Lifecycle tracking starts immediately'],
                ].map(([step, body], i) => (
                  <li key={step} className="relative flex gap-4 pb-5 last:pb-0">
                    {i < 4 ? <span aria-hidden="true" className="absolute left-[15px] top-8 bottom-0 w-px bg-[var(--color-border-strong)]" /> : null}
                    <span className="grid size-8 flex-none place-items-center rounded-full bg-[var(--color-brand)] text-xs font-bold text-white">{i + 1}</span>
                    <div>
                      <p className="font-semibold">{step}</p>
                      <p className="text-sm text-[var(--color-content-muted)]">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Reveal>
            <Reveal delay={200}>
              <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-lg">
                <p className="flex items-center gap-2 text-sm font-semibold"><FileSpreadsheet aria-hidden="true" className="size-4 text-[var(--color-brand)]" /> Import assets</p>
                <div className="mt-3 rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-sunken)] px-4 py-3 font-mono text-xs text-[var(--color-content-muted)]">company-assets.xlsx</div>
                <p className="mt-3 text-sm font-semibold">1,248 records detected</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <span className="rounded-lg bg-[var(--color-tint-green)] px-3 py-2 font-semibold text-[var(--color-tint-green-fg)]">✓ 1,210 valid</span>
                  <span className="rounded-lg bg-[var(--color-tint-amber)] px-3 py-2 font-semibold text-[var(--color-tint-amber-fg)]">⚠ 38 need review</span>
                </div>
                <div className="mt-4 flex gap-2">
                  <span className="rounded-full border border-[var(--color-border-strong)] px-4 py-2 text-xs font-semibold">Review records</span>
                  <span className="rounded-full bg-[var(--color-brand)] px-4 py-2 text-xs font-semibold text-white">Import assets</span>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── 5 · ASSIGNMENT ───────────────────────────────────────────── */}
      <section id="assignment" className={`${SECTION} scroll-mt-24`}>
        <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <Head
              kicker="Assignment & ownership"
              title="Always know who has what."
              body="Connect assets to employees, departments and locations. Assign, transfer, return and reassign follow tracked workflows — with receipt confirmation from the holder's phone, and the full ownership history kept."
            />
            <Reveal delay={120}>
              <div className="mt-8 flex flex-wrap items-center gap-2 text-sm font-semibold">
                {['Laptop', 'Employee', 'Department', 'Location'].map((n, i) => (
                  <span key={n} className="flex items-center gap-2">
                    <span className={`rounded-full px-3.5 py-1.5 ${i === 0 ? 'bg-[var(--color-brand)] text-white' : 'border border-[var(--color-border-strong)] text-[var(--color-content-muted)]'}`}>{n}</span>
                    {i < 3 ? <ArrowRight aria-hidden="true" className="size-4 text-[var(--color-brand)]/60" /> : null}
                  </span>
                ))}
              </div>
            </Reveal>
          </div>
          <Reveal delay={180}>
            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-lg">
              <p className="text-sm font-semibold">Asset assignment history</p>
              <ol className="mt-4 border-l-2 border-[var(--color-brand)]/25 pl-6">
                {[
                  ['12 Aug 2026', 'Assigned → Alex Morgan', 'Receipt confirmed from mobile'],
                  ['02 Jul 2026', 'Returned by Sarah Lee', 'Condition in: good'],
                  ['15 Feb 2026', 'Assigned → Sarah Lee', 'With charger and dock'],
                ].map(([date, event, meta]) => (
                  <li key={date} className="relative pb-5 last:pb-0">
                    <span aria-hidden="true" className="absolute -left-[31px] top-1.5 size-2.5 rounded-full bg-[var(--color-brand)]" />
                    <p className="font-mono text-xs text-[var(--color-content-subtle)]">{date}</p>
                    <p className="mt-0.5 text-sm font-semibold">{event}</p>
                    <p className="text-xs text-[var(--color-content-muted)]">{meta}</p>
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 6 · LIFECYCLE ────────────────────────────────────────────── */}
      <section id="lifecycle" className={`${SECTION_ALT} scroll-mt-24`}>
        <div className={SECTION}>
          <Head
            kicker="Lifecycle management"
            title="Follow an asset from purchase to retirement."
            body="Nine stages, one record. Click through the stages — each carries its own information, and the strict status flow means no asset ever skips a step or loses its history."
          />
          <Reveal delay={120} className="mt-10"><LifecycleExplorer /></Reveal>
        </div>
      </section>

      {/* ── 7 · WARRANTY ─────────────────────────────────────────────── */}
      <section id="warranty" className={`${SECTION} scroll-mt-24`}>
        <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <Head
              kicker="Warranty management"
              title="Stay ahead of warranty expiration."
              body="Warranty windows live on the asset record, expiry sweeps warn while there is still time to act, and for supported manufacturers (Lenovo today, more planned) the dates refresh automatically from the vendor — no typing at all."
            />
            <Reveal delay={140}>
              <ul className="mt-6 grid grid-cols-1 gap-2 text-sm text-[var(--color-content-muted)]">
                {['Provider, start and end dates on the record', 'Remaining-days countdown with status colors', '30 / 60 / 90-day expiry alerts', 'Automatic manufacturer lookup (Lenovo available now)', 'One-click vendor page check for other makers'].map((li) => (
                  <li key={li} className="flex items-start gap-2.5"><ShieldCheck aria-hidden="true" className="mt-0.5 size-4 flex-none text-[var(--color-brand)]" /> {li}</li>
                ))}
              </ul>
            </Reveal>
          </div>
          <Reveal delay={180}>
            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-lg">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-semibold">Warranty center</p>
                <p className="text-xs font-semibold text-[var(--tone-warning-fg)]">43 expiring soon</p>
              </div>
              <ul className="mt-4 grid grid-cols-1 gap-3">
                {[
                  ['Dell Latitude 5540', '42 days remaining', 62, 'amber'],
                  ['MacBook Pro 14″', '87 days remaining', 34, 'green'],
                  ['HP ProBook 450', 'Expired', 100, 'rose'],
                ].map(([name, status, pct, tone]) => (
                  <li key={name as string}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-semibold">{name}</span>
                      <span className={`text-xs font-semibold ${tone === 'green' ? 'text-[var(--tone-success-fg)]' : tone === 'amber' ? 'text-[var(--tone-warning-fg)]' : 'text-[var(--tone-critical-fg)]'}`}>{status}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]" aria-hidden="true">
                      <span className={`block h-full rounded-full ${tone === 'green' ? 'bg-[var(--tone-success-fg)]' : tone === 'amber' ? 'bg-[var(--tone-warning-fg)]' : 'bg-[var(--tone-critical-fg)]'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 8 · MAINTENANCE ──────────────────────────────────────────── */}
      <section id="maintenance" className={`${SECTION_ALT} scroll-mt-24`}>
        <div className={SECTION}>
          <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
            <Head
              kicker="Maintenance & service"
              title="Keep the full service history with the asset."
              body="Repairs, servicing, technicians, parts, costs, notes and downtime — recorded against the asset, not lost in a ticket system. Work orders escalate automatically when they sit too long."
            />
            <Reveal delay={150}>
              <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-lg">
                <p className="mb-5 text-sm font-semibold">MacBook Pro 14&Prime; · service timeline</p>
                <ServiceTimeline />
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── 9 · QR & BARCODE ─────────────────────────────────────────── */}
      <section id="qr" className={`${SECTION} scroll-mt-24`}>
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <Head
            kicker="QR & barcode"
            title="Scan an asset. Get the full story."
            body="Every registered asset gets a printable QR label. Scan it with the mobile app and the record opens on the spot — view, verify, assign, transfer, update or report an issue without walking back to a desk."
          />
          <Reveal delay={150}><QrScanStory /></Reveal>
        </div>
      </section>

      {/* ── 10 · MOBILE & FIELD OPS ──────────────────────────────────── */}
      <section className={`${SECTION_ALT} scroll-mt-24`}>
        <div className={SECTION}>
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <Reveal delay={150} className="order-2 lg:order-1"><FieldPhone /></Reveal>
            <div className="order-1 lg:order-2">
              <Head
                kicker="Mobile & field operations"
                title="Manage assets wherever work happens."
                body="Verification, inventory checks, assignments, returns and scanning run from the Android app — and stock-takes keep working with no signal, syncing automatically when the connection returns."
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── 11 · REPORTING + 12 · COST ───────────────────────────────── */}
      <section id="reporting" className={`${SECTION} scroll-mt-24`}>
        <Head
          kicker="Reporting & analytics"
          title="Turn asset data into better decisions."
          body="Value, spend, age, warranty exposure and replacement needs — by category, department, location and status. Export any view to CSV or Excel, or schedule reports straight to an inbox."
        />
        <div className="mt-10 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Reveal delay={100}>
            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-lg">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-semibold">Asset value trend</p>
                <p className="text-xs text-[var(--color-content-subtle)]">illustrative, $k</p>
              </div>
              <svg viewBox="0 0 400 130" className="mt-4 h-auto w-full" role="img" aria-label="Line chart of asset book value rising then flattening as depreciation catches up">
                <g stroke="var(--color-border)" strokeWidth="1">
                  <line x1="0" y1="30" x2="400" y2="30" /><line x1="0" y1="70" x2="400" y2="70" /><line x1="0" y1="110" x2="400" y2="110" />
                </g>
                <polyline points="0,108 50,96 100,86 150,70 200,66 250,52 300,48 350,38 400,34" fill="none" stroke="var(--color-brand)" strokeWidth="3" strokeLinecap="round" />
                <polyline points="0,112 50,108 100,106 150,100 200,99 250,94 300,93 350,90 400,88" fill="none" stroke="var(--tone-warning-fg)" strokeWidth="2" strokeDasharray="5 4" />
                <circle cx="400" cy="34" r="4" fill="var(--color-brand)" />
              </svg>
              <div className="mt-2 flex gap-5 text-xs text-[var(--color-content-muted)]">
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[var(--color-brand)]" aria-hidden="true" /> Book value</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed border-[var(--tone-warning-fg)]" aria-hidden="true" /> Depreciation</span>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3">
                {[['Total value', '$1.84M'], ['Avg. asset age', '2.1 yrs'], ['Replace next FY', '61']].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-[var(--color-surface-sunken)] px-3 py-2.5">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-content-subtle)]">{k}</p>
                    <p className="mt-0.5 text-sm font-bold tabular-nums">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
          <Reveal delay={200}>
            <div id="cost" className="scroll-mt-28 rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-lg">
              <p className="text-sm font-semibold">Technology spend</p>
              <p className="mt-1 text-xs text-[var(--color-content-subtle)]">Purchase cost, maintenance and depreciation connected to the same records.</p>
              <dl className="mt-4 grid grid-cols-1 gap-2.5 text-sm">
                {[
                  ['Hardware', '$284,500', 100],
                  ['Replacement', '$91,200', 32],
                  ['Licensing', '$67,300', 24],
                  ['Maintenance', '$42,800', 15],
                ].map(([k, v, pct]) => (
                  <div key={k as string}>
                    <div className="flex items-baseline justify-between">
                      <dt className="text-[var(--color-content-muted)]">{k}</dt>
                      <dd className="font-semibold tabular-nums">{v}</dd>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]" aria-hidden="true">
                      <span className="block h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${pct}%`, opacity: 0.45 + (pct as number) / 180 }} />
                    </div>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex items-baseline justify-between border-t border-[var(--color-border)] pt-3 text-sm">
                <span className="font-semibold">Total</span>
                <span className="font-bold tabular-nums">$485,800</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 13 · AUDIT + 16 · NOTIFICATIONS ──────────────────────────── */}
      <section id="security" className={`${SECTION_ALT} scroll-mt-24`}>
        <div className={SECTION}>
          <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <Head
                kicker="Audit trail"
                title="Every important action leaves a record."
                body="Who did what, when, and what changed — kept in an append-only history that nobody can edit or delete. Accountability is structural, not a policy document."
              />
              <Reveal delay={140}>
                <ol className="mt-8 border-l-2 border-[var(--color-brand)]/25 pl-6 text-sm">
                  {[
                    ['14 Aug 2026 · 10:42', 'Asset assigned to Alex Morgan', 'by IT admin · status: In stock → In use'],
                    ['13 Aug 2026 · 16:04', 'Warranty updated from vendor', 'end date: — → 05 Apr 2026'],
                    ['10 Aug 2026 · 09:15', 'Location changed', 'Delhi office → Chandigarh office'],
                    ['05 Aug 2026 · 14:30', 'Maintenance completed', 'work order closed · cost recorded'],
                  ].map(([when, what, meta]) => (
                    <li key={when} className="relative pb-5 last:pb-0">
                      <span aria-hidden="true" className="absolute -left-[31px] top-1.5 size-2.5 rounded-full border-2 border-[var(--color-brand)] bg-[var(--color-background)]" />
                      <p className="font-mono text-xs text-[var(--color-content-subtle)]">{when}</p>
                      <p className="mt-0.5 font-semibold">{what}</p>
                      <p className="text-xs text-[var(--color-content-muted)]">{meta}</p>
                    </li>
                  ))}
                </ol>
              </Reveal>
            </div>
            <div>
              <Head
                kicker="Notifications"
                title="Know what needs attention."
                body="Expiring warranties, overdue returns, due maintenance and pending approvals surface themselves — in the app and by email — so the register works for you, not the other way round."
              />
              <Reveal delay={140} className="mt-8"><AlertsStrip /></Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* ── 14 · ROLES / PERMISSION MATRIX ───────────────────────────── */}
      <section id="administration" className={`${SECTION} scroll-mt-24`}>
        <Head
          kicker="Role-based access"
          title="Give everyone the right level of access."
          body="Fine-grained roles decide who sees costs, who approves, who maintains and what employees can view. The matrix below is a simplified view of the real permission system."
        />
        <Reveal delay={120}>
          <div className="mt-10 overflow-x-auto rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Simplified permission matrix by role</caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th scope="col" className="px-5 py-3.5 font-semibold">Capability</th>
                  {['Administrator', 'IT Manager', 'Technician', 'Dept. Manager', 'User'].map((r) => (
                    <th key={r} scope="col" className="px-4 py-3.5 text-center text-xs font-semibold">{r}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['View all assets', [1, 1, 1, 0, 0]],
                  ['View own equipment', [1, 1, 1, 1, 1]],
                  ['Assign & transfer', [1, 1, 1, 0, 0]],
                  ['Maintenance operations', [1, 1, 1, 0, 0]],
                  ['See costs & value', [1, 1, 0, 0, 0]],
                  ['Approve requests', [1, 1, 0, 1, 0]],
                  ['Reports & exports', [1, 1, 0, 1, 0]],
                  ['Platform administration', [1, 0, 0, 0, 0]],
                ].map(([cap, cells]) => (
                  <tr key={cap as string} className="border-b border-[var(--color-border)] last:border-0">
                    <th scope="row" className="px-5 py-3 text-left font-medium text-[var(--color-content-muted)]">{cap}</th>
                    {(cells as number[]).map((c, i) => (
                      <td key={i} className="px-4 py-3 text-center">
                        {c ? <Check aria-label="allowed" className="mx-auto size-4 text-[var(--tone-success-fg)]" /> : <Minus aria-label="not allowed" className="mx-auto size-4 text-[var(--color-content-subtle)]/50" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </section>

      {/* ── 15 · SEARCH ──────────────────────────────────────────────── */}
      <section className={`${SECTION_ALT} scroll-mt-24`}>
        <div className={SECTION}>
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <Head
              kicker="Search & filtering"
              title="Find the right asset in seconds."
              body="Global search across names, serials, tags and people, with filters for status, department, location, category, warranty and condition. Try it — the box on the right is live."
            />
            <Reveal delay={150}><SearchDemo /></Reveal>
          </div>
        </div>
      </section>

      {/* ── 17 · SECURITY & CONTROL ──────────────────────────────────── */}
      <section className={`${SECTION} scroll-mt-24`}>
        <Head
          kicker="Security & control"
          title="Built for controlled IT operations."
          body="Access, changes and visibility are governed by the permission system; sensitive actions land in the append-only audit log; financial figures are visible only to roles entitled to them. No claims here beyond what the product enforces."
        />
        <Reveal delay={120}>
          <ul className="mt-8 grid gap-x-10 gap-y-3 text-sm text-[var(--color-content-muted)] sm:grid-cols-2 lg:grid-cols-3">
            {['Role-based permissions', 'Append-only audit history', 'Controlled status transitions', 'Per-user accountability', 'Access management', 'Structured, validated records'].map((s) => (
              <li key={s} className="flex items-center gap-2.5"><ShieldCheck aria-hidden="true" className="size-4 flex-none text-[var(--color-brand)]" /> {s}</li>
            ))}
          </ul>
        </Reveal>
      </section>

      {/* ── 18 · INTEGRATIONS ────────────────────────────────────────── */}
      <section id="integrations" className={`${SECTION_ALT} scroll-mt-24`}>
        <div className={SECTION}>
          <Head
            kicker="Integrations"
            title="Connect PioAssets to your IT environment."
            body="Honest labels: what works today is marked available; everything else is direction, not promise."
          />
          <Reveal delay={120}>
            <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Excel / CSV import & export', 'Available'],
                ['REST API', 'Available'],
                ['Webhooks', 'Available'],
                ['Microsoft Entra ID sign-in', 'Available'],
                ['Windows discovery agent', 'Available'],
                ['Lenovo warranty lookup', 'Available'],
                ['Email / SMTP delivery', 'Available'],
                ['Dell warranty (TechDirect)', 'Integration ready'],
                ['RMM platforms', 'Coming soon'],
                ['Microsoft 365 inventory', 'Coming soon'],
                ['Directory sync', 'Coming soon'],
                ['PSA / accounting', 'Coming soon'],
              ].map(([name, state]) => (
                <div key={name} className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3.5">
                  <span className="min-w-0 text-sm font-medium">{name}</span>
                  <span className={`flex-none rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                    state === 'Available'
                      ? 'bg-[var(--color-tint-green)] text-[var(--color-tint-green-fg)]'
                      : state === 'Integration ready'
                        ? 'bg-[var(--color-tint-blue)] text-[var(--color-tint-blue-fg)]'
                        : 'bg-[var(--color-surface-sunken)] text-[var(--color-content-subtle)]'
                  }`}>{state}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 19 · AUTOMATION ──────────────────────────────────────────── */}
      <section id="automation" className={`${SECTION} scroll-mt-24`}>
        <Head
          kicker="Automation"
          title="Reduce repetitive asset administration."
          body="These run in the product today: request approvals route themselves through the right chain, warranty and maintenance sweeps raise alerts nightly, handover receipts chase themselves, supported vendors refresh warranty dates automatically, and scheduled reports land in inboxes on a cron."
        />
        <Reveal delay={120}>
          <div className="mt-10 flex flex-wrap items-center gap-2">
            {['Request raised', 'Approval routing', 'Assignment & receipt', 'Warranty reminder', 'Maintenance alert', 'Lifecycle update'].map((n, i, arr) => (
              <span key={n} className="flex items-center gap-2">
                <span className="flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm font-semibold shadow-sm">
                  <Workflow aria-hidden="true" className="size-4 text-[var(--color-brand)]" /> {n}
                </span>
                {i < arr.length - 1 ? <ArrowRight aria-hidden="true" className="size-4 text-[var(--color-brand)]/50" /> : null}
              </span>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── 20 · SUMMARY ─────────────────────────────────────────────── */}
      <section className={`${SECTION_ALT}`}>
        <div className={SECTION}>
          <Head kicker="Summary" title="The PioAssets capability checklist." />
          <Reveal delay={100}>
            <div className="mt-8 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
              <table className="w-full text-sm">
                <caption className="sr-only">PioAssets capability summary</caption>
                <tbody>
                  {[
                    ['Asset inventory', 'yes'], ['Asset assignment', 'yes'], ['Lifecycle tracking', 'yes'],
                    ['Warranty tracking', 'yes'], ['Maintenance history', 'yes'], ['QR / barcode', 'yes'],
                    ['Reporting & exports', 'yes'], ['Audit history', 'yes'], ['Role-based access', 'yes'],
                    ['Integrations', 'ready'],
                  ].map(([cap, state], i) => (
                    <tr key={cap} className={i % 2 ? 'bg-[var(--color-surface-sunken)]/50' : ''}>
                      <th scope="row" className="px-5 py-3 text-left font-medium">{cap}</th>
                      <td className="px-5 py-3 text-right">
                        {state === 'yes'
                          ? <Check aria-label="included" className="ml-auto size-4 text-[var(--tone-success-fg)]" />
                          : <span className="rounded-full bg-[var(--color-tint-blue)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--color-tint-blue-fg)]">Integration-ready</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 21 · FINAL CTA ───────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="rounded-3xl px-8 py-14 text-center shadow-xl sm:px-10" style={{ background: 'linear-gradient(130deg, #0052cc, #0040b0 55%, #001858)' }}>
          <h2 className="text-2xl font-bold tracking-tight text-balance text-white sm:text-3xl">
            See what PioAssets can do for your IT team.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-white/85">
            Explore how a connected asset lifecycle can give your team better visibility, stronger
            accountability and less manual administration.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/#demo" className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-[#0040b0] transition-colors hover:bg-[#e8f0ff]">
              Book a Demo <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            <Link href="/login" className="inline-flex h-12 items-center gap-2 rounded-full border border-white/40 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10">
              Get Started <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
          <a href="mailto:dalbeir@techpio.com" className="mt-6 inline-flex items-center gap-1.5 text-sm text-white/80 hover:text-white">
            <Mail aria-hidden="true" className="size-4" /> dalbeir@techpio.com
          </a>
        </div>
      </section>
    </>
  );
}
