import type { AssetListFilters } from './asset-list';

/**
 * Every filter currently applied, as something you can read and remove (v2.96).
 *
 * v2.91 made a filter arriving by link visible and clearable. This is the rest
 * of that idea: filters set by hand are just as invisible: five dropdowns sit
 * in the toolbar, three of them rarely used, and the only way to learn what is
 * applied is to read all five. People conclude the list is broken - the same
 * conclusion a filtered link produced before it was fixed.
 *
 * A chip is a claim about the list, so the rules are:
 *
 *   - A filter that is SET always produces a chip, even when its value is a
 *     code this build does not recognise. Falling back to the raw value keeps
 *     it removable; dropping it would recreate the original fault, a filter
 *     narrowing the list with nothing on screen to say so.
 *   - A multi-value filter is ONE chip, because it is one filter. "Damaged,
 *     Lost or Stolen" is a single thing to remove, and showing three chips
 *     would invite clearing one third of a filter that has no such state.
 *   - Order is fixed rather than insertion-ordered, so chips do not reshuffle
 *     under the cursor as filters change.
 */

export interface AssetFilterChip {
  /** Which filter this is, and therefore what clearing it clears. */
  key: keyof AssetListFilters;
  /** What it filters on: "Status", "Type". */
  label: string;
  /** What it is set to, in words. */
  value: string;
}

/** Turns stored codes into the words a reader knows them by. */
export interface AssetFilterNames {
  status?: (code: string) => string | undefined;
  type?: (value: string) => string | undefined;
  lifecycle?: (code: string) => string | undefined;
  availability?: (code: string) => string | undefined;
  ownership?: (code: string) => string | undefined;
  vendorProduct?: (id: string) => string | undefined;
}

/** Fixed display order, so chips never reshuffle as filters change. */
const ORDER: (keyof AssetListFilters)[] = [
  'q',
  'type',
  'status',
  'lifecycle',
  'availability',
  'ownership',
  'warrantyWithinDays',
  'vendorProductId',
];

const LABELS: Record<keyof AssetListFilters, string> = {
  q: 'Search',
  type: 'Type',
  status: 'Status',
  lifecycle: 'Lifecycle',
  availability: 'Availability',
  ownership: 'Ownership',
  warrantyWithinDays: 'Warranty',
  vendorProductId: 'Product',
};

/** "a", "b" and "c" - the list reads as one filter, because it is one. */
function joinWords(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`;
}

export function assetFilterChips(
  f: AssetListFilters,
  names: AssetFilterNames = {},
): AssetFilterChip[] {
  const chips: AssetFilterChip[] = [];

  for (const key of ORDER) {
    const raw = f[key];
    if (raw == null || raw === '') continue;

    let value: string;
    switch (key) {
      case 'q':
        value = `"${raw}"`;
        break;
      case 'status':
        // Several statuses are one filter. An unrecognised code keeps its raw
        // spelling rather than disappearing from a chip that claims to list
        // everything applied.
        value = joinWords(raw.split(',').map((s) => names.status?.(s) ?? s));
        break;
      case 'warrantyWithinDays':
        value = `ending within ${raw} days`;
        break;
      case 'type':
        value = names.type?.(raw) ?? raw;
        break;
      case 'vendorProductId':
        value = names.vendorProduct?.(raw) ?? raw;
        break;
      default:
        value = names[key]?.(raw) ?? raw;
    }

    chips.push({ key, label: LABELS[key], value });
  }

  return chips;
}

/** Whether anything is narrowing the list at all. */
export function hasAssetFilters(f: AssetListFilters): boolean {
  return assetFilterChips(f).length > 0;
}
