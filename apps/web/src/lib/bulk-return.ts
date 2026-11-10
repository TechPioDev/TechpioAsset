import type { BulkActionResult } from '@techpioasset/contracts';

/**
 * v3.24 - returning the selection from the Assets list.
 *
 * A leaver's kit used to come back one asset page at a time. The list already
 * had a selection and two bulk actions; this is the third. Only rows with a
 * holder can be returned, so the button counts those rather than the whole
 * selection - "Record return (3)" means three things will happen.
 */
export function returnableIds<T extends { id: string; assignedUser: unknown }>(
  rows: readonly T[],
  selected: ReadonlySet<string>,
): string[] {
  return rows
    .filter((r) => selected.has(r.id) && r.assignedUser !== null && r.assignedUser !== undefined)
    .map((r) => r.id);
}

/** What the toast says, in the same three registers as the other bulk actions. */
export function bulkReturnOutcome(
  result: BulkActionResult,
  statusLabel: string,
): { tone: 'success' | 'error' | 'info'; message: string } {
  const done = result.succeeded.length;
  const skipped = result.failed.length;
  const why = result.failed[0]?.reason;
  if (skipped === 0) {
    return {
      tone: 'success',
      message: `${done} asset${done === 1 ? '' : 's'} returned, now ${statusLabel}`,
    };
  }
  if (done === 0) {
    return {
      tone: 'error',
      message: `Nothing was returned.${why ? ` ${why}` : ''}${skipped > 1 ? ` (${skipped} assets)` : ''}`,
    };
  }
  return {
    tone: 'info',
    message: `${done} returned, now ${statusLabel}; ${skipped} skipped.${why ? ` ${why}` : ''}`,
  };
}
