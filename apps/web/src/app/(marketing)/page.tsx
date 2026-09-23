import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Boxes,
  ClipboardCheck,
  Eye,
  FileClock,
  History,
  KeyRound,
  LineChart,
  Lock,
  QrCode,
  Recycle,
  RefreshCcw,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import { HeroAccent, HeroBackdrop, HeroBadge } from '@/components/marketing/hero-backdrop';
import { HeroLifecycleScene } from '@/components/marketing/hero-visual';
import { Reveal } from '@/components/marketing/motion';
import { AnalyticsShowcase, ProductShowcase } from '@/components/marketing/showcase';
import { DemoForm } from '@/components/marketing/demo-form';

export const metadata: Metadata = {
  title: { absolute: 'PioAssets | IT Asset Management & Lifecycle Tracking' },
  description:
    'PioAssets helps businesses discover, track, assign, maintain and manage IT assets throughout their complete lifecycle — from purchase to retirement.',
  keywords: [
    'IT Asset Management',
    'IT Asset Management Software',
    'IT Asset Tracking',
    'IT Inventory Management',
    'IT Asset Lifecycle Management',
    'Hardware Asset Management',
    'Software Asset Management',
    'IT Asset Tracking Software',
    'Warranty Management',
    'IT Inventory Software',
  ],
  openGraph: {
    title: 'PioAssets | IT Asset Management & Lifecycle Tracking',
    description:
      'Know every asset. Control every lifecycle. Discover, track, assign, maintain and retire IT assets in one platform.',
    url: 'https://pioassets.com',
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
  twitter: {
    card: 'summary_large_image',
    title: 'PioAssets | IT Asset Management & Lifecycle Tracking',
    description:
      'Know every asset. Control every lifecycle. Discover, track, assign, maintain and retire IT assets in one platform.',
    images: ['https://pioassets.com/marketing/og-card.jpg'],
  },
  alternates: { canonical: 'https://pioassets.com' },
};

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'PioAssets',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web, Android',
  description:
    'IT Asset Lifecycle Management platform: discover, register, track, assign, maintain, audit and retire IT assets.',
  url: 'https://pioassets.com',
  creator: { '@type': 'Organization', name: 'TechPIO Services LLP', email: 'dalbeir@techpio.com' },
};

/* ── shared bits ─────────────────────────────────────────────────────────── */

type Tint = 'blue' | 'green' | 'purple' | 'amber' | 'teal' | 'rose';
const TINT: Record<Tint, string> = {
  blue: 'bg-[var(--color-tint-blue)] text-[var(--color-tint-blue-fg)]',
  green: 'bg-[var(--color-tint-green)] text-[var(--color-tint-green-fg)]',
  purple: 'bg-[var(--color-tint-purple)] text-[var(--color-tint-purple-fg)]',
  amber: 'bg-[var(--color-tint-amber)] text-[var(--color-tint-amber-fg)]',
  teal: 'bg-[var(--color-tint-teal)] text-[var(--color-tint-teal-fg)]',
  rose: 'bg-[var(--color-tint-rose)] text-[var(--color-tint-rose-fg)]',
};

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-full bg-[var(--color-brand)]/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-brand)]">
      {children}
    </span>
  );
}

function SectionHead({
  kicker,
  title,
  body,
}: {
  kicker: string;
  title: string;
  body?: string;
}) {
  return (
    <Reveal className="max-w-2xl">
      <Kicker>{kicker}</Kicker>
      <h2 className="mt-4 text-2xl font-bold tracking-tight text-balance sm:text-3xl">{title}</h2>
      {body ? <p className="mt-3 text-[var(--color-content-muted)]">{body}</p> : null}
    </Reveal>
  );
}

/* ── content data ────────────────────────────────────────────────────────── */

