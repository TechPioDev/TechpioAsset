import { describe, expect, it } from 'vitest';
import {
  ASSET_LIST_SORT_FIELDS,
  ASSET_LIST_SORT_LABELS,
  assetHolderName,
  assetListEmptyState,
  assetListFilterParams,
  assetListSortFields,
  defaultAssetTypeFilter,
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
  it('points at the search or status when one is set', () => {
    expect(assetListEmptyState({ q: 'x' }).description).toBe(
      'Try clearing the search or status filter.',
    );
    expect(assetListEmptyState({ status: 'LOST' }).description).toBe(
      'Try clearing the search or status filter.',
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
