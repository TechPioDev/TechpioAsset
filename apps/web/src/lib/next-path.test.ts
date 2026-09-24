import { describe, expect, it } from 'vitest';
import { loginHref, safeNextPath } from './next-path';

/**
 * v2.88 — the destination carried through sign-in.
 *
 * Half of these are about getting someone back where they were going. The
 * other half are about an open redirect, which is what this feature is if the
 * target is not checked: a link to our own login page that sends the reader
 * somewhere else to type their password.
 */

describe('a destination we will follow', () => {
  it('keeps a page inside the app, filters and all', () => {
    expect(safeNextPath('/assets')).toBe('/assets');
    expect(safeNextPath('/assets?status=DAMAGED')).toBe('/assets?status=DAMAGED');
    expect(safeNextPath('/assets?status=DAMAGED,LOST,STOLEN')).toBe(
      '/assets?status=DAMAGED,LOST,STOLEN',
    );
    expect(safeNextPath('/requests/abc123#notes')).toBe('/requests/abc123#notes');
  });

  it('trims the surrounding space rather than refusing', () => {
    expect(safeNextPath('  /assets  ')).toBe('/assets');
  });
});

describe('a destination we refuse', () => {
  it('refuses another site, however it is written', () => {
    for (const bad of [
      'https://evil.example',
      'http://evil.example/login',
      'HTTPS://EVIL.EXAMPLE',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'mailto:someone@evil.example',
    ]) {
      expect(safeNextPath(bad), bad).toBeNull();
    }
  });

  it('refuses a protocol-relative URL, which looks like a path but is not', () => {
    // The browser reads "//evil.example" as another origin entirely.
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(safeNextPath('//evil.example/assets')).toBeNull();
  });

  it('refuses the backslash forms browsers normalise into that one', () => {
    expect(safeNextPath('/\\evil.example')).toBeNull();
    expect(safeNextPath('\\\\evil.example')).toBeNull();
    expect(safeNextPath('/assets\\..\\evil')).toBeNull();
  });

  it('refuses anything not anchored to the root', () => {
    expect(safeNextPath('assets')).toBeNull();
    expect(safeNextPath('../assets')).toBeNull();
    expect(safeNextPath('')).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });

  it('refuses control characters and whitespace inside the path', () => {
    expect(safeNextPath('/assets\nLocation: https://evil.example')).toBeNull();
    expect(safeNextPath('/as\u0000sets')).toBeNull();
    expect(safeNextPath('/my assets')).toBeNull();
  });

  it('refuses the sign-in pages themselves, which would loop', () => {
    expect(safeNextPath('/login')).toBeNull();
    expect(safeNextPath('/login?next=/login')).toBeNull();
    expect(safeNextPath('/reset-password/abc')).toBeNull();
    expect(safeNextPath('/accept-invite')).toBeNull();
    // A page that merely starts with the same letters is fine.
    expect(safeNextPath('/loginsomething')).toBe('/loginsomething');
  });

  it('refuses an absurdly long one', () => {
    expect(safeNextPath(`/assets?q=${'x'.repeat(600)}`)).toBeNull();
  });
});

describe('the sign-in link that remembers', () => {
  it('carries the page and its query', () => {
    expect(loginHref('/assets', '?status=DAMAGED')).toBe(
      `/login?next=${encodeURIComponent('/assets?status=DAMAGED')}`,
    );
  });

  it('encodes it, so the outer URL cannot be split by the inner one', () => {
    expect(loginHref('/assets', '?status=DAMAGED,LOST')).not.toContain('?status=');
  });

  it('carries nothing when the destination is one we would refuse anyway', () => {
    // Never advertise a target that cannot work on the way back.
    expect(loginHref('/login')).toBe('/login');
    expect(loginHref('//evil.example')).toBe('/login');
  });

  it('round-trips through the query string', () => {
    const href = loginHref('/assets', '?status=DAMAGED,LOST,STOLEN');
    const next = new URLSearchParams(href.split('?')[1]).get('next');
    expect(safeNextPath(next)).toBe('/assets?status=DAMAGED,LOST,STOLEN');
  });
});
