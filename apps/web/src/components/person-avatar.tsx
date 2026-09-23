'use client';

/**
 * A person's avatar, from their initials (v2.36).
 *
 * Deliberately NOT a stock photograph. A generic face attached to a named
 * employee is worse than no picture at all: it looks like a real photo of a
 * real person until you notice fifty people share it, and in a system whose
 * whole job is knowing who has what, a misleading likeness is a liability
 * rather than decoration.
 *
 * Initials on a colour derived from the name give the thing a stock photo was
 * wanted for - somewhere for the eye to land, and rows that are told apart at a
 * glance - while being true. The same person is the same colour on every
 * screen, every session, because the colour is computed from the name and not
 * stored anywhere.
 *
 * A real uploaded photo, where one exists, still wins. This is the fallback.
 */

/**
 * Palette chosen for legibility on both schemes rather than variety: every
 * entry carries white text at 4.5:1 or better, so the initials stay readable
 * whichever way the app is themed.
 */
const TONES = [
  '#0040b0',
  '#0e7490',
  '#0f766e',
  '#15803d',
  '#a16207',
  '#b45309',
  '#b91c1c',
  '#be185d',
  '#7e22ce',
  '#4338ca',
] as const;

/**
 * Stable hash of the name, so a person keeps their colour everywhere.
 * djb2 - small, deterministic, and good enough for picking one of ten buckets.
 */
function toneFor(seed: string): string {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 33) ^ seed.charCodeAt(i);
  return TONES[Math.abs(hash) % TONES.length]!;
}

export function personInitials(name: string | null | undefined, fallback?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (fallback ?? '').trim().slice(0, 1).toUpperCase() || '?';
}

export function PersonAvatar({
  name,
  email,
  size = 32,
  className = '',
}: {
  name: string | null | undefined;
  /** Used for the initial when there is no name on the record yet. */
  email?: string | null;
  size?: number;
  className?: string;
}) {
  const label = personInitials(name, email);
  // Seeded on the name where there is one, so two people called "Unknown" do
  // not silently share an identity through their email addresses.
  const tone = toneFor((name || email || '?').toLowerCase());

  return (
    <span
      aria-hidden="true"
      className={`inline-flex flex-none items-center justify-center rounded-full font-semibold text-white ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: tone,
        // Scales with the circle so it works at 24px in a table row and 64px on
        // a profile without a second set of classes.
        fontSize: Math.max(10, Math.round(size * 0.4)),
      }}
    >
      {label}
    </span>
  );
}
