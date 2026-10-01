import { describe, expect, it } from 'vitest';
import {
  ASSET_LIST_SORT_FIELDS,
  ASSET_LIST_SORT_LABELS,
  assetHolderName,
  assetListEmptyState,
  assetListFilterParams,
  assetListSortFields,
  assetListSubtitle,
  defaultAssetTypeFilter,
  toQueryString,
  assetListFiltersFromLink,
  assetListArrivedFiltered,
  assetListFilterParams,
  toQueryString,
} from './asset-list';

describe('the asset list query', () => {
  it('sends nothing when nothing is chosen', () => {
    expect(assetListFilterParams({})).toEqual([]);
    expect(
      assetListFilterParams({ q: '', status: '', type: '', lifecycle: '', vendorProductId: '' }),
    ).toEqual([]);
  });

  it('names every filter as the API does, in a fixed order', () => {
    expect(
      assetListFilterParams({
        vendorProductId: 'vp1',
        warrantyWithinDays: '30',
        type: 'sub:t1',
        ownership: 'LEASED',
        availability: 'ASSIGNED',
        lifecycle: 'DEPLOYED',
        status: 'IN_USE',
        q: 'dell',
      }),
    ).toEqual([
      ['q', 'dell'],
      ['status', 'IN_USE'],
      ['lifecycleState', 'DEPLOYED'],
      ['availabilityState', 'ASSIGNED'],
      ['ownershipType', 'LEASED'],
      ['subcategoryId', 't1'],
      ['warrantyWithinDays', '30'],
      ['vendorProductId', 'vp1'],
    ]);
  });

  it('reads the type control as a type, a whole category, or no type set', () => {
    expect(assetListFilterParams({ type: 'sub:abc' })).toEqual([['subcategoryId', 'abc']]);
    expect(assetListFilterParams({ type: 'cat:xyz' })).toEqual([['categoryId', 'xyz']]);
    expect(assetListFilterParams({ type: 'sub:none' })).toEqual([['subcategoryId', 'none']]);
    expect(assetListFilterParams({ type: 'junk' })).toEqual([]);
  });

  it('builds the same string URLSearchParams would', () => {
    const pairs = assetListFilterParams({ q: 'a b&c', status: 'IN_USE' });
    expect(toQueryString(pairs)).toBe('q=a%20b%26c&status=IN_USE');
    expect(toQueryString([])).toBe('');
  });
});

describe('sorting the asset list', () => {
  it('offers every sortable column a heading', () => {
    for (const f of ASSET_LIST_SORT_FIELDS) expect(ASSET_LIST_SORT_LABELS[f]).toBeTruthy();
  });

  it('offers cost only to those who can read it', () => {
    expect(assetListSortFields(true)).toContain('purchaseCost');
    expect(assetListSortFields(false)).not.toContain('purchaseCost');
    expect(assetListSortFields(false)).toHaveLength(ASSET_LIST_SORT_FIELDS.length - 1);
  });
});

describe('the type the list opens on', () => {
  it('is the company’s own laptop type, matched regardless of case', () => {
    expect(
      defaultAssetTypeFilter([
        { subcategories: [{ id: 'm', name: 'Monitor' }] },
        { subcategories: [{ id: 'l', name: 'LAPTOP' }] },
      ]),
    ).toBe('sub:l');
  });

  it('is nothing when the company has no laptop type', () => {
    expect(defaultAssetTypeFilter([{ subcategories: [{ id: 'm', name: 'Monitor' }] }])).toBeNull();
    expect(defaultAssetTypeFilter([])).toBeNull();
  });
});

describe('who holds it', () => {
  it('reads the name, then the email, then a dash', () => {
    expect(
      assetHolderName({ email: 'a@x.com', profile: { firstName: 'Asha', lastName: 'Rao' } }),
    ).toBe('Asha Rao');
    expect(assetHolderName({ email: 'a@x.com', profile: null })).toBe('a@x.com');
    expect(assetHolderName(null)).toBe('—');
    expect(assetHolderName(undefined)).toBe('—');
  });
});

describe('an empty asset list', () => {
  it('talks about the filter that is set, whichever it is (v2.98)', () => {
    // It used to name "the search or status filter" for every case, which was
    // wrong the moment any other filter was the one narrowing the list.
    expect(assetListEmptyState({ q: 'x' }).description).toBe(
      'No assets match this filter. Remove it to see more.',
    );
    expect(assetListEmptyState({ status: 'LOST' }).description).toBe(
      'No assets match this filter. Remove it to see more.',
    );
  });

  it('otherwise says nothing has been assigned yet', () => {
    expect(assetListEmptyState({})).toEqual({
      title: 'No assets found',
      description: 'Nothing has been assigned to you yet.',
    });
  });
});

describe('an empty asset list, for somebody who sees the whole register (v2.69)', () => {
  it('blames the filters when there are some, not assignment', () => {
    expect(assetListEmptyState({ filtered: true, ownScope: false }).description).toBe(
      'No assets match these filters. Try clearing one.',
    );
  });

  it('says the register is empty when it is', () => {
    expect(assetListEmptyState({ ownScope: false }).description).toBe('No assets have been added yet.');
  });

  it('still tells somebody who sees only their own equipment about assignment', () => {
    expect(assetListEmptyState({ ownScope: true }).description).toBe(
      'Nothing has been assigned to you yet.',
    );
  });
});

