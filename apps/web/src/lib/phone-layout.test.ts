import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A guard for the phone layout (v2.69).
 *
 * People, Requests, Invoices, Audit, Inventory and Maintenance were each wider
 * than a 375px phone - People by double - although every table already sat in
 * an overflow-x-auto wrapper. The cause was one missing class: a Card is a grid
 * item, a grid item will not shrink below its content, so the card took the
 * table's width and the page went with it. There is no browser in this test
 * lane to measure a page, so this pins the class that fixed them all, and the
 * finger-sized controls that went in with it.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('the phone layout', () => {
  it('lets a card shrink below the table inside it', () => {
    const ui = read('../components/ui.tsx');
    const card = ui.slice(ui.indexOf('export function Card('));
    expect(card.slice(0, card.indexOf('\n}\n'))).toContain("'min-w-0 rounded-");
  });

  it('makes buttons and form controls finger-sized below sm', () => {
    const button = read('../components/ui/button.tsx');
    expect(button).toContain('h-10 max-sm:h-11');
    expect(button).toContain('h-8 max-sm:h-10');
    expect(read('../components/ui.tsx').match(/max-sm:h-11/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the theme switch out of the phone top bar, and in the account menu', () => {
    expect(read('../components/app-shell.tsx')).toMatch(/hidden sm:block">\s*<ThemeToggle \/>/);
    expect(read('../components/profile-menu.tsx')).toMatch(/sm:hidden">[\s\S]{0,120}<ThemeToggle \/>/);
  });
});

describe('lists on a phone (v2.70)', () => {
  it('shows Requests and People as cards below sm, and the table from sm up', () => {
    for (const path of ['../app/(app)/requests/page.tsx', '../components/people/people-directory.tsx']) {
      const page = read(path);
      expect(page).toContain('<ul className="divide-y divide-[var(--color-border)] sm:hidden">');
      expect(page).toContain('<div className="hidden overflow-x-auto sm:block">');
    }
  });

  it('keeps sorting reachable on the People cards, which have no headings to press', () => {
    expect(read('../components/people/people-directory.tsx')).toContain('id="people-sort"');
  });

  it('folds the Assets filters behind one button on a phone, and leaves them inline from sm up', () => {
    const assets = read('../app/(app)/assets/page.tsx');
    expect(assets).toContain("'max-sm:hidden sm:contents'");
    expect(assets).toContain('aria-expanded={filtersOpen}');
    expect(assets).toContain('aria-expanded={moreOpen}');
  });
});
