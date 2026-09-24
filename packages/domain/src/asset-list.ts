/**
 * The asset list, as both the web table and the phone read it.
 *
 * The web page built its query, its holder names and its empty-state wording
 * inline. The phone list then grew its own versions - a client-side search over
 * the first hundred assets and a holder name read from a field the API never
 * sends - so a company with more than a hundred assets, or with anyone holding
 * one, saw less on the phone than on the web. One set of rules, used by both,
 * keeps the two lists answering the same question the same way.
 *
 * Pure: no DOM, no URLSearchParams (React Native's is partial), no tokens. The
 * wording of each status pill lives in @techpioasset/ui-tokens, already shared.
 */

/** Columns the asset list can be ordered by, as the API names them. */
export const ASSET_LIST_SORT_FIELDS = [
  'name',
  'category',
  'status',
  'condition',
  'assignedUser',
  'purchaseCost',
] as const;
export type AssetListSortField = (typeof ASSET_LIST_SORT_FIELDS)[number];

/** The heading each sortable column carries on the web table. */
export const ASSET_LIST_SORT_LABELS: Readonly<Record<AssetListSortField, string>> = {
  name: 'Asset',
  category: 'Category',
  status: 'Status',
  condition: 'Condition',
  assignedUser: 'Assigned to',
  purchaseCost: 'Cost',
};

/**
 * The sorts a reader may be offered. Cost only for those who can read cost:
 * ordering by a hidden column still reveals which kit is dearest (the API falls
 * back to its default for anyone else, but they should never be offered it).
 */
export function assetListSortFields(canSeeCost: boolean): AssetListSortField[] {
  return ASSET_LIST_SORT_FIELDS.filter((f) => canSeeCost || f !== 'purchaseCost');
}

export interface AssetListFilters {
  q?: string;
  status?: string;
  lifecycle?: string;
  availability?: string;
  ownership?: string;
  /**
   * One control covering two filters: `sub:<id>` for a type (`sub:none` for
   * assets with no type set), `cat:<id>` for a whole category, '' for all.
   */
  type?: string;
  warrantyWithinDays?: string;
  vendorProductId?: string;
}

/**
 * The filters as query parameters, in a fixed order. Returned as pairs so each
 * app builds its own query string from it (`new URLSearchParams(pairs)` on the
 * web). Empty values are left out - the API rejects an empty enum.
 */
export function assetListFilterParams(f: AssetListFilters): [string, string][] {
  const p: [string, string][] = [];
  const type = f.type ?? '';
  if (f.q) p.push(['q', f.q]);
  if (f.status) p.push(['status', f.status]);
  if (f.lifecycle) p.push(['lifecycleState', f.lifecycle]);
  if (f.availability) p.push(['availabilityState', f.availability]);
  if (f.ownership) p.push(['ownershipType', f.ownership]);
  if (type.startsWith('sub:')) p.push(['subcategoryId', type.slice(4)]);
  if (type.startsWith('cat:')) p.push(['categoryId', type.slice(4)]);
  if (f.warrantyWithinDays) p.push(['warrantyWithinDays', f.warrantyWithinDays]);
  if (f.vendorProductId) p.push(['vendorProductId', f.vendorProductId]);
  return p;
}

/** Joins parameter pairs into a query string, encoding each part. */
export function toQueryString(pairs: readonly (readonly [string, string])[]): string {
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

/**
 * The type the list opens on: laptops, which is what people come to the list
 * for. A type's id is per company, so it is looked up in the company's own
 * catalogue. Null when the company has no "Laptop" type.
 */
export function defaultAssetTypeFilter(
  categories: readonly { subcategories: readonly { id: string; name: string }[] }[],
): string | null {
  const laptop = categories
    .flatMap((c) => c.subcategories)
    .find((sub) => sub.name.toLowerCase() === 'laptop');
  return laptop ? `sub:${laptop.id}` : null;
}

/** Who holds the asset, as the list's "Assigned to" column reads it. */
export function assetHolderName(
  holder:
    | { email?: string | null; profile: { firstName: string; lastName: string } | null }
    | null
    | undefined,
): string {
  return holder?.profile
    ? `${holder.profile.firstName} ${holder.profile.lastName}`
    : (holder?.email ?? '—');
}

/**
 * What an empty asset list says.
 *
 * v2.69: it told an administrator with the type filter on Laptop that "nothing
 * has been assigned to you yet" - true of nobody in that seat. `filtered` is
 * any filter beyond search and status (type, lifecycle, availability,
 * ownership), and only somebody who sees their own equipment alone (`ownScope`)
 * is told about assignment. Callers that pass neither read as they always did.
 */
export function assetListEmptyState(f: {
  q?: string;
  status?: string;
  filtered?: boolean;
  ownScope?: boolean;
}): {
  title: string;
  description: string;
} {
  const description =
    f.q || f.status
      ? 'Try clearing the search or status filter.'
      : f.filtered
        ? 'No assets match these filters. Try clearing one.'
        : f.ownScope === false
          ? 'No assets have been added yet.'
          : 'Nothing has been assigned to you yet.';
  return { title: 'No assets found', description };
}

/**
 * The filters carried on a link into the asset list (v2.87).
 *
 * The list built its filter state from empty strings and read only
 * `warrantyWithinDays` and `vendorProductId` off the URL. Every other filter -
 * status above all - was dropped on arrival, so the dashboard's "Available",
 * "Assigned", "Under repair" and "Damaged" tiles all opened the same
 * unfiltered list of every asset in the company. The link said one thing and
 * the page showed another, which is worse than not linking at all.
 *
 * `read` is the app's own way of reading one parameter: `params.get` on the
 * web, `useLocalSearchParams` on the phone. Kept here so both apps accept the
 * same set - a link that works in an email has to work in both.
 */
export function assetListFiltersFromLink(
  read: (key: string) => string | null | undefined,
): AssetListFilters {
  const value = (key: string) => (read(key) ?? '').trim();
  // One control, two parameters: a type wins over a whole category, because a
  // link naming both means the narrower of the two.
  const subcategoryId = value('subcategoryId');
  const categoryId = value('categoryId');
  const type = subcategoryId ? `sub:${subcategoryId}` : categoryId ? `cat:${categoryId}` : '';
  return {
    q: value('q'),
    status: value('status'),
    lifecycle: value('lifecycleState'),
    availability: value('availabilityState'),
    ownership: value('ownershipType'),
    type,
    warrantyWithinDays: value('warrantyWithinDays'),
    vendorProductId: value('vendorProductId'),
  };
}

/**
 * Whether a link named any filter at all.
 *
 * This decides one thing: the list opens on laptops by default, and a link
 * that names a set of assets must not have that default applied on top of it.
 * Clicking "Available: 166" and landing on 41 available laptops is the same
 * broken promise as landing on all assets, just harder to notice - so arriving
 * with any filter counts as a choice, and the default stands down.
 */
export function assetListArrivedFiltered(f: AssetListFilters): boolean {
  return Boolean(
    f.q ||
      f.status ||
      f.lifecycle ||
      f.availability ||
      f.ownership ||
      f.type ||
      f.warrantyWithinDays ||
      f.vendorProductId,
  );
}
