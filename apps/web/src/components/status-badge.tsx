import type { Tone, StatusToken } from '@techpioasset/ui-tokens';
import { cn } from '@/lib/cn';
import { resolveIcon } from './icon-registry';

interface StatusBadgeProps {
  token: StatusToken;
  size?: 'sm' | 'md';
  showIcon?: boolean;
  className?: string;
  /**
   * Overrides the token's own wording, keeping its colour and icon (v2.26).
   *
   * A request's status is coarser than the step it is on - Inventory check and
   * Cost assessment are both OFFICE_ADMIN_REVIEW_PENDING - so the status label
   * named neither. Callers that know the live step pass it here; the tone still
   * comes from the status, because that is what decides how it should read.
   */
  label?: string;
}

function toneVars(tone: Tone): React.CSSProperties {
  return {
    color: `var(--tone-${tone}-fg)`,
    backgroundColor: `var(--tone-${tone}-bg)`,
    borderColor: `var(--tone-${tone}-border)`,
  };
}

/**
 * Status pill. Colour comes from CSS custom properties emitted by the shared
 * token package, so a badge looks identical in both themes and matches mobile.
 *
 * The label is always rendered as text - colour alone never carries the meaning,
 * which is WCAG 1.4.1 and part of the section 26 AA target.
 */
export function StatusBadge({
  token,
  size = 'md',
  showIcon = true,
  className,
  label,
}: StatusBadgeProps) {
  const Icon = showIcon ? resolveIcon(token.icon) : undefined;

  return (
    <span
      style={toneVars(token.tone)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className={size === 'sm' ? 'size-3' : 'size-3.5'} /> : null}
      {label ?? token.label}
    </span>
  );
}

/**
 * Badges that say the same thing, said once.
 *
 * An asset carries a status and two dimensions derived from it, so printing
 * all three verbatim gives "Assigned · Deployed · Assigned", or for a damaged
 * laptop in the shop "Damaged · In maintenance · In repair" - three words for
 * one situation, which reads as three problems. Pair it with
 * `assetStateToShow`, which decides WHICH dimensions still say something the
 * status does not; this removes what is left over.
 *
 * Lived in the asset detail page, which is why the asset LIST went on printing
 * three badges a row long after the detail page stopped.
 */
export function dedupeBadges(tokens: (StatusToken | null | undefined)[]): StatusToken[] {
  const seen = new Set<string>();
  return tokens.filter((t): t is StatusToken => {
    if (!t || seen.has(t.label)) return false;
    seen.add(t.label);
    return true;
  });
}
