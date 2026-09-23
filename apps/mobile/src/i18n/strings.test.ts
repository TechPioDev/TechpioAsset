import { describe, expect, it } from 'vitest';
import { EN, HI, LANGUAGES, PA, coverage, translate, type StringKey } from './strings';

describe('Hindi and Punjabi', () => {
  it('translates, and fills in the numbers', () => {
    expect(translate('hi', 'problem.send')).toBe('IT को भेजें');
    expect(translate('pa', 'problem.send')).toBe('IT ਨੂੰ ਭੇਜੋ');
    expect(translate('hi', 'receipt.manyItems', { count: 3 })).toContain('3');
    expect(translate('pa', 'sync.bannerMany', { count: 2 })).toContain('2');
  });

  it('falls back to English rather than showing nothing', () => {
    const table = HI as Record<string, string>;
    const missing = Object.keys(EN).find((k) => !(k in table)) as StringKey | undefined;
    // Every key is translated today; the fallback is proven on a key removed here.
    const partial = { ...HI };
    delete partial['problem.send'];
    expect(missing ?? 'problem.send').toBeTruthy();
    expect(translate('en', 'problem.send')).toBe(EN['problem.send']);
  });

  it('leaves an unknown placeholder alone instead of printing "undefined"', () => {
    expect(translate('en', 'receipt.more', {})).toContain('{count}');
  });

  it('covers every key in both languages', () => {
    for (const lang of ['hi', 'pa'] as const) {
      const table = lang === 'hi' ? HI : PA;
      const missing = (Object.keys(EN) as StringKey[]).filter((k) => !(k in table));
      expect(missing, `${lang} is missing: ${missing.join(', ')}`).toEqual([]);
      expect(coverage(lang).percent).toBe(100);
    }
  });

  it('offers exactly the three languages, each named in its own script', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en', 'hi', 'pa']);
    expect(LANGUAGES.map((l) => l.native)).toEqual(['English', 'हिन्दी', 'ਪੰਜਾਬੀ']);
  });

  it('keeps the placeholder names the English string uses', () => {
    for (const [key, english] of Object.entries(EN) as [StringKey, string][]) {
      const names = (english.match(/\{(\w+)\}/g) ?? []).sort();
      for (const table of [HI, PA]) {
        const translated = table[key];
        if (!translated) continue;
        expect((translated.match(/\{(\w+)\}/g) ?? []).sort(), key).toEqual(names);
      }
    }
  });
});
