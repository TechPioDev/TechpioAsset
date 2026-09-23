import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight,
  Bell,
  ClipboardCheck,
  FileSpreadsheet,
  LineChart,
  Recycle,
  RefreshCcw,
  ScanSearch,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { HeroAccent, HeroBackdrop, HeroBadge } from '@/components/marketing/hero-backdrop';
import { Reveal } from '@/components/marketing/motion';

export const metadata: Metadata = {
  title: 'How It Works',
  description:
    'From your first spreadsheet import to confident retirement: how PioAssets takes an IT asset through registration, assignment, tracking, maintenance, reporting and retirement.',
  openGraph: {
    title: 'How PioAssets Works | IT Asset Lifecycle in Five Steps',
    description:
      'Bring your data, assign and organize, track and maintain, analyze and control, retire with confidence.',
    url: 'https://pioassets.com/how-it-works',
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
  alternates: { canonical: 'https://pioassets.com/how-it-works' },
};

const STEPS: {
  n: string;
  Icon: LucideIcon;
  title: string;
  body: string;
  points: string[];
}[] = [
  {
    n: '01',
    Icon: FileSpreadsheet,
    title: 'Bring your data',
    body: 'Start from whatever you have today — no clean-up project required first.',
    points: [
      'Import assets and people from a spreadsheet in one pass.',
      'Register devices manually with serial, cost, vendor and warranty.',
      'Or let the Windows agent report machines in automatically.',
    ],
  },
  {
    n: '02',
    Icon: Users,
    title: 'Assign & organize',
    body: 'Connect every asset to the person, department and office responsible for it.',
    points: [
      'Hand equipment to employees with a confirmation step — custody is acknowledged, not assumed.',
      'Group by department, office and category so lists stay navigable.',
      'Employees see their own equipment; administrators see what their role allows.',
    ],
  },
  {
    n: '03',
    Icon: RefreshCcw,
    title: 'Track & maintain',
    body: 'The record stays current as the asset moves through its life.',
    points: [
      'QR labels make any device identifiable with a phone scan.',
      'Warranty dates tracked per asset — Lenovo machines fill theirs in automatically.',
      'Repairs, servicing, transfers and returns are logged against the asset, never lost.',
    ],
  },
  {
    n: '04',
    Icon: LineChart,
    title: 'Analyze & control',
    body: 'Turn the register into answers for IT, finance and management.',
    points: [
      'Dashboards for status, value, warranty exposure and upcoming needs.',
      'Reports export to CSV and Excel for whoever asks.',
      'Costs and financial figures visible only to roles entitled to them.',
    ],
  },
  {
    n: '05',
    Icon: Recycle,
    title: 'Retire with confidence',
    body: 'Assets leave the fleet without leaving the record.',
    points: [
      'Disposal, donation or replacement captured with date and reason.',
      'The full custody and service history stays queryable forever.',
      'Replacement planning feeds from age, condition and warranty data.',
    ],
  },
];

const AUTOMATIONS: { Icon: LucideIcon; text: string }[] = [
  { Icon: ShieldCheck, text: 'Lenovo warranty dates pulled straight from the manufacturer.' },
  { Icon: Bell, text: 'Warranty alerts at 90, 60, 30, 15 and 7 days — escalating as dates close in.' },
  { Icon: ClipboardCheck, text: 'Unconfirmed handovers and pending invitations chased automatically.' },
  { Icon: ScanSearch, text: 'Agent-reported machines kept fresh without anyone typing specs.' },
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

export default function HowItWorksPage() {
  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <HeroBackdrop />
        <div className="relative mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="max-w-2xl">
            <HeroBadge>How It Works</HeroBadge>
            <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance text-white sm:text-5xl">
              Simple to start. <HeroAccent>Powerful enough to scale.</HeroAccent>
            </h1>
            <p className="mt-5 text-lg text-white/80">
              Five steps take you from scattered spreadsheets to a live asset register that keeps
              itself current. Here is the whole journey.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/login"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-[#0040b0] shadow-lg shadow-blue-950/30 transition-all hover:bg-[#e8f0ff] hover:shadow-xl"
              >
                Get Started <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
              <Link
                href="/contact"
                className="inline-flex h-12 items-center rounded-full border border-white/35 px-6 text-sm font-semibold text-white transition-colors hover:border-white/70 hover:bg-white/10"
              >
                Talk to Us
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* THE FIVE STEPS */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <ol className="grid gap-6">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 80}>
              <li className="grid grid-cols-1 gap-5 rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 sm:p-8 md:grid-cols-[auto_1fr]">
                <div className="flex items-start gap-4 md:w-56">
                  <span className="grid size-12 flex-none place-items-center rounded-2xl bg-[var(--color-brand)] text-sm font-bold text-[var(--color-brand-contrast)] shadow-md">
                    {s.n}
                  </span>
                  <div className="md:pt-1">
                    <s.Icon aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
                    <h2 className="mt-1.5 text-lg font-bold">{s.title}</h2>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="text-[var(--color-content-muted)]">{s.body}</p>
                  <ul className="mt-3 grid gap-2">
                    {s.points.map((p) => (
                      <li key={p} className="flex items-start gap-2.5 text-sm leading-relaxed">
                        <span
                          aria-hidden="true"
                          className="mt-1.5 size-1.5 flex-none rounded-full bg-[var(--color-brand)]"
                        />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* WHAT RUNS ON ITS OWN */}
      <section className="border-y border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 md:grid-cols-[auto_1fr]">
          <Reveal>
            <Image
              src="/marketing/pio-portrait.jpg"
              alt="Pio, the PioAssets robot assistant"
              width={640}
              height={640}
              unoptimized
              className="mx-auto w-48 rounded-2xl shadow-lg md:w-56"
            />
          </Reveal>
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              And once it&apos;s set up, Pio takes the night shift.
            </h2>
            <p className="mt-2 text-[var(--color-content-muted)]">
              These run automatically — no one has to remember them.
            </p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {AUTOMATIONS.map((a) => (
                <li key={a.text} className="flex items-start gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm leading-relaxed">
                  <a.Icon aria-hidden="true" className="mt-0.5 size-4 flex-none text-[var(--color-brand)]" />
                  {a.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* THE LIFECYCLE */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <Reveal className="max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Every asset walks the same eight stages.
          </h2>
          <p className="mt-3 text-[var(--color-content-muted)]">
            A strict status flow means a device can never be in two states at once — and never
            disappears between them.
          </p>
        </Reveal>
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LIFECYCLE.map((st, i) => (
            <Reveal key={st.n} delay={i * 60}>
              <div className="h-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
                <p className="text-xs font-bold tracking-wide text-[var(--color-brand)]">{st.n}</p>
                <h3 className="mt-1.5 text-sm font-semibold">{st.label}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-content-muted)]">{st.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div
          className="grid grid-cols-1 items-center gap-6 overflow-hidden rounded-3xl px-8 py-12 shadow-xl sm:px-10 md:grid-cols-[1fr_auto]"
          style={{ background: 'linear-gradient(130deg, #0052cc, #0040b0 55%, #001858)' }}
        >
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-balance text-white sm:text-3xl">
              See it with your own equipment.
            </h2>
            <p className="mt-2 max-w-lg text-white/85">
              Bring one spreadsheet and we&apos;ll walk you through the whole journey on a call.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/#demo"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-[#0040b0] transition-colors hover:bg-[#e8f0ff]"
            >
              Book a Demo <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
