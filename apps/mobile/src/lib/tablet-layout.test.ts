import { describe, expect, it } from 'vitest';
import { gridColumns, isPhoneSized, isTabletWidth, listPaneWidth } from './tablet-layout-rules';

describe('tablet layout', () => {
  it('uses two columns from tablet width up', () => {
    expect(isTabletWidth(390)).toBe(false);
    expect(isTabletWidth(767)).toBe(false);
    expect(isTabletWidth(768)).toBe(true);
    expect(isTabletWidth(1280)).toBe(true);
  });

  it('keeps the list column readable and leaves most of the screen to the item', () => {
    expect(listPaneWidth(768)).toBe(320);
    expect(listPaneWidth(1024)).toBe(369);
    expect(listPaneWidth(1600)).toBe(440);
    for (const w of [768, 1024, 1366]) expect(listPaneWidth(w)).toBeLessThan(w / 2);
  });

  it('tells a phone from a tablet by its shortest side, whichever way it is held', () => {
    expect(isPhoneSized(390, 844)).toBe(true);
    expect(isPhoneSized(844, 390)).toBe(true);
    expect(isPhoneSized(800, 1280)).toBe(false);
    expect(isPhoneSized(1280, 800)).toBe(false);
  });

  it('grids widen with the screen', () => {
    expect(gridColumns(390)).toBe(2);
    expect(gridColumns(900)).toBe(3);
    expect(gridColumns(1280)).toBe(4);
  });
});
