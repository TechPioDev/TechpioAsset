import { describe, expect, it } from 'vitest';
import {
  AVAILABILITY_OPTIONS,
  LIFECYCLE_OPTIONS,
  NO_FILTERS,
  OWNERSHIP_OPTIONS,
  STATUS_OPTIONS,
  activeFilterLabels,
  assetTypeOptions,
  hasMorePages,
  mergePage,
  quickTypeChips,
  sortSummary,
} from './asset-list';

const categories = [
  {
    id: 'it',
    name: 'IT Assets',
    subcategories: [
      { id: 'lap', name: 'Laptop' },
      { id: 'mon', name: 'Monitor' },
    ],
  },
];

describe('the type chips', () => {
  it('offer no-type, each whole category, then its types - as the web dropdown does', () => {
    expect(assetTypeOptions(categories)).toEqual([
      { id: 'sub:none', name: 'No type set' },
      { id: 'cat:it', name: 'All IT Assets' },
      { id: 'sub:lap', name: 'Laptop' },
      { id: 'sub:mon', name: 'Monitor' },
    ]);
  });
});

describe('the dimension chips', () => {
  it('use the shared labels', () => {
    expect(STATUS_OPTIONS.find((o) => o.id === 'IN_USE')?.name).toBe('In use');
    expect(LIFECYCLE_OPTIONS.find((o) => o.id === 'DEPLOYED')?.name).toBe('Deployed');
    expect(AVAILABILITY_OPTIONS.find((o) => o.id === 'ASSIGNED')?.name).toBe('Assigned');
    expect(OWNERSHIP_OPTIONS.map((o) => o.id)).toContain('LEASED');
  });
});

describe('the active-filter summary', () => {
  it('is empty with nothing on', () => {
    expect(activeFilterLabels(NO_FILTERS, categories)).toEqual([]);
  });

  it('names each filter that is on', () => {
    expect(
      activeFilterLabels(
        {
          type: 'sub:lap',
          status: 'IN_USE',
          lifecycle: 'DEPLOYED',
          availability: 'ASSIGNED',
          ownership: 'OWNED',
        },
        categories,
      ),
    ).toEqual(['Laptop', 'In use', 'Deployed', 'Assigned', 'Owned']);
  });

  it('still says a type is on when the catalogue has not arrived', () => {
    expect(activeFilterLabels({ ...NO_FILTERS, type: 'sub:gone' }, [])).toEqual(['Type']);
  });
});

describe('sorting and paging', () => {
  it('reads the order on the button', () => {
    expect(sortSummary(null, 'asc')).toBe('Newest first');
    expect(sortSummary('assignedUser', 'asc')).toBe('Assigned to ↑');
    expect(sortSummary('purchaseCost', 'desc')).toBe('Cost ↓');
  });

  it('asks for more only after a full page', () => {
    expect(hasMorePages(25, 25)).toBe(true);
    expect(hasMorePages(24, 25)).toBe(false);
    expect(hasMorePages(0, 25)).toBe(false);
  });

  it('does not repeat a row that moved between pages', () => {
    expect(mergePage([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }])).toEqual([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);
  });
});

describe('one-tap type chips', () => {
  it('offers every type in catalogue order, with the same ids the filter sheet uses', () => {
    const catalogue = [
      { id: 'it', name: 'IT Assets', subcategories: [{ id: 'l', name: 'Laptop' }, { id: 'm', name: 'Mouse' }] },
      { id: 'f', name: 'Furniture', subcategories: [] },
      { id: 'o', name: 'Office', subcategories: [{ id: 'p', name: 'Printer' }] },
    ];
    const chips = quickTypeChips(catalogue);
    expect(chips).toEqual([
      { id: 'sub:l', name: 'Laptop' },
      { id: 'sub:m', name: 'Mouse' },
      { id: 'sub:p', name: 'Printer' },
    ]);
    const sheetIds = assetTypeOptions(catalogue).map((o) => o.id);
    for (const chip of chips) expect(sheetIds).toContain(chip.id);
  });
});

