/**
 * Shared hero banner backdrop (2026-08 "product, not document" redesign):
 * deep navy→brand-blue gradient, orange/violet/cyan glow orbs, a dot grid
 * fading downward, and a soft dark fade into the page below. Parent section
 * must be `relative overflow-hidden`; content sits in a `relative` sibling.
 */
export function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(135deg, #0a1633 0%, #10265c 38%, #0040b0 78%, #0052cc 100%)',
        }}
      />
      <div
        className="absolute -top-24 right-[8%] h-96 w-96 rounded-full opacity-30 blur-3xl"
        style={{ background: 'radial-gradient(circle, #f97316, transparent 65%)' }}
      />
      <div
        className="absolute -bottom-32 left-[-6%] h-[28rem] w-[28rem] rounded-full opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(circle, #8b5cf6, transparent 65%)' }}
      />
      <div
        className="absolute top-1/3 left-[30%] h-72 w-72 rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, #38bdf8, transparent 65%)' }}
      />
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.10) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
          maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.9), transparent 85%)',
          WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.9), transparent 85%)',
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-16"
        style={{ background: 'linear-gradient(to bottom, transparent, rgba(2,6,23,0.18))' }}
      />
    </div>
  );
}

/** Glassy kicker pill for use on the dark hero backdrop. */
export function HeroBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-sky-100 backdrop-blur">
      <span className="size-1.5 rounded-full bg-orange-400" aria-hidden="true" />
      {children}
    </span>
  );
}

/** Orange→amber gradient text for the highlighted phrase in a hero heading. */
export function HeroAccent({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="bg-clip-text text-transparent"
      style={{ backgroundImage: 'linear-gradient(90deg, #fb923c, #fbbf24 60%, #38bdf8 115%)' }}
    >
      {children}
    </span>
  );
}
