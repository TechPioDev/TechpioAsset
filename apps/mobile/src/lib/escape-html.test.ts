import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escape-html';

describe('escapeHtml', () => {
  it('escapes the five characters that can change markup', () => {
    expect(escapeHtml(`<img src=x onerror="alert('1')"> & co`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt; &amp; co',
    );
  });

  it('escapes an ampersand once, so an existing entity prints literally', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('leaves ordinary text, dashes and non-Latin names alone', () => {
    expect(escapeHtml('Yes — 14 Sept 2026 (in app) · ਸਤਿ ਸ੍ਰੀ')).toBe('Yes — 14 Sept 2026 (in app) · ਸਤਿ ਸ੍ਰੀ');
  });

  it('prints nothing for a missing value, and numbers as text', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});