const VALUE_STRIP: { Icon: LucideIcon; tint: Tint; title: string; body: string }[] = [
  { Icon: Eye, tint: 'blue', title: 'Complete visibility', body: 'Know where every asset is.' },
  { Icon: RefreshCcw, tint: 'green', title: 'Lifecycle control', body: 'Track every stage from purchase to retirement.' },
  { Icon: FileClock, tint: 'purple', title: 'Audit ready', body: 'Maintain a complete history of asset activity.' },
  { Icon: ClipboardCheck, tint: 'teal', title: 'Less manual work', body: 'Replace spreadsheets and disconnected records.' },
];

const FEATURES: { Icon: LucideIcon; tint: Tint; title: string; body: string }[] = [
  { Icon: ScanSearch, tint: 'blue', title: 'Asset Discovery', body: 'Discover and register assets across your environment automatically.' },
  { Icon: Boxes, tint: 'teal', title: 'Asset Inventory', body: 'Maintain accurate hardware, software, licence and equipment records.' },
  { Icon: Users, tint: 'green', title: 'Asset Assignment', body: 'Assign assets to employees, departments, locations and projects.' },
  { Icon: ShieldCheck, tint: 'purple', title: 'Warranty Management', body: 'Track warranty status and identify upcoming expirations before they lapse.' },
  { Icon: Wrench, tint: 'amber', title: 'Maintenance Management', body: 'Track repairs, service history, maintenance costs and downtime.' },
  { Icon: RefreshCcw, tint: 'blue', title: 'Lifecycle Management', body: 'Manage every asset from purchase through retirement with a strict status flow.' },
  { Icon: QrCode, tint: 'teal', title: 'QR & Barcode Tracking', body: 'Scan assets quickly using mobile devices — even offline.' },
  { Icon: LineChart, tint: 'green', title: 'Reports & Analytics', body: 'Understand asset value, spending, depreciation and upcoming requirements.' },
  { Icon: History, tint: 'rose', title: 'Audit Trail', body: 'Keep a complete, append-only history of important asset actions.' },
  { Icon: KeyRound, tint: 'purple', title: 'Role-Based Access', body: 'Control what administrators, technicians and users can see and do.' },
];

const LIFECYCLE = [
  { n: '01', label: 'Purchase', body: 'Cost, vendor and warranty captured at the start.' },
  { n: '02', label: 'Register', body: 'A permanent record with serial, QR label and specs.' },
  { n: '03', label: 'Assign', body: 'Handed to a person, team or location — receipt confirmed.' },
  { n: '04', label: 'Track', body: 'Location, condition and custody always current.' },
  { n: '05', label: 'Maintain', body: 'Repairs, servicing and downtime logged against the asset.' },
  { n: '06', label: 'Transfer / Return', body: 'Moves between people and offices, never off the record.' },
  { n: '07', label: 'Report', body: 'Value, spend and exposure visible to finance and IT.' },
  { n: '08', label: 'Retire', body: 'Disposal or replacement recorded with the full history kept.' },
];

const STEPS = [
  { n: '01', title: 'Bring your data', body: 'Import assets from a spreadsheet or discover them automatically.' },
  { n: '02', title: 'Assign & organize', body: 'Connect assets with employees, locations and departments.' },
  { n: '03', title: 'Track & maintain', body: 'Track ownership, condition, warranty, repairs and transfers.' },
  { n: '04', title: 'Analyze & control', body: 'Understand spending, asset value and upcoming requirements.' },
  { n: '05', title: 'Retire with confidence', body: 'Record disposal, replacement and retirement information.' },
];

const TESTIMONIALS = [
  {
    quote:
      'We finally have one reliable place to see where our equipment is, who has it, and what needs attention.',
    role: 'IT Manager',
    org: 'Technology services company',
  },
  {
    quote:
      'PioAssets helped us move away from spreadsheets and create a much clearer asset lifecycle process.',
    role: 'Operations Manager',
    org: 'Professional services firm',
  },
  {
    quote:
      'Warranty dates used to live in people’s heads. Now the system tells us what expires before it happens.',
    role: 'IT Administrator',
    org: 'Mid-size enterprise',
  },
];