describe('filters carried on a link into the asset list', () => {
  const link = (query: Record<string, string>) =>
    assetListFiltersFromLink((k) => query[k]);

  it('reads the status a dashboard tile names', () => {
    // The bug this exists for: every status tile opened the whole fleet.
    expect(link({ status: 'AVAILABLE' }).status).toBe('AVAILABLE');
    expect(link({ status: 'ASSIGNED' }).status).toBe('ASSIGNED');
    expect(link({ status: 'UNDER_REPAIR' }).status).toBe('UNDER_REPAIR');
    expect(link({ status: 'DAMAGED' }).status).toBe('DAMAGED');
  });

  it('reads every other filter the list can hold', () => {
    const f = link({
      q: 'dell',
      lifecycleState: 'IN_SERVICE',
      availabilityState: 'AVAILABLE',
      ownershipType: 'OWNED',
      warrantyWithinDays: '30',
      vendorProductId: 'vp1',
    });
    expect(f).toMatchObject({
      q: 'dell',
      lifecycle: 'IN_SERVICE',
      availability: 'AVAILABLE',
      ownership: 'OWNED',
      warrantyWithinDays: '30',
      vendorProductId: 'vp1',
    });
  });

  it('turns a type or a category into the one control that carries both', () => {
    expect(link({ subcategoryId: 'sub1' }).type).toBe('sub:sub1');
    expect(link({ categoryId: 'cat1' }).type).toBe('cat:cat1');
    // Both named: the narrower one wins.
    expect(link({ subcategoryId: 'sub1', categoryId: 'cat1' }).type).toBe('sub:sub1');
  });

  it('ignores blank and missing values rather than filtering on nothing', () => {
    // The API rejects an empty enum, so '' must never become a filter.
    const f = link({ status: '  ', lifecycleState: '' });
    expect(f.status).toBe('');
    expect(assetListFilterParams(f)).toEqual([]);
  });

  it('survives a round trip back out to a query string', () => {
    const f = link({ status: 'DAMAGED', subcategoryId: 'sub1' });
    expect(toQueryString(assetListFilterParams(f))).toBe('status=DAMAGED&subcategoryId=sub1');
  });
});

describe('whether a link named any filter', () => {
  it('is true for each one on its own', () => {
    const cases = [
      { status: 'AVAILABLE' },
      { q: 'dell' },
      { lifecycle: 'IN_SERVICE' },
      { availability: 'AVAILABLE' },
      { ownership: 'OWNED' },
      { type: 'sub:1' },
      { warrantyWithinDays: '30' },
      { vendorProductId: 'vp1' },
    ];
    for (const c of cases) expect(assetListArrivedFiltered(c), JSON.stringify(c)).toBe(true);
  });

  it('is false for a bare link', () => {
    expect(assetListArrivedFiltered({})).toBe(false);
    expect(assetListArrivedFiltered({ status: '', q: '' })).toBe(false);
  });
});

describe('the empty state names the filters that are actually applied (v2.98)', () => {
  it('no longer blames the search box when Type is the filter', () => {
    // The reported fault: Type=Laptop + Status=Available returned nothing and
    // the page said "Try clearing the search or status filter" - naming a
    // search box that was empty. Two filters were applied; it mentioned one.
    const e = assetListEmptyState({ filters: { type: 'sub:abc', status: 'AVAILABLE' } });
    expect(e.description).toContain('2 filters');
    expect(e.description).not.toContain('search filter');
    expect(e.description).not.toContain('status filter');
  });

  it('speaks in the singular for one filter', () => {
    const e = assetListEmptyState({ filters: { type: 'sub:abc' } });
    expect(e.description).toBe('No assets match this filter. Remove it to see more.');
  });

  it('counts every kind of filter, not just the two it used to know', () => {
    const e = assetListEmptyState({
      filters: { q: 'x', type: 'sub:a', status: 'AVAILABLE', warrantyWithinDays: '90' },
    });
    expect(e.description).toContain('4 filters');
  });

  it('says the fleet is empty when nothing is filtering', () => {
    expect(assetListEmptyState({ filters: {}, ownScope: false }).description).toBe(
      'No assets have been added yet.',
    );
  });

  it('still works for callers passing the old q/status shape', () => {
    // The phone has not been updated yet; it must not start lying.
    expect(assetListEmptyState({ q: 'thinkpad' }).description).toContain('this filter');
    expect(assetListEmptyState({}).description).toBe('Nothing has been assigned to you yet.');
  });
});

describe('the subtitle stops contradicting the page (v2.99)', () => {
  it('does not claim to show everything while a filter is on', () => {
    // The fault: "Everything you are permitted to see." above a Laptop
    // filter showing 50 of 169.
    const s = assetListSubtitle({ filterCount: 1, totalInScope: 169 });
    expect(s).not.toContain('Everything');
    expect(s).toContain('169');
  });

  it('still claims everything when nothing is filtering', () => {
    expect(assetListSubtitle({ filterCount: 0, totalInScope: 169 })).toBe(
      'Everything you are permitted to see - 169 assets.',
    );
  });

  it('works before the total has loaded', () => {
    // The count comes from a second request; the sentence must not read
    // "undefined assets" while it is in flight.
    expect(assetListSubtitle({ filterCount: 2 })).toBe(
      'Filtered view - not every asset is shown.',
    );
    expect(assetListSubtitle({ filterCount: 0 })).toBe('Everything you are permitted to see.');
  });

  it('an employee is told whose assets these are, filtered or not', () => {
    expect(assetListSubtitle({ filterCount: 0, ownScope: true })).toBe('Assets assigned to you.');
    expect(assetListSubtitle({ filterCount: 3, ownScope: true })).toBe('Assets assigned to you.');
  });

  it('groups thousands, because a fleet can be large', () => {
    expect(assetListSubtitle({ filterCount: 1, totalInScope: 6698 })).toContain('6,698');
  });
});
