import { Star } from 'lucide-react';
import { MAX_HEALTH, assetHealthSummary, type AssetHealth } from '@techpioasset/domain';

/**
 * How healthy a piece of equipment is, at a glance (v2.89).
 *
 * The score is derived, never stored - see `assetHealth` in the domain - so
 * this draws it and nothing more. Two things it is careful about:
 *
 * The stars are not the only signal. They carry the tone's colour AND the
 * count is written out for a screen reader, because five shapes in a row
 * differing only in fill is precisely the readout that fails somebody who
 * cannot see the difference.
 *
 * And it never appears without its reasons nearby. A number on its own is a
 * verdict nobody can question; the caller is expected to show `reasons` with
 * it, as the condition card does.
 */
export function HealthStars({
  health,
  size = 'sm',
}: {
  health: AssetHealth;
  size?: 'sm' | 'lg';
}) {
  const px = size === 'lg' ? 18 : 14;
  const colour = `var(--tone-${health.tone}-fg)`;
  return (
    <span
      className="inline-flex items-center gap-1 align-middle"
      title={assetHealthSummary(health)}
    >
      <span className="inline-flex items-center gap-0.5" aria-hidden="true">
        {Array.from({ length: MAX_HEALTH }, (_, i) => (
          <Star
            key={i}
            style={{ width: px, height: px, color: colour }}
            fill={i < health.stars ? colour : 'none'}
            strokeWidth={1.8}
          />
        ))}
      </span>
      <span
        className={size === 'lg' ? 'text-sm font-semibold' : 'text-xs font-semibold'}
        style={{ color: colour }}
      >
        {health.stars}/{MAX_HEALTH}
      </span>
      {/* The whole claim in words, for anyone not reading the shapes. */}
      <span className="sr-only">Condition score: {assetHealthSummary(health)}</span>
    </span>
  );
}
