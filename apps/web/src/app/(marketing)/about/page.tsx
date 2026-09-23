import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Mail } from 'lucide-react';
import { HeroAccent, HeroBackdrop, HeroBadge } from '@/components/marketing/hero-backdrop';
import { Reveal } from '@/components/marketing/motion';
import { AboutContactForm, AssetMap, AssetTree } from '@/components/marketing/about-visuals';

export const metadata: Metadata = {
  title: { absolute: 'About PioAssets | IT Asset Management Platform' },
  description:
    'Discover the story behind PioAssets, an IT asset management platform created by TechPIO Services LLP to bring clarity, accountability and lifecycle visibility to modern IT environments.',
  openGraph: {
    title: 'About PioAssets | IT Asset Management Platform',
    description:
      'The story, philosophy and people behind PioAssets — IT asset management built on practical operations experience.',
    url: 'https://pioassets.com/about',
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
  alternates: { canonical: 'https://pioassets.com/about' },
};

/**
 * About page (2026-08 redesign). Deliberately editorial where the homepage is
 * product marketing: story, belief, origin, direction. Few cards, oversized
 * type, asymmetric columns, and one recurring visual idea - an asset as a
 * record with meaning around it.
 */

const PHILOSOPHY = [
  {
    n: '01',
    title: 'Information should be clear',
    body: 'Important operational information should not require unnecessary effort to find or interpret. If answering "who has this laptop?" takes ten minutes, the system has already failed.',
  },
  {
    n: '02',
    title: 'Every asset has context',
    body: 'A record becomes valuable when it connects the device to its owner, location, history and lifecycle. A serial number alone tells you almost nothing worth knowing.',
  },
  {
    n: '03',
    title: 'Visibility should lead to action',
    body: 'Good asset information exists to drive decisions — what to renew, what to replace, what to investigate. Data that never changes a decision is just storage.',
  },
  {
    n: '04',
    title: 'Technology should reduce administrative work',
    body: 'Software should absorb the repetitive parts of asset management, not add a second job on top of it. Every workflow we build is measured against that.',
  },
  {
    n: '05',
    title: 'Products should grow with their users',
    body: 'PioAssets evolves alongside the needs of the teams who run it. What operators struggle with this month shapes what we build next.',
  },
];

const MINDSET = [
  ['Clarity', 'Complexity', 'Interfaces should make information easier to understand, not demonstrate how much of it exists.'],
  ['Context', 'Data', 'Records should explain the asset — its owner, history and obligations — not just list fields.'],
  ['Action', 'Administration', 'The product should surface what needs attention, so teams spend time deciding rather than searching.'],
  ['Consistency', 'Guesswork', 'One centralized record should end the era of three spreadsheets disagreeing with each other.'],
  ['Progress', 'Perfection', 'The platform improves continuously against real operational needs, not a theoretical ideal.'],
] as const;

const DIRECTION = [
  ['Now', 'A dependable asset record', 'Ownership, lifecycle, warranty, maintenance and audit history in one structured environment.'],
  ['Next', 'Deeper automation', 'More vendor integrations and automatic enrichment, so records maintain themselves where possible.'],
  ['Ahead', 'Decision support', 'Smarter replacement forecasting, spend intelligence and proactive alerts that arrive before problems do.'],
] as const;

export default function AboutPage() {
  return (
    <>
      {/* ── 1 · HERO ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <HeroBackdrop />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 py-20 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:py-28">
          <div>
            <HeroBadge>About PioAssets</HeroBadge>
            <h1 className="mt-6 text-4xl font-bold leading-[1.06] tracking-tight text-balance text-white sm:text-5xl lg:text-[3.6rem]">
              Built around a simple belief: IT should be easier to{' '}
              <HeroAccent>account for.</HeroAccent>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-white/80">
              PioAssets was created with a straightforward idea: businesses should be able to trust
              the information they have about their technology.
            </p>
            <p className="mt-4 max-w-xl leading-relaxed text-white/70">
              As IT environments grow, knowing what exists, where it is, who is responsible for it
              and what happens to it over time becomes increasingly important.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link
                href="/"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-[#0040b0] shadow-lg shadow-blue-950/30 transition-all hover:bg-[#e8f0ff] hover:shadow-xl"
              >
                Meet the Product <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
              <Link
                href="#conversation"
                className="text-sm font-semibold text-sky-100 underline-offset-4 transition-colors hover:text-white hover:underline"
              >
                Talk to Us
              </Link>
            </div>
          </div>
          <Reveal>
            <AssetMap />
          </Reveal>
        </div>
      </section>

      {/* ── 2 · OUR STORY ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-24">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--color-brand)]">
            Our story
          </p>
          <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">Why we started PioAssets</h2>
        </Reveal>
        <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
          <Reveal delay={100}>
            <p className="text-3xl font-bold leading-snug tracking-tight text-balance sm:text-4xl">
              The challenge was never just tracking devices.{' '}
              <span className="text-[var(--color-brand)]">It was understanding them.</span>
            </p>
          </Reveal>
          <Reveal delay={200}>
            <div className="border-l-2 border-[var(--color-brand)]/25 pl-8 text-[17px] leading-relaxed text-[var(--color-content-muted)]">
              <p>
                Managing technology is rarely difficult because of the devices themselves. The
                difficulty is keeping the information around them accurate.
              </p>
              <p className="mt-5">
                Over time, that information drifts apart — a purchase in one file, a repair in an
                email thread, an owner in someone&apos;s memory. Each gap is small. Together, they
                are why equipment goes missing, warranties lapse quietly, and budgets get built on
                guesses.
              </p>
              <p className="mt-5">
                PioAssets was created to bring that information into one structured environment: a
                record a business can act on, not just a list it maintains.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 3 · THE IDEA ──────────────────────────────────────────────── */}
      <section className="border-y border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-24 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <div className="max-w-md">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--color-brand)]">
                The idea
              </p>
              <h2 className="mt-4 text-2xl font-bold tracking-tight text-balance sm:text-3xl">
                An asset carries more information than its serial number.
              </h2>
              <p className="mt-5 leading-relaxed text-[var(--color-content-muted)]">
                A laptop on a desk is also a responsibility, a cost, a service history and a
                decision waiting to be made. PioAssets treats each of those as part of the same
                record — because separately, none of them tells the whole story.
              </p>
            </div>
          </Reveal>
          <Reveal delay={150}>
            <AssetTree />
          </Reveal>
        </div>
      </section>

      {/* ── 4 · PHILOSOPHY ────────────────────────────────────────────── */}
      <section className="mx-auto max-w-4xl px-5 py-24">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--color-brand)]">
            Our philosophy
          </p>
          <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">What we believe</h2>
        </Reveal>
        <div className="mt-6">
          {PHILOSOPHY.map((p, i) => (
            <Reveal key={p.n} delay={i * 60}>
              <div className="grid gap-4 border-b border-[var(--color-border)] py-10 sm:grid-cols-[110px_1fr] sm:gap-8">
                <span aria-hidden="true" className="text-5xl font-bold tracking-tight text-[var(--color-brand)]/25 sm:text-6xl">
                  {p.n}
                </span>
                <div>
                  <h3 className="text-xl font-semibold tracking-tight">{p.title}</h3>
                  <p className="mt-2.5 max-w-2xl leading-relaxed text-[var(--color-content-muted)]">{p.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── 5 · APPROACH ──────────────────────────────────────────────── */}
      <section className="border-y border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <Reveal className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--color-brand)]">
              Our approach
            </p>
            <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">Practical by design</h2>
            <p className="mt-5 leading-relaxed text-[var(--color-content-muted)]">
              PioAssets is designed around practical IT operations rather than theory. The platform
              focuses on the information and workflows teams encounter every day — ownership,
              location, lifecycle events, maintenance, warranty, cost and accountability — without
              turning asset management into another complicated administrative system.
            </p>
          </Reveal>
          <Reveal delay={150}>
            <ol className="mt-14 grid gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
              {['Real IT environment', 'Structured information', 'Better visibility', 'Better decisions'].map((step, i) => (
                <li key={step} className="relative pr-8">
                  {i < 3 ? (
                    <ArrowRight aria-hidden="true" className="absolute right-2 top-1 hidden size-5 text-[var(--color-brand)]/50 lg:block" />
                  ) : null}
                  <p className="font-mono text-xs text-[var(--color-content-subtle)]">{String(i + 1).padStart(2, '0')}</p>
                  <p className="mt-2 text-lg font-semibold tracking-tight">{step}</p>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </section>

      {/* ── 6 · WHAT WE ARE BUILDING ──────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-24">
        <Reveal className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--color-brand)]">
            What we are building
          </p>
          <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">More than an inventory</h2>
          <p className="mt-5 leading-relaxed text-[var(--color-content-muted)]">
            An inventory tells you what you have. A well-managed asset environment helps you
            understand what those assets mean to the business — what they cost, what they need, and
            what should happen to them next. That is the direction PioAssets is heading.
          </p>
        </Reveal>
        <div className="relative mt-14">
          <div aria-hidden="true" className="absolute left-2 top-3 bottom-3 w-px bg-[var(--color-border-strong)] md:left-0 md:right-0 md:top-2.5 md:bottom-auto md:h-px md:w-auto" />
          <ol className="grid gap-10 md:grid-cols-3 md:gap-8">
            {DIRECTION.map(([era, title, body], i) => (
              <Reveal key={era} delay={i * 120}>
                <li className="relative pl-8 md:pl-0 md:pt-8">
                  <span aria-hidden="true" className="absolute left-0 top-1 size-4 rounded-full border-2 border-[var(--color-brand)] bg-[var(--color-background)] md:left-0 md:top-0" />
                  <p className="font-mono text-xs font-semibold uppercase tracking-widest text-[var(--color-brand)]">{era}</p>
                  <h3 className="mt-2 text-lg font-semibold tracking-tight">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--color-content-muted)]">{body}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
        <Reveal delay={200}>
          <p className="mt-10 max-w-2xl text-sm text-[var(--color-content-subtle)]">
            Direction, not promises: items beyond &ldquo;Now&rdquo; describe where development is
            headed, shaped by the teams already using the platform.
          </p>
        </Reveal>
      </section>

      {/* ── 7 · TECHPIO ───────────────────────────────────────────────── */}
      <section className="border-y border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-24 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--color-brand)]">
              The company
            </p>
            <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
              Created by TechPIO Services LLP
            </h2>
            <p className="mt-5 leading-relaxed text-[var(--color-content-muted)]">
              PioAssets is created by TechPIO Services LLP, a technology company focused on
              practical IT services, infrastructure and operational solutions.
            </p>
            <p className="mt-4 leading-relaxed text-[var(--color-content-muted)]">
              Years of running real IT environments shaped how we think about asset management:
              systems should be useful, understandable and designed around the people who operate
              them — because we are those people too.
            </p>
          </Reveal>
          <Reveal delay={150}>
            <div className="border-l-2 border-[var(--color-brand)]/25 pl-8">
              <p className="font-semibold">TechPIO Services LLP</p>
              <p className="mt-1 text-sm text-[var(--color-content-subtle)]">Powered by IT experience</p>
              <ul className="mt-5 grid gap-2 text-sm text-[var(--color-content-muted)]">
                {['Managed IT Services', 'IT Infrastructure', 'Network Management', 'Cybersecurity', 'RMM & Automation', 'Microsoft 365', 'Technical Operations'].map((s) => (
                  <li key={s} className="flex items-center gap-2.5">
                    <span aria-hidden="true" className="size-1 rounded-full bg-[var(--color-brand)]" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 8 · PRODUCT MINDSET ───────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-24">
        <Reveal className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--color-brand)]">
            Product mindset
          </p>
          <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">Built with operators in mind</h2>
        </Reveal>
        <dl className="mt-12 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {MINDSET.map(([over, under, body], i) => (
            <Reveal key={over} delay={(i % 3) * 90}>
              <div className="border-t-2 border-[var(--color-brand)]/30 pt-4">
                <dt className="text-lg font-bold tracking-tight">
                  {over} <span className="font-normal text-[var(--color-content-subtle)]">over</span> {under}
                </dt>
                <dd className="mt-2 text-sm leading-relaxed text-[var(--color-content-muted)]">{body}</dd>
              </div>
            </Reveal>
          ))}
        </dl>
      </section>

      {/* ── 9 · WHO FOR + 10 · TRUST ──────────────────────────────────── */}
      <section className="border-y border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
        <div className="mx-auto max-w-4xl px-5 py-24 text-center">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--color-brand)]">
              Who it&apos;s for
            </p>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-balance sm:text-3xl">
              Built for the people behind the technology
            </h2>
            <p className="mx-auto mt-5 max-w-2xl leading-relaxed text-[var(--color-content-muted)]">
              PioAssets is intended for the people responsible for keeping technology organized,
              available and accountable — IT administrators and MSPs first, and just as much the
              operations teams, finance teams, business owners and technology leaders who depend on
              the same answers.
            </p>
          </Reveal>
          <Reveal delay={150}>
            <div className="mx-auto mt-14 max-w-xl border-t border-[var(--color-border)] pt-12">
              <h2 className="text-xl font-bold tracking-tight">
                Trust starts with information you can rely on.
              </h2>
              <p className="mt-4 leading-relaxed text-[var(--color-content-muted)]">
                Asset management is ultimately about confidence — confidence that the information
                is accurate, accessible and useful when a decision needs to be made.
              </p>
              <p className="mt-8 flex flex-wrap items-center justify-center gap-3 font-mono text-sm font-semibold tracking-wide">
                <span>Information</span>
                <ArrowRight aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
                <span>Confidence</span>
                <ArrowRight aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
                <span className="text-[var(--color-brand)]">Control</span>
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 11 · CONVERSATION ─────────────────────────────────────────── */}
      <section id="conversation" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-24">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--color-brand)]">
              Get in touch
            </p>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-balance sm:text-3xl">
              Have an asset management challenge?
            </h2>
            <p className="mt-5 leading-relaxed text-[var(--color-content-muted)]">
              Tell us what you&apos;re trying to improve. We&apos;d like to understand your
              environment, your process and where PioAssets could fit.
            </p>
            <a
              href="mailto:dalbeir@techpio.com"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-brand)] hover:underline"
            >
              <Mail aria-hidden="true" className="size-4" /> dalbeir@techpio.com
            </a>
          </Reveal>
          <Reveal delay={120} className="relative">
            <AboutContactForm />
          </Reveal>
        </div>
      </section>

      {/* ── 12 · FINAL STATEMENT ──────────────────────────────────────── */}
      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-4xl px-5 py-24 text-center sm:py-28">
          <Reveal>
            <p className="text-3xl font-bold leading-tight tracking-tight text-balance sm:text-5xl">
              Know what you own.
              <br />
              <span className="text-[var(--color-brand)]">Understand what happens next.</span>
            </p>
            <p className="mt-6 text-sm text-[var(--color-content-subtle)]">
              PioAssets — IT Asset Management by TechPIO Services LLP
            </p>
            <Link
              href="/"
              className="mt-9 inline-flex h-12 items-center gap-2 rounded-full bg-[var(--color-brand)] px-7 text-sm font-semibold text-[var(--color-brand-contrast)] transition-colors hover:bg-[var(--color-brand-hover)]"
            >
              Explore PioAssets <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </Reveal>
        </div>
      </section>
    </>
  );
}
