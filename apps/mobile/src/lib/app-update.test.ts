import { describe, expect, it, vi } from 'vitest';
import {
  apkUrl,
  checkForUpdate,
  createUpdateSession,
  formatApkSize,
  isNewerBuild,
  manifestUrl,
  originOf,
  parseUpdateManifest,
  updateBannerText,
} from './app-update';

const PUBLISHED = {
  version: '0.3.29',
  versionCode: 44,
  publishedAt: '2026-09-21T10:00:00.000Z',
  sizeBytes: 56271508,
};

function respondWith(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body }));
}

describe('originOf', () => {
  it('keeps the scheme and host and drops everything after', () => {
    expect(originOf('https://pioassets.com')).toBe('https://pioassets.com');
    expect(originOf('https://pioassets.com/')).toBe('https://pioassets.com');
    expect(originOf('https://piotask.com/api/v1?x=1')).toBe('https://piotask.com');
    expect(originOf('http://192.168.1.20:3001')).toBe('http://192.168.1.20:3001');
  });

  it('answers null for something that is not a web address', () => {
    expect(originOf('')).toBeNull();
    expect(originOf('pioassets.com')).toBeNull();
    expect(originOf('ftp://pioassets.com')).toBeNull();
  });
});

describe('manifestUrl / apkUrl', () => {
  it('build the downloads addresses on the configured host, not a fixed one', () => {
    expect(manifestUrl('https://piotask.com')).toBe('https://piotask.com/downloads/techpioasset.json');
    expect(apkUrl('https://pioassets.com/')).toBe('https://pioassets.com/downloads/techpioasset.apk');
  });

  it('are null when there is no host to build on', () => {
    expect(manifestUrl('nonsense')).toBeNull();
    expect(apkUrl('nonsense')).toBeNull();
  });
});

describe('parseUpdateManifest', () => {
  it('reads what the server publishes', () => {
    expect(parseUpdateManifest(PUBLISHED)).toEqual(PUBLISHED);
  });

  it('accepts a manifest without a size or a date', () => {
    expect(parseUpdateManifest({ version: '0.3.29', versionCode: 44 })).toEqual({
      version: '0.3.29',
      versionCode: 44,
      sizeBytes: null,
      publishedAt: null,
    });
  });

  it('refuses anything without a usable build number or version', () => {
    expect(parseUpdateManifest(null)).toBeNull();
    expect(parseUpdateManifest('0.3.29')).toBeNull();
    expect(parseUpdateManifest({ version: '0.3.29' })).toBeNull();
    expect(parseUpdateManifest({ version: '0.3.29', versionCode: '44' })).toBeNull();
    expect(parseUpdateManifest({ version: '0.3.29', versionCode: 44.5 })).toBeNull();
    expect(parseUpdateManifest({ version: '0.3.29', versionCode: 0 })).toBeNull();
    expect(parseUpdateManifest({ version: '  ', versionCode: 44 })).toBeNull();
  });

  it('drops a size that is not a positive number rather than showing it', () => {
    expect(parseUpdateManifest({ ...PUBLISHED, sizeBytes: -1 })?.sizeBytes).toBeNull();
    expect(parseUpdateManifest({ ...PUBLISHED, sizeBytes: '56 MB' })?.sizeBytes).toBeNull();
  });
});

describe('isNewerBuild', () => {
  const manifest = parseUpdateManifest(PUBLISHED)!;

  it('is true only when the published build number is higher', () => {
    expect(isNewerBuild(manifest, 43)).toBe(true);
    expect(isNewerBuild(manifest, 44)).toBe(false);
    expect(isNewerBuild(manifest, 45)).toBe(false);
  });

  it('is false when the installed build is unknown (dev client, browser)', () => {
    expect(isNewerBuild(manifest, null)).toBe(false);
    expect(isNewerBuild(manifest, undefined)).toBe(false);
    expect(isNewerBuild(manifest, Number.NaN)).toBe(false);
  });
});

describe('formatApkSize / updateBannerText', () => {
  it('shows whole megabytes', () => {
    expect(formatApkSize(56271508)).toBe('54 MB');
    expect(formatApkSize(500_000)).toBe('under 1 MB');
  });

  it('shows nothing for a missing or nonsense size', () => {
    expect(formatApkSize(null)).toBeNull();
    expect(formatApkSize(0)).toBeNull();
    expect(formatApkSize(Number.NaN)).toBeNull();
  });

  it('words the banner with the version and the size', () => {
    expect(updateBannerText(parseUpdateManifest(PUBLISHED)!)).toBe(
      'Update available — version 0.3.29 (54 MB)',
    );
  });

  it('leaves the brackets out when the size is unknown', () => {
    expect(updateBannerText(parseUpdateManifest({ version: '0.3.29', versionCode: 44 })!)).toBe(
      'Update available — version 0.3.29',
    );
  });
});

describe('checkForUpdate', () => {
  it('answers with the manifest when the server has a newer build', async () => {
    const fetchImpl = respondWith(PUBLISHED);
    const found = await checkForUpdate({
      apiUrl: 'https://pioassets.com',
      installedVersionCode: 43,
      fetchImpl,
    });
    expect(found?.versionCode).toBe(44);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://pioassets.com/downloads/techpioasset.json',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('answers null when this phone is already on the published build', async () => {
    expect(
      await checkForUpdate({
        apiUrl: 'https://pioassets.com',
        installedVersionCode: 44,
        fetchImpl: respondWith(PUBLISHED),
      }),
    ).toBeNull();
  });

  it('does not ask at all when the installed build is unknown', async () => {
    const fetchImpl = respondWith(PUBLISHED);
    expect(
      await checkForUpdate({ apiUrl: 'https://pioassets.com', installedVersionCode: null, fetchImpl }),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('is silent when offline', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });
    expect(
      await checkForUpdate({ apiUrl: 'https://pioassets.com', installedVersionCode: 43, fetchImpl }),
    ).toBeNull();
  });

  it('is silent on a server error, bad JSON, or a manifest that is not one', async () => {
    const base = { apiUrl: 'https://pioassets.com', installedVersionCode: 43 };
    expect(await checkForUpdate({ ...base, fetchImpl: respondWith(PUBLISHED, false) })).toBeNull();
    expect(await checkForUpdate({ ...base, fetchImpl: respondWith({ hello: 'world' }) })).toBeNull();
    const badJson = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }));
    expect(await checkForUpdate({ ...base, fetchImpl: badJson })).toBeNull();
  });

  it('gives up after the timeout rather than waiting on a dead connection', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
    );
    expect(
      await checkForUpdate({
        apiUrl: 'https://pioassets.com',
        installedVersionCode: 43,
        fetchImpl,
        timeoutMs: 10,
      }),
    ).toBeNull();
  });
});

describe('createUpdateSession', () => {
  it('lets the check be claimed once', () => {
    const session = createUpdateSession();
    expect(session.claimCheck()).toBe(true);
    expect(session.claimCheck()).toBe(false);
    expect(session.claimCheck()).toBe(false);
  });

  it('starts with nothing found and nothing dismissed', () => {
    const session = createUpdateSession();
    expect(session.found).toBeNull();
    expect(session.dismissed).toBe(false);
  });
});
