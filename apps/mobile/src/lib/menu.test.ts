import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@techpioasset/domain';
import { MENU_GROUPS, findMenuGroup, searchMenu, visibleMenu } from './menu';

const ALL = Object.values(PERMISSIONS);

describe('the phone menu', () => {
  it('offers a Super Admin every category, and every destination once', () => {
    const groups = visibleMenu(ALL);
    expect(groups.map((g) => g.id)).toEqual(MENU_GROUPS.map((g) => g.id));
    const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('keeps everything the old More list linked to', () => {
    // The redesign must not lose a screen someone reached from More.
    const hrefs = visibleMenu(ALL).flatMap((g) => g.items.map((i) => i.href));
    for (const href of [
      '/notifications',
      '/my-equipment',
      '/my-licenses',
      '/vendor-company',
      '/help',
      '/(tabs)/scan',
      '/(tabs)/capture',
      '/(tabs)/inventory',
      '/purchase-orders',
      '/stock',
      '/licenses',
      '/invoices',
      '/work-orders',
      '/maintenance',
      '/people',
      '/people-invitations',
      '/analytics',
      '/reports',
      '/audit',
      '/(tabs)/profile',
    ]) {
      expect(hrefs).toContain(href);
    }
  });

  it('hides a category entirely when nothing in it is allowed', () => {
    // An employee with no admin permissions: no People, no Insights.
    const groups = visibleMenu([PERMISSIONS.ASSETS_READ, PERMISSIONS.REQUESTS_READ]);
    const ids = groups.map((g) => g.id);
    expect(ids).not.toContain('people');
    expect(ids).not.toContain('insights');
    // Permission-free items keep the workspace and settings categories.
    expect(ids).toContain('workspace');
    expect(ids).toContain('settings');
  });

  it('trims a category to what the user may open', () => {
    const settings = findMenuGroup('settings', [])!;
    expect(settings.items.map((i) => i.label)).toEqual(['Profile', 'Security', 'Appearance', 'Help']);
  });

  it('shows an item when the user holds any one of its permissions', () => {
    const assess = findMenuGroup('workspace', [PERMISSIONS.REQUESTS_ASSESS])!;
    expect(assess.items.map((i) => i.label)).toContain('Awaiting me');
  });

  it('returns null for a category that is unknown or empty for this user', () => {
    expect(findMenuGroup('nonsense', ALL)).toBeNull();
    expect(findMenuGroup('insights', [])).toBeNull();
  });

  it('searches labels, descriptions and category names, within permissions', () => {
    expect(searchMenu('invoice', ALL).map((r) => r.item.label)).toEqual(
      expect.arrayContaining(['Invoices']),
    );
    // "two-factor" is only in a description.
    expect(searchMenu('two-factor', ALL).map((r) => r.item.label)).toEqual(['Security']);
    // A category name finds its items.
    expect(searchMenu('insights', ALL)).toHaveLength(3);
    // Nothing the user cannot open is ever suggested.
    expect(searchMenu('audit', [])).toEqual([]);
    expect(searchMenu('   ', ALL)).toEqual([]);
  });
});
