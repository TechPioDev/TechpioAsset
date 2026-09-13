import { describe, expect, it } from 'vitest';
import { notificationRoute } from './notification-route';

describe('where tapping a notification takes you', () => {
  it('translates a web detail link into the phone screen for it', () => {
    expect(notificationRoute('/catalogue/cmt123abc')).toBe('/offer/cmt123abc');
    expect(notificationRoute('/requests/cmt456')).toBe('/request/cmt456');
    expect(notificationRoute('/assets/cmt789')).toBe('/asset/cmt789');
    expect(notificationRoute('/licenses/lic1')).toBe('/license/lic1');
    expect(notificationRoute('/people/usr1')).toBe('/person/usr1');
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
