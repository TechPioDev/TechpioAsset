import { describe, expect, it } from 'vitest';
import { filterOptions, hiddenCount, shouldFilter, SHOW_AT_MOST } from './pick-options';

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, name: `Supplier ${i}` }));

describe('when to offer a filter at all', () => {
  it('leaves a short list as plain chips', () => {
    expect(shouldFilter(5)).toBe(false);
    expect(shouldFilter(12)).toBe(false);
  });

  it('offers one once the chips become a wall', () => {
    expect(shouldFilter(13)).toBe(true);
    expect(shouldFilter(166)).toBe(true);
  });
});

describe('narrowing', () => {
  it('matches on any part of the name, ignoring case', () => {
    const options = [
      { id: 'a', name: 'Nordwind Computing' },
      { id: 'b', name: 'Satlaj Systems' },
      { id: 'c', name: 'Kaveri Infotech' },
    ];
    expect(filterOptions(options, 'wind', '').map((o) => o.id)).toEqual(['a']);
    expect(filterOptions(options, 'SYSTEMS', '').map((o) => o.id)).toEqual(['b']);
  });

  it('returns everything when nothing is typed', () => {
    const options = many(5);
    expect(filterOptions(options, '   ', '')).toHaveLength(5);
  });

  it('caps a huge list rather than rendering all of it', () => {
    expect(filterOptions(many(200), '', '')).toHaveLength(SHOW_AT_MOST);
  });

  it('keeps the chosen option visible even when it does not match', () => {
    // The bug this prevents: typing in the box appears to clear a selection
    // that is still set, and the next tap silently changes it.
    const options = [
      { id: 'chosen', name: 'Kaveri Infotech' },
      { id: 'other', name: 'Nordwind Computing' },
    ];
    const shown = filterOptions(options, 'nordwind', 'chosen');
    expect(shown.map((o) => o.id)).toContain('chosen');
    expect(shown[0]!.id, 'and it leads, so it is not lost below the fold').toBe('chosen');
  });

  it('does not duplicate the chosen option when it also matches', () => {
    const options = [{ id: 'chosen', name: 'Kaveri Infotech' }];
    expect(filterOptions(options, 'kaveri', 'chosen')).toHaveLength(1);
  });

  it('keeps the chosen option visible past the cap', () => {
    const options = [...many(200), { id: 'last', name: 'Zzz Supplier' }];
    const shown = filterOptions(options, '', 'last');
    expect(shown.map((o) => o.id)).toContain('last');
  });
});

describe('the "N more" hint', () => {
  it('counts what is not on screen', () => {
    expect(hiddenCount(166, 30)).toBe(136);
  });

  it('never goes negative when the chosen option pushed the list over', () => {
    expect(hiddenCount(30, 31)).toBe(0);
  });
});
