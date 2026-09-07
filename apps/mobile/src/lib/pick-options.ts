/**
 * Narrowing a long list of choices on a phone (v2.45).
 *
 * Outside the component so it can be proved without rendering one. The rule
 * that matters is the last one: the chosen option always survives the filter.
 * Without it, typing in the search box appears to clear a selection that is
 * still very much set, and the next tap silently changes it.
 */

/** Above this many options, chips become a wall and a filter is offered. */
export const FILTER_ABOVE = 12;
/** Enough to scan; past this the filter is what should narrow it. */
export const SHOW_AT_MOST = 30;

export interface PickOption {
  id: string;
  name: string;
}

export function shouldFilter(total: number): boolean {
  return total > FILTER_ABOVE;
}

export function filterOptions<T extends PickOption>(
  options: T[],
  query: string,
  selectedId: string,
): T[] {
  const needle = query.trim().toLowerCase();
  const matched = needle ? options.filter((o) => o.name.toLowerCase().includes(needle)) : options;
  const head = matched.slice(0, SHOW_AT_MOST);

  const chosen = options.find((o) => o.id === selectedId);
  return chosen && !head.some((o) => o.id === chosen.id) ? [chosen, ...head] : head;
}

/** How many are not on screen, for the "N more" hint. */
export function hiddenCount(total: number, shown: number): number {
  return Math.max(0, total - shown);
}
