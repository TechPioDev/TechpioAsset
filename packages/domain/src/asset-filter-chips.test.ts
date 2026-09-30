import { describe, expect, it } from 'vitest';
import { assetFilterChips, hasAssetFilters } from './asset-filter-chips';

const names = {
  status: (c: string) => ({ DAMAGED: 'Damaged', LOST: 'Lost', STOLEN: 'Stolen' })[c],
  type: (v: string) => (v === 'sub:abc' ? 'Laptop' : v === 'cat:it' ? 'IT assets' : undefined),
};

describe('nothing applied', () => {
  it('produces no chips', () => {
    expect(assetFilterChips({})).toEqual([]);
    expect(hasAssetFilters({})).toBe(false);
  });

  it('treats an empty string as not applied', () => {
    // The dropdowns use '' for "all", which is the absence of a filter.
    expect(assetFilterChips({ status: '', q: '', type: '' })).toEqual([]);
  });
});

describe('a filter that is set is always visible', () => {
  it('shows a search term in quotes', () => {
    expect(assetFilterChips({ q: 'thinkpad' })).toEqual([
      { key: 'q', label: 'Search', value: '"thinkpad"' },
    ]);
  });

  it('keeps a code it does not recognise, rather than dropping it', () => {
    // The whole point. A chip list that silently omits a filter recreates the
    // fault it exists to fix: the list is narrowed and nothing says why.
    const chips = assetFilterChips({ status: 'SOME_NEW_STATUS' }, names);
    expect(chips).toHaveLength(1);
    expect(chips[0]!.value).toBe('SOME_NEW_STATUS');
  });

  it('covers every filter the list supports', () => {
    const chips = assetFilterChips({
      q: 'x',
      type: 'sub:abc',
      status: 'DAMAGED',
      lifecycle: 'IN_SERVICE',
      availability: 'ASSIGNED',
      ownership: 'OWNED',
      warrantyWithinDays: '90',
      vendorProductId: 'vp1',
    }, names);
    expect(chips.map((c) => c.key)).toEqual([
      'q', 'type', 'status', 'lifecycle', 'availability', 'ownership',
      'warrantyWithinDays', 'vendorProductId',
    ]);
  });
});

describe('several values are one filter', () => {
  it('renders a multi-status filter as a single chip', () => {
    // It is removed as one thing, so it is shown as one thing. Three chips
    // would offer to clear a third of a filter that has no such state.
    const chips = assetFilterChips({ status: 'DAMAGED,LOST,STOLEN' }, names);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toEqual({ key: 'status', label: 'Status', value: 'Damaged, Lost or Stolen' });
  });

  it('reads naturally with two', () => {
    expect(assetFilterChips({ status: 'DAMAGED,LOST' }, names)[0]!.value).toBe('Damaged or Lost');
  });

  it('falls back per value, not all-or-nothing', () => {
    const v = assetFilterChips({ status: 'DAMAGED,WHAT' }, names)[0]!.value;
    expect(v).toBe('Damaged or WHAT');
  });
});

describe('reading the values', () => {
  it('names a type through the lookup', () => {
    expect(assetFilterChips({ type: 'sub:abc' }, names)[0]!.value).toBe('Laptop');
    expect(assetFilterChips({ type: 'cat:it' }, names)[0]!.value).toBe('IT assets');
  });

  it('spells out the warranty window', () => {
    expect(assetFilterChips({ warrantyWithinDays: '90' })[0]!.value).toBe('ending within 90 days');
  });
});

describe('order is fixed', () => {
  it('does not depend on the order the object was built in', () => {
    const a = assetFilterChips({ status: 'DAMAGED', q: 'x' }, names).map((c) => c.key);
    const b = assetFilterChips({ q: 'x', status: 'DAMAGED' }, names).map((c) => c.key);
    expect(a).toEqual(b);
    expect(a).toEqual(['q', 'status']);
  });
});

describe('hasAssetFilters', () => {
  it('is true as soon as anything narrows the list', () => {
    expect(hasAssetFilters({ ownership: 'LEASED' })).toBe(true);
  });
});
