import { HOLDER_LEFT_HINT, HOLDER_LEFT_TAG } from '@techpioasset/domain';

/**
 * v3.15 - beside the name of a holder whose account is deactivated. The name
 * stays, because the equipment is still recorded against them; this says why
 * they appear in no picker and what to do: return it or hand it over.
 */
export function LeftTag() {
  return (
    <span
      title={HOLDER_LEFT_HINT}
      className="ml-1.5 inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-1.5 py-px align-middle text-[10px] font-semibold uppercase tracking-wide text-[var(--color-content-muted)]"
    >
      {HOLDER_LEFT_TAG}
    </span>
  );
}