const SECURITY = [
  { Icon: KeyRound, title: 'Role-based access', body: 'Fine-grained roles decide who can see costs, approve requests or change records.' },
  { Icon: History, title: 'Audit logging', body: 'Every important action is written to an append-only audit log.' },
  { Icon: Lock, title: 'Controlled permissions', body: 'Employees see their own equipment; administrators see what their role allows.' },
  { Icon: Eye, title: 'Data visibility rules', body: 'Financial figures are visible only to roles entitled to them.' },
  { Icon: FileClock, title: 'Activity history', body: 'Assignments, transfers and returns keep their full trail — nothing is rewritten.' },
  { Icon: ShieldCheck, title: 'Backup-ready architecture', body: 'Designed for scheduled backups and clean restores of your asset data.' },
];

/* ── page ────────────────────────────────────────────────────────────────── */

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <HeroBackdrop />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:py-20 md:grid-cols-2 md:gap-10 lg:py-24">
          <div>
            <HeroBadge>IT Asset Lifecycle Management</HeroBadge>
            <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance text-white sm:text-5xl lg:text-[3.5rem] lg:leading-[1.04]">
              Know Every Asset.
              <br />
              <HeroAccent>Control Every Lifecycle.</HeroAccent>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-white/80">
              PioAssets gives businesses complete visibility into their IT assets — from purchase
              and assignment to warranty, maintenance, transfers, reporting, and retirement.
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
                className="inline-flex h-12 items-center gap-2 rounded-full border border-white/35 px-6 text-sm font-semibold text-white transition-colors hover:border-white/70 hover:bg-white/10"
              >
                Book a Demo
              </Link>
            </div>
            <p className="mt-5 flex items-center gap-2 text-sm text-sky-100/80">
              <ShieldCheck aria-hidden="true" className="size-4 text-orange-300" />
              One platform for your complete IT asset lifecycle.
            </p>
          </div>
          <HeroLifecycleScene />
        </div>
      </section>

      {/* VALUE STRIP */}
      <section aria-label="Why PioAssets" className="border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
        <div className="mx-auto grid max-w-6xl gap-4 px-5 py-10 sm:grid-cols-2 lg:grid-cols-4">
          {VALUE_STRIP.map((v, i) => (
            <Reveal key={v.title} delay={i * 90}>
              <div className="flex items-start gap-3">
                <span className={`grid size-10 flex-none place-items-center rounded-xl ${TINT[v.tint]}`}>
                  <v.Icon aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{v.title}</p>
                  <p className="mt-0.5 text-sm text-[var(--color-content-muted)]">{v.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ABOUT */}
      <section id="about" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20">
        <div className="grid items-start gap-10 md:grid-cols-2 md:gap-14">
          <div>
            <SectionHead
              kicker="About PioAssets"
              title="Built for businesses that need control, not spreadsheets."
              body="PioAssets is an IT Asset Management platform created to help organizations maintain a single, accurate source of truth for their technology assets."
            />
            <Reveal delay={120}>
              <ul className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-[var(--color-content-muted)] sm:grid-cols-3">
                {['Hardware', 'Software', 'Licences', 'Users', 'Locations', 'Warranty', 'Maintenance', 'Transfers', 'Returns', 'Retirement', 'Costs', 'Audit history'].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[var(--color-brand)]" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
          <Reveal delay={150}>
            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-7 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                Created by TechPIO Services LLP
              </p>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-content-muted)]">
                PioAssets is built by TechPIO Services LLP, a team with hands-on experience running
                IT for real businesses — so the product reflects how equipment is actually bought,
                handed out, repaired and retired.
              </p>
              <ul className="mt-4 flex flex-wrap gap-2 text-xs">
                {['Managed IT Services', 'IT Infrastructure', 'Cybersecurity', 'RMM', 'Microsoft 365', 'Network Management', 'IT Automation'].map((s) => (
                  <li key={s} className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3 py-1.5 text-[var(--color-content-muted)]">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="scroll-mt-24 border-y border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionHead
            kicker="Core features"
            title="Everything you need to manage your IT assets."
            body="Purpose-built for the day-to-day of IT and operations teams — not a spreadsheet stretched past its limits."
          />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 5) * 70}>
                <div className="group h-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <span className={`grid size-11 place-items-center rounded-xl ${TINT[f.tint]} transition-transform group-hover:scale-105`}>
                    <f.Icon aria-hidden="true" className="size-5" />
                  </span>
                  <h3 className="mt-3.5 text-sm font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-content-muted)]">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* PRODUCT SHOWCASE */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <SectionHead
          kicker="The product"
          title="One platform. Complete asset visibility."
          body="The dashboard your IT team opens in the morning: what you own, where it is, and what needs attention."
        />
        <Reveal delay={120} className="mt-10">
          <ProductShowcase />
        </Reveal>
      </section>

      {/* LIFECYCLE */}
      <section className="border-y border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionHead
            kicker="Asset lifecycle"
            title="From purchase to retirement, every asset has a story."
            body="PioAssets keeps that story in one record — instead of letting it fragment across spreadsheets, inboxes and memory."
          />
          <ol className="relative mt-12 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {LIFECYCLE.map((s, i) => (
              <Reveal key={s.n} delay={i * 80}>
                <li className="relative h-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 flex-none place-items-center rounded-xl bg-[var(--color-brand)] text-xs font-bold text-[var(--color-brand-contrast)]">
                      {s.n}
                    </span>
                    <h3 className="text-sm font-semibold">{s.label}</h3>
                    {i < LIFECYCLE.length - 1 ? (
                      <ArrowRight aria-hidden="true" className="ml-auto size-4 text-[var(--color-content-subtle)]" />
                    ) : (
                      <Recycle aria-hidden="true" className="ml-auto size-4 text-[var(--tone-success-fg)]" />
                    )}
                  </div>
                  <p className="mt-2.5 text-xs leading-relaxed text-[var(--color-content-muted)]">{s.body}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* WARRANTY & MAINTENANCE */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <SectionHead
          kicker="Warranty & maintenance"
          title="Never let an asset's warranty expire unnoticed."
          body="Expiry windows, repair history and service costs live on the asset itself — and the system warns you while there is still time to act."
        />
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <Reveal>
            <WarrantyCard
              device="Dell Latitude 5540"
              serial="SN 8ZKQW04"
              status="Expires in 42 days"
              tone="amber"
              pct={62}
              rows={[['Next action', 'Renew or plan replacement'], ['Repairs', '1 · keyboard (under warranty)'], ['Service cost', '$0 to date']]}
            />
          </Reveal>
          <Reveal delay={100}>
            <WarrantyCard
              device="MacBook Pro 14″"
              serial="PIO-01241"
              status="Expires in 87 days"
              tone="green"
              pct={34}
              rows={[['Next action', 'No action needed'], ['Repairs', 'None recorded'], ['Provider', 'AppleCare']]}
            />
          </Reveal>
          <Reveal delay={200}>
            <WarrantyCard
              device="HP ProBook 450"
              serial="SN 5CD1345Y75"
              status="Warranty expired"
              tone="rose"
              pct={100}
              rows={[['Next action', 'Assess replacement'], ['Repairs', '2 · battery, hinge'], ['Service cost', '$140 out of cover']]}
              alert
            />
          </Reveal>
        </div>
      </section>

      {/* REPORTING */}
      <section className="border-y border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionHead
            kicker="Reporting & analytics"
            title="Turn your asset inventory into business intelligence."
            body="Value, spend, depreciation, warranty exposure and replacement forecasts — by department, location and category."
          />
          <Reveal delay={120} className="mt-10">
            <AnalyticsShowcase />
          </Reveal>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20">
        <SectionHead
          kicker="How it works"
          title="Simple to start. Powerful enough to scale."
        />
        <ol className="relative mt-12 grid gap-8 md:grid-cols-5">
          <div aria-hidden="true" className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-[var(--color-border-strong)] to-transparent md:block" />
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 90}>
              <li className="relative">
                <span className="relative z-10 grid size-12 place-items-center rounded-2xl bg-[var(--color-brand)] text-sm font-bold text-[var(--color-brand-contrast)] shadow-md">
                  {s.n}
                </span>
                <h3 className="mt-4 text-sm font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-content-muted)]">{s.body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* MEET PIO */}
      <section aria-label="Meet Pio" className="mx-auto max-w-6xl px-5 pb-20">
        <Reveal>
          <div className="grid grid-cols-1 items-center gap-0 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm md:grid-cols-[0.85fr_1.15fr]">
            <div className="relative min-w-0 p-6 sm:p-8">
              <Image
                src="/marketing/pio-portrait.jpg"
                alt="Pio, the PioAssets robot assistant, giving a thumbs-up while holding an asset checklist"
                width={640}
                height={640}
                unoptimized
                className="mx-auto w-full max-w-sm rounded-2xl"
              />
            </div>
            <div className="min-w-0 px-6 pb-10 sm:px-8 md:py-10 md:pr-10">
              <Kicker>Meet Pio</Kicker>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-balance sm:text-3xl">
                The assistant that never clocks out.
              </h2>
              <p className="mt-3 text-[var(--color-content-muted)]">
                Pio is the automation inside PioAssets. Every night it sweeps your entire asset
                register and acts before small things become tickets.
              </p>
              <ul className="mt-6 grid gap-4">
                {[
                  {
                    icon: RefreshCcw,
                    text: 'Pulls Lenovo warranty dates straight from the manufacturer — serial in, coverage out, nothing to type.',
                  },
                  {
                    icon: FileClock,
                    text: 'Watches every warranty and raises alerts at 90, 60, 30, 15 and 7 days — escalating as the date closes in.',
                  },
                  {
                    icon: ClipboardCheck,
                    text: 'Chases unconfirmed handovers and pending invitations with polite, staged reminders.',
                  },
                  {
                    icon: LineChart,
                    text: 'Delivers a daily summary of expiries, new assets and open requests to the people who need it.',
                  },
                ].map((item) => (
                  <li key={item.text} className="flex items-start gap-3">
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--color-brand)]/10 text-[var(--color-brand)]">
                      <item.icon aria-hidden="true" className="size-4" />
                    </span>
                    <span className="text-sm leading-relaxed text-[var(--color-content)]">{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </section>

      {/* TESTIMONIALS */}
      <section id="feedback" className="scroll-mt-24 border-y border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionHead
            kicker="Client feedback"
            title="What teams say about better asset visibility."
            body="Early feedback from teams replacing spreadsheets with a single asset record."
          />
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={t.role} delay={i * 100}>
                <figure className="flex h-full flex-col rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
                  <svg aria-hidden="true" width="28" height="22" viewBox="0 0 28 22" className="text-[var(--color-brand)] opacity-60">
                    <path d="M0 22 V11 C0 4.9 4.9 0 11 0 v5 c-3.3 0 -6 2.7 -6 6 h6 v11 Z M16 22 V11 C16 4.9 20.9 0 27 0 v5 c-3.3 0 -6 2.7 -6 6 h6 v11 Z" fill="currentColor" />
                  </svg>
                  <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-[var(--color-content)]">
                    {t.quote}
                  </blockquote>
                  <figcaption className="mt-5 border-t border-[var(--color-border)] pt-4 text-xs">
                    <p className="font-semibold">{t.role}</p>
                    <p className="mt-0.5 text-[var(--color-content-muted)]">{t.org}</p>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* SECURITY */}
      <section id="security" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20">
        <SectionHead
          kicker="Security & trust"
          title="Built with IT teams in mind."
          body="Access, visibility and history are controlled by design — no more, no less than each role should see."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SECURITY.map((s, i) => (
            <Reveal key={s.title} delay={(i % 3) * 90}>
              <div className="flex h-full items-start gap-3.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
                <span className="grid size-10 flex-none place-items-center rounded-xl bg-[var(--color-brand)]/10 text-[var(--color-brand)]">
                  <s.Icon aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold">{s.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--color-content-muted)]">{s.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* DEMO FORM */}
      <section id="demo" className="scroll-mt-24 border-t border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-start gap-10 px-5 py-20 md:grid-cols-[0.85fr_1.15fr]">
          <div className="md:sticky md:top-24">
            <SectionHead
              kicker="Get started"
              title="Let's get your assets under control."
              body="See how PioAssets can help your organization replace spreadsheets, improve visibility and manage the complete IT asset lifecycle."
            />
            <Reveal delay={150}>
              <ul className="mt-6 grid gap-2.5 text-sm text-[var(--color-content-muted)]">
                {['A walkthrough tailored to your asset count', 'Help importing your existing register', 'Answers on roles, audit and reporting'].map((li) => (
                  <li key={li} className="flex items-center gap-2.5">
                    <span className="grid size-5 flex-none place-items-center rounded-full bg-[var(--color-tint-green)] text-[var(--color-tint-green-fg)]">
                      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 5.5 l2.5 2.5 4.5 -5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                    {li}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
          <Reveal delay={100} className="relative">
            <DemoForm />
          </Reveal>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div
          className="grid grid-cols-1 overflow-hidden rounded-3xl shadow-xl md:grid-cols-[1.3fr_0.7fr]"
          style={{ background: 'linear-gradient(130deg, #0052cc, #0040b0 55%, #001858)' }}
        >
          <div className="px-8 py-12 sm:px-10">
            <h2 className="text-2xl font-bold tracking-tight text-balance text-white sm:text-3xl">
              Your IT assets shouldn&apos;t be a mystery.
            </h2>
            <p className="mt-3 max-w-lg text-white/85">
              Replace spreadsheets, scattered records and manual tracking with one intelligent
              asset management platform.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/login"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-[#0040b0] transition-colors hover:bg-[#e8f0ff]"
              >
                Get Started <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
              <Link
                href="/#demo"
                className="inline-flex h-12 items-center gap-2 rounded-full border border-white/40 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Book a Demo <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </div>
          <div className="grid place-items-center p-6">
            <Image
              src="/marketing/pio-portrait.jpg"
              alt="Pio, the PioAssets robot assistant"
              width={640}
              height={640}
              unoptimized
              className="w-full max-w-[260px] rounded-2xl shadow-lg"
            />
          </div>
        </div>
      </section>
    </>
  );
}

/* ── warranty card ───────────────────────────────────────────────────────── */

function WarrantyCard({
  device,
  serial,
  status,
  tone,
  pct,
  rows,
  alert = false,
}: {
  device: string;
  serial: string;
  status: string;
  tone: 'green' | 'amber' | 'rose';
  pct: number;
  rows: [string, string][];
  alert?: boolean;
}) {
  const toneMap = {
    green: { pill: TINT.green, bar: 'bg-[var(--tone-success-fg)]' },
    amber: { pill: TINT.amber, bar: 'bg-[var(--tone-warning-fg)]' },
    rose: { pill: TINT.rose, bar: 'bg-[var(--tone-critical-fg)]' },
  }[tone];
  return (
    <div className="relative h-full rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      {alert ? (
        <span className="mkt-ring absolute -top-1.5 -right-1.5 grid size-7 place-items-center rounded-full bg-[var(--tone-critical-fg)] text-white">
          <ShieldAlert className="size-4" aria-hidden="true" />
        </span>
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{device}</p>
          <p className="text-xs text-[var(--color-content-subtle)]">{serial}</p>
        </div>
        <span className={`flex-none rounded-full px-2.5 py-1 text-[11px] font-semibold ${toneMap.pill}`}>{status}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]" role="img" aria-label={`Warranty period ${pct}% elapsed`}>
        <span className={`block h-full rounded-full ${toneMap.bar}`} style={{ width: `${pct}%` }} />
      </div>
      <dl className="mt-4 grid gap-2 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <dt className="flex-none text-[var(--color-content-subtle)]">{k}</dt>
            <dd className="text-right font-medium text-[var(--color-content-muted)]">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
