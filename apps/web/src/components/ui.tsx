import { cloneElement, forwardRef, isValidElement, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button as ShadButton, type ButtonProps as ShadButtonProps } from '@/components/ui/button';
import { Input as ShadInput } from '@/components/ui/input';

/**
 * Shared primitives. Button and Input are now backed by shadcn/ui; this module
 * keeps the app's historical ergonomics (variant names, a `loading` prop, and a
 * two-size scale) so existing callers do not change, while the underlying
 * components are the shadcn ones.
 */

// The app's variant vocabulary mapped onto shadcn's.
const VARIANT_MAP = {
  primary: 'default',
  secondary: 'secondary',
  ghost: 'ghost',
  danger: 'destructive',
} as const;

export const Button = forwardRef<
  HTMLButtonElement,
  Omit<ShadButtonProps, 'variant' | 'size'> & {
    variant?: keyof typeof VARIANT_MAP;
    size?: 'sm' | 'md';
    loading?: boolean;
  }
>(function Button(
  { variant = 'primary', size = 'md', loading, disabled, children, ...props },
  ref,
) {
  return (
    <ShadButton
      ref={ref}
      variant={VARIANT_MAP[variant]}
      size={size === 'sm' ? 'sm' : 'default'}
      // Disabled while loading so a double-click cannot submit twice.
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
      {children}
    </ShadButton>
  );
});

/**
 * Button styling for a Link (v2.42).
 *
 * Button itself cannot take Radix's asChild: it always renders a loading slot
 * beside its children, so Slot receives two children and throws. Rather than
 * leave every caller to paste the same class string, the two looks live here.
 */
export const linkButtonCls = {
  primary:
    'inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-3 text-sm font-semibold text-[var(--color-brand-contrast)] hover:bg-[var(--color-brand-hover)]',
  secondary:
    'inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-surface-sunken)]',
} as const;

export const Input = ShadInput;

/**
 * The class string for a raw <input>/<textarea> in the app (v2.26).
 *
 * Not every control can be an <Input> - a <textarea>, a date field inside a
 * table row, a number cell in an order line. Those take this instead, so a
 * hand-rolled control still matches the components beside it.
 *
 * It replaces five copies that had drifted apart: four identical at h-9, and
 * one that had grown its own h-10 with a focus border of its own. So a raw
 * input was 4px shorter than the <Input> beside it, and one screen's fields
 * highlighted differently from every other screen's.
 *
 * h-10 and px-3 to match Input, so the two are interchangeable in a row.
 */
export const controlCls = [
  'h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)]',
  'bg-[var(--color-surface-raised)] px-3 text-sm',
  'placeholder:text-[var(--color-content-subtle)]',
  // No focus style here on purpose. globals.css carries one global
  // :focus-visible outline - "more reliable than remembering a focus style on
  // every interactive component" - and a local focus-visible:outline-none would
  // suppress it, leaving the control with no keyboard indicator at all.
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

/**
 * A plain <select>, styled once (v2.26).
 *
 * The same class string had been pasted into seventeen selects across five
 * screens, which is how they drifted, and nothing stopped a long option from
 * stretching its grid column. Consolidated so there is one place to change.
 *
 * Deliberately native rather than the Radix Select used on three other screens.
 * A native select gets keyboard type-ahead for free, and the pickers here run to
 * every colleague in the company - scrolling 150 names with no way to type at
 * them is the difference between usable and not.
 */
export const NativeSelect = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      // h-10 to match Input. They had been h-9 against a h-10 Input, so a
      // select sat 4px short of the field beside it - visible in every filter
      // bar (search box next to a dropdown) and in every two-column form row.
      'h-10 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 text-sm',
      // min-w-0 so a long option cannot push its grid column wider than the
      // track; without it one 40-character name reflows the whole row. Width
      // itself is the caller's to set - filter-bar selects size to their
      // content, and defaulting to w-full here would stretch every one of them.
      'min-w-0',
      // Focus comes from the global :focus-visible rule in globals.css; see
      // controlCls above for why nothing is set here.
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
NativeSelect.displayName = 'NativeSelect';

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;
  // aria-describedby and aria-invalid must sit on the control itself, not a
  // wrapper, or a screen reader will not announce the hint/error when the field
  // is focused. Inject them here so no caller has to remember (WCAG 3.3.1).
  const control =
    isValidElement(children) && describedBy
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          'aria-describedby': describedBy,
          ...(error ? { 'aria-invalid': true } : {}),
        })
      : children;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {control}
      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-[var(--color-content-subtle)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-[var(--tone-critical-fg)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-raised)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'critical' | 'info';
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-[var(--color-content-subtle)]">{label}</p>
      <p
        className="mt-1.5 text-2xl font-semibold tabular-nums"
        style={tone === 'neutral' ? undefined : { color: `var(--tone-${tone}-fg)` }}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-[var(--color-content-subtle)]">{hint}</p> : null}
    </Card>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded bg-[var(--color-surface-sunken)]', className)}
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center gap-2 px-6 py-16 text-center">
      <p className="font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-[var(--color-content-muted)]">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

export function ErrorState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div role="alert" className="grid place-items-center gap-2 px-6 py-16 text-center">
      <p className="font-medium text-[var(--tone-critical-fg)]">{title}</p>
      {detail ? (
        <p className="max-w-md text-sm text-[var(--color-content-muted)]">{detail}</p>
      ) : null}
    </div>
  );
}
