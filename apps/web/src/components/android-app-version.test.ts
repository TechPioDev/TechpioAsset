import { describe, expect, it } from 'vitest';
import { describeAndroidManifest, parseAndroidManifest } from './android-app-version';

describe('the Android app version beside the download link', () => {
  const good = { version: '0.3.15', versionCode: 30, publishedAt: '2026-09-15T10:24:55.000Z', sizeBytes: 1 };

  it('reads what the build writes', () => {
    expect(parseAndroidManifest(good)).toEqual({
      version: '0.3.15',
      versionCode: 30,
      publishedAt: '2026-09-15T10:24:55.000Z',
    });
  });

  it('says nothing rather than something wrong', () => {
    // A missing file comes back as an HTML error page or null; a half-written or
    // edited one must not put a made-up version on the login page.
    expect(parseAndroidManifest(null)).toBeNull();
    expect(parseAndroidManifest('<html>404</html>')).toBeNull();
    expect(parseAndroidManifest({ ...good, version: 'latest' })).toBeNull();
    expect(parseAndroidManifest({ ...good, versionCode: '30' })).toBeNull();
    expect(parseAndroidManifest({ ...good, publishedAt: 'yesterday' })).toBeNull();
  });

  it('names the version and the day it was published', () => {
    const text = describeAndroidManifest(parseAndroidManifest(good)!);
    expect(text).toMatch(/^Version 0\.3\.15 · updated /);
    expect(text).toContain('2026');
  });
});
