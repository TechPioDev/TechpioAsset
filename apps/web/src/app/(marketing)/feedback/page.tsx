import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, MessageSquareHeart } from 'lucide-react';
import { HeroAccent, HeroBackdrop, HeroBadge } from '@/components/marketing/hero-backdrop';
import { Reveal } from '@/components/marketing/motion';

export const metadata: Metadata = {
  title: 'Client Feedback',
  description:
    'What teams say after replacing spreadsheets with PioAssets — early feedback from IT and operations managers, and how your feedback shapes the roadmap.',
  openGraph: {
    title: 'Client Feedback | PioAssets',
    description: 'What teams say about better asset visibility.',
    url: 'https://pioassets.com/feedback',
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
  alternates: { canonical: 'https://pioassets.com/feedback' },
};

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

const SHAPED = [
  'Automatic Lenovo warranty lookup came from an admin tired of typing serial numbers into vendor sites.',
  'The dynamic request form — where picking your own asset fills in the details — came from employee feedback.',
  '"Asset not in list" requests exist because people needed to ask for equipment nobody had catalogued yet.',
  'Duplicate-ticket prevention with a conversation thread came from admins triaging repeated requests.',
];

export default function FeedbackPage() {
  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <HeroBackdrop />
        <div className="relative mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="max-w-2xl">
            <HeroBadge>Client Feedback</HeroBadge>
            <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance text-white sm:text-5xl">
              What teams say about <HeroAccent>better asset visibility.</HeroAccent>
            </h1>
            <p className="mt-5 text-lg text-white/80">
              Early feedback from teams replacing spreadsheets with a single asset record — and the
              product decisions their feedback drove.
            </p>
          </div>
        </div>
      </section>

      {/* QUOTES */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="grid gap-4 md:grid-cols-3">
          {TESTIMONIALS.map((t, i) => (
            <Reveal key={t.role} delay={i * 100}>
              <figure className="flex h-full flex-col rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
                <svg
                  aria-hidden="true"
                  width="28"
                  height="22"
                  viewBox="0 0 28 22"
                  className="text-[var(--color-brand)] opacity-60"
                >
                  <path
                    d="M0 22 V11 C0 4.9 4.9 0 11 0 v5 c-3.3 0 -6 2.7 -6 6 h6 v11 Z M16 22 V11 C16 4.9 20.9 0 27 0 v5 c-3.3 0 -6 2.7 -6 6 h6 v11 Z"
                    fill="currentColor"
                  />
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
        <p className="mt-6 text-xs text-[var(--color-content-subtle)]">
          Quotes are from early adopters and shared with their roles anonymized.
        </p>
      </section>

      {/* FEEDBACK → ROADMAP */}
      <section className="border-y border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <Reveal className="max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Feedback here doesn&apos;t go into a folder. It ships.
            </h2>
            <p className="mt-3 text-[var(--color-content-muted)]">
              Some of the features users rely on today started as a complaint or a wish:
            </p>
          </Reveal>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {SHAPED.map((s, i) => (
              <Reveal key={s} delay={i * 80}>
                <li className="flex h-full items-start gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-sm leading-relaxed">
                  <MessageSquareHeart
                    aria-hidden="true"
                    className="mt-0.5 size-4 flex-none text-[var(--color-brand)]"
                  />
                  {s}
                </li>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div
          className="grid grid-cols-1 items-center gap-6 overflow-hidden rounded-3xl px-8 py-12 shadow-xl sm:px-10 md:grid-cols-[1fr_auto]"
          style={{ background: 'linear-gradient(130deg, #0052cc, #0040b0 55%, #001858)' }}
        >
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-balance text-white sm:text-3xl">
              Using PioAssets? Tell us what to build next.
            </h2>
            <p className="mt-2 max-w-lg text-white/85">
              Praise is nice; problems are better. Both reach the people who write the code.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/contact"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-[#0040b0] transition-colors hover:bg-[#e8f0ff]"
            >
              Share Feedback <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
