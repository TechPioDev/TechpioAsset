import { describe, expect, it } from 'vitest';
import { notificationRoute, notificationTarget } from './notification-route';

describe('where tapping a notification takes you', () => {
  it('translates a web detail link into the phone screen for it', () => {
    expect(notificationRoute('/catalogue/cmt123abc')).toBe('/offer/cmt123abc');
    expect(notificationRoute('/requests/cmt456')).toBe('/request/cmt456');
    expect(notificationRoute('/assets/cmt789')).toBe('/asset/cmt789');
    expect(notificationRoute('/licenses/lic1')).toBe('/license/lic1');
    expect(notificationRoute('/people/usr1')).toBe('/person/usr1');
    expect(notificationRoute('/invoices/inv1')).toBe('/invoice/inv1');
  });

  it('knows the phone screens that exist for a few whole web pages', () => {
    expect(notificationRoute('/settings/security')).toBe('/settings/security');
    expect(notificationRoute('/people/invitations')).toBe('/people-invitations');
    expect(notificationRoute('/people/invitations?status=pending')).toBe('/people-invitations');
  });

  it('sends a bare collection link to the list', () => {
    expect(notificationRoute('/catalogue')).toBe('/(tabs)/catalogue');
    expect(notificationRoute('/requests')).toBe('/(tabs)/requests');
  });

  it('never asks the detail screen for a record called "new" or "import"', () => {
    // These are web sub-pages, not ids.
    expect(notificationRoute('/catalogue/import')).toBe('/(tabs)/catalogue');
    expect(notificationRoute('/catalogue/new')).toBe('/(tabs)/catalogue');
    expect(notificationRoute('/catalogue/company')).toBe('/(tabs)/catalogue');
  });

  it('falls back to the list for a nested web page the phone does not have', () => {
    expect(notificationRoute('/catalogue/cmt123/edit')).toBe('/(tabs)/catalogue');
  });

  it('ignores the query string rather than carrying filters across', () => {
    expect(notificationRoute('/requests?awaitingMe=true')).toBe('/(tabs)/requests');
    expect(notificationRoute('/assets/cmt1?tab=history')).toBe('/asset/cmt1');
  });

  it('declines links with no phone equivalent instead of guessing', () => {
    // An invite or a reset lives in the browser; opening the app is still
    // better than a screen that says "not found".
    expect(notificationRoute('/accept-invite?token=abc')).toBeNull();
    expect(notificationRoute('/reset-password')).toBeNull();
  });

  it('declines anything that is not a path', () => {
    expect(notificationRoute(undefined)).toBeNull();
    expect(notificationRoute(42)).toBeNull();
    expect(notificationRoute('https://evil.example/catalogue/x')).toBeNull();
    expect(notificationRoute('')).toBeNull();
  });
});

describe('where a notification button takes you (v2.78)', () => {
  it('Approve and Reject open the request asked to do it', () => {
    const data = { linkPath: '/requests/r1', requestId: 'r1' };
    expect(notificationTarget('approve', data)).toBe('/request/r1?action=approve');
    expect(notificationTarget('reject', data)).toBe('/request/r1?action=reject');
  });

  it('a tap on the notification itself still follows its link', () => {
    expect(
      notificationTarget('expo.modules.notifications.actions.DEFAULT', {
        linkPath: '/requests/r1',
        requestId: 'r1',
      }),
    ).toBe('/request/r1');
  });

  it('"assigned to you" lands on the asset, not nowhere', () => {
    const data = { linkPath: '/my-assets', assetId: 'a1' };
    expect(notificationTarget('expo.modules.notifications.actions.DEFAULT', data)).toBe(
      '/asset/a1',
    );
    expect(notificationTarget('confirm-receipt', data)).toBe('/asset/a1?action=confirm-receipt');
  });

  it('a push from before v2.78, with no ids, behaves as it always did', () => {
    expect(notificationTarget(undefined, { linkPath: '/catalogue/abc' })).toBe('/offer/abc');
    expect(notificationTarget(undefined, { linkPath: '/my-assets' })).toBeNull();
  });
});
