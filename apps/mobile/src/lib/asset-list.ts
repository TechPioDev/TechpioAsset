import {
  ASSET_STATUS_TOKENS,
  AVAILABILITY_STATE_TOKENS,
  LIFECYCLE_STATE_TOKENS,
  OWNERSHIP_TYPE_TOKENS,
} from '@techpioasset/ui-tokens';
import {
  ASSET_LIST_SORT_LABELS,
  ASSET_STATUSES,
  AVAILABILITY_STATES,
  LIFECYCLE_STATES,
  OWNERSHIP_TYPES,
  type AssetListSortField,
  type AssetStatus,
  type AvailabilityState,
  type LifecycleState,
  type OwnershipType,
} from '@techpioasset/domain';

/**
 * The phone asset list's filter sheet (v2.x mobile parity).
 *
 * The query itself, the sort columns, the default type and the empty-state
 * wording come from @techpioasset/domain, shared with the web table. What is
 * here is only what a phone needs that a row of <select>s does not: the choices
 * as chips, and a one-line summary of what is switched on.
 */

export interface Category {
  id: string;
  name: string;
  subcategories: { id: string; name: string }[];
}

export interface SheetFilters {
  type: string;
  status: string;
  lifecycle: string;
  availability: string;
  ownership: string;
}

export const NO_FILTERS: SheetFilters = {
  type: '',
  status: '',
  lifecycle: '',
  availability: '',
  ownership: '',
};

export interface ChipOption {
  id: string;
  name: string;
}

/**
 * The type control's choices, as the web's dropdown offers them: assets with no
 * type, then each category as "All <category>" followed by its types. "All
 * types" is the picker's own none-choice, so it is not in this list.
 */
export function assetTypeOptions(categories: readonly Category[]): ChipOption[] {
  const out: ChipOption[] = [{ id: 'sub:none', name: 'No type set' }];
  for (const c of categories) {
    out.push({ id: `cat:${c.id}`, name: `All ${c.name}` });
    for (const sub of c.subcategories) out.push({ id: `sub:${sub.id}`, name: sub.name });
  }
  return out;
}

/**
 * The one-tap type chips above the list: every type, in the catalogue's own
 * order, using the same filter ids as the sheet so both stay in step. Category
 * "All <x>" rows are left to the sheet - on the list they would crowd out the
 * types people actually tap.
 */
export function quickTypeChips(categories: readonly Category[]): ChipOption[] {
  return categories.flatMap((c) => c.subcategories.map((sub) => ({ id: `sub:${sub.id}`, name: sub.name })));
}

export const STATUS_OPTIONS: ChipOption[] = ASSET_STATUSES.map((v) => ({
  id: v,
  name: ASSET_STATUS_TOKENS[v].label,
}));
export const LIFECYCLE_OPTIONS: ChipOption[] = LIFECYCLE_STATES.map((v) => ({
  id: v,
  name: LIFECYCLE_STATE_TOKENS[v].label,
}));
export const AVAILABILITY_OPTIONS: ChipOption[] = AVAILABILITY_STATES.map((v) => ({
  id: v,
  name: AVAILABILITY_STATE_TOKENS[v].label,
}));
export const OWNERSHIP_OPTIONS: ChipOption[] = OWNERSHIP_TYPES.map((v) => ({
  id: v,
  name: OWNERSHIP_TYPE_TOKENS[v].label,
}));

/**
 * What is switched on, one short label each, for the summary row under the
 * search. A type that is no longer in the catalogue still shows - as "Type" -
 * rather than silently filtering the list with nothing on screen to say so.
 */
export function activeFilterLabels(f: SheetFilters, categories: readonly Category[]): string[] {
  const out: string[] = [];
  if (f.type) {
    out.push(assetTypeOptions(categories).find((o) => o.id === f.type)?.name ?? 'Type');
  }
  if (f.status) out.push(ASSET_STATUS_TOKENS[f.status as AssetStatus]?.label ?? f.status);
  if (f.lifecycle) {
    out.push(LIFECYCLE_STATE_TOKENS[f.lifecycle as LifecycleState]?.label ?? f.lifecycle);
  }
  if (f.availability) {
    out.push(
      AVAILABILITY_STATE_TOKENS[f.availability as AvailabilityState]?.label ?? f.availability,
    );
  }
  if (f.ownership) {
    out.push(OWNERSHIP_TYPE_TOKENS[f.ownership as OwnershipType]?.label ?? f.ownership);
  }
  return out;
}

/** How the current order reads on the Sort button. Null sort is the API's own. */
export function sortSummary(sort: AssetListSortField | null, order: 'asc' | 'desc'): string {
  if (!sort) return 'Newest first';
  return `${ASSET_LIST_SORT_LABELS[sort]} ${order === 'asc' ? '↑' : '↓'}`;
}

/**
 * Whether another page is worth asking for. The mobile client drops the page
 * meta, so a full page is what says "there may be more".
 */
export function hasMorePages(received: number, pageSize: number): boolean {
  return received >= pageSize;
}

/** Appends a page, dropping rows already shown (a row can shift pages mid-scroll). */
export function mergePage<T extends { id: string }>(shown: readonly T[], next: readonly T[]): T[] {
  const seen = new Set(shown.map((r) => r.id));
  return [...shown, ...next.filter((r) => !seen.has(r.id))];
}
