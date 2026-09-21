import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client';
import { SCAN_MESSAGES } from './scan-code';
import { MemoryStore } from './storage';
import {
  addScan,
  displayToken,
  isNetworkFailure,
  LookupTimeoutError,
  lookupFailureMessage,
  MAX_SAVED_SCANS,
  OFFLINE_SCAN_MESSAGES,
  parseScans,
  removeScan,
  SavedScans,
  scannedWhen,
  serialiseScans,
  withLookupTimeout,
  type SavedScan,
} from './offline-scans';

const T0 = new Date('2026-09-21T09:00:00.000Z');
const later = (minutes: number) => new Date(T0.getTime() + minutes * 60000);

describe('isNetworkFailure', () => {
  it('is true when fetch itself rejects, as React Native and browsers word it', () => {
    expect(isNetworkFailure(new TypeError('Network request failed'))).toBe(true);
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('is true for an aborted or timed-out request', () => {
    const aborted = new Error('Aborted');
    aborted.name = 'AbortError';
    expect(isNetworkFailure(aborted)).toBe(true);
    expect(isNetworkFailure(new LookupTimeoutError())).toBe(true);
  });

  it('is false whenever the server answered, whatever it said', () => {
    expect(isNetworkFailure(new ApiError(null, 404))).toBe(false);
    expect(isNetworkFailure(new ApiError(null, 403))).toBe(false);
    expect(isNetworkFailure(new ApiError(null, 500))).toBe(false);
    expect(isNetworkFailure(new ApiError(null, 502))).toBe(false);
  });

  it('is false for a bug or a bad body, which a connection would not fix', () => {
    expect(isNetworkFailure(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isNetworkFailure(new SyntaxError('Unexpected token < in JSON'))).toBe(false);
    expect(isNetworkFailure('Network request failed')).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
  });
});

describe('withLookupTimeout', () => {
  it('passes a result through', async () => {
    await expect(withLookupTimeout(Promise.resolve({ id: 'a1' }), 50)).resolves.toEqual({ id: 'a1' });
  });

  it('passes the real failure through, so a 404 stays a 404', async () => {
    const notFound = new ApiError(null, 404);
    await expect(withLookupTimeout(Promise.reject(notFound), 50)).rejects.toBe(notFound);
  });

  it('gives up on a request that never settles, as a network failure', async () => {
    const never = new Promise<never>(() => undefined);
    const outcome = await withLookupTimeout(never, 10).catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(LookupTimeoutError);
    expect(isNetworkFailure(outcome)).toBe(true);
  });
});

describe('lookupFailureMessage', () => {
  it('says the scan stays saved when there is still no connection', () => {
    expect(lookupFailureMessage(new TypeError('Network request failed'))).toBe(
      OFFLINE_SCAN_MESSAGES.stillOffline,
    );
  });

  it('says the code matches nothing for a 404 and for a 403 alike', () => {
    expect(lookupFailureMessage(new ApiError(null, 404))).toBe(SCAN_MESSAGES.notAsset);
    expect(lookupFailureMessage(new ApiError(null, 403))).toBe(SCAN_MESSAGES.notAsset);
  });

  it('names the status for a server fault and asks for a sign-in on a 401', () => {
    expect(lookupFailureMessage(new ApiError(null, 500))).toContain('500');
    expect(lookupFailureMessage(new ApiError(null, 401))).toMatch(/sign in/i);
  });

  it('has something to say about anything else', () => {
    expect(lookupFailureMessage(new Error('odd'))).toMatch(/could not be looked up/);
  });
});

describe('addScan', () => {
  it('puts the newest first', () => {
    const list = addScan(addScan([], 'AAA', T0), 'BBB', later(1));
    expect(list.map((s) => s.token)).toEqual(['BBB', 'AAA']);
    expect(list[0]!.scannedAt).toBe(later(1).toISOString());
  });

  it('keeps one entry for a code scanned twice, moved to the top with the new time', () => {
    let list = addScan([], 'AAA', T0);
    list = addScan(list, 'BBB', later(1));
    list = addScan(list, 'AAA', later(2));
    expect(list).toEqual([
      { token: 'AAA', scannedAt: later(2).toISOString() },
      { token: 'BBB', scannedAt: later(1).toISOString() },
    ]);
  });

  it('treats a code with stray spaces as the same code', () => {
    const list = addScan(addScan([], 'AAA', T0), '  AAA ', later(1));
    expect(list).toHaveLength(1);
    expect(list[0]!.token).toBe('AAA');
  });

  it('ignores an empty code', () => {
    const before = addScan([], 'AAA', T0);
    expect(addScan(before, '   ', later(1))).toEqual(before);
  });

  it('keeps at most the cap, dropping the oldest', () => {
    let list: SavedScan[] = [];
    for (let i = 0; i < MAX_SAVED_SCANS + 5; i += 1) list = addScan(list, `T${i}`, later(i));
    expect(list).toHaveLength(MAX_SAVED_SCANS);
    expect(list[0]!.token).toBe(`T${MAX_SAVED_SCANS + 4}`);
    expect(list.at(-1)!.token).toBe('T5');
  });

  it('does not change the list it was given', () => {
    const original = addScan([], 'AAA', T0);
    const copy = [...original];
    addScan(original, 'BBB', later(1));
    expect(original).toEqual(copy);
  });
});

describe('removeScan', () => {
  it('removes the one code and leaves the rest in order', () => {
    const list = addScan(addScan(addScan([], 'AAA', T0), 'BBB', later(1)), 'CCC', later(2));
    expect(removeScan(list, 'BBB').map((s) => s.token)).toEqual(['CCC', 'AAA']);
  });

  it('is a no-op for a code that is not there', () => {
    const list = addScan([], 'AAA', T0);
    expect(removeScan(list, 'ZZZ')).toEqual(list);
  });
});

describe('serialiseScans / parseScans', () => {
  it('round-trips', () => {
    const list = addScan(addScan([], 'AAA', T0), 'BBB', later(1));
    expect(parseScans(serialiseScans(list))).toEqual(list);
  });

  it('gives an empty list for nothing, for corrupt storage, and for the wrong shape', () => {
    expect(parseScans(null)).toEqual([]);
    expect(parseScans('')).toEqual([]);
    expect(parseScans('{not json')).toEqual([]);
    expect(parseScans('{"token":"AAA"}')).toEqual([]);
  });

  it('drops entries that are not whole and keeps the good ones', () => {
    const raw = JSON.stringify([
      { token: 'AAA', scannedAt: T0.toISOString() },
      { token: '', scannedAt: T0.toISOString() },
      { token: 'BBB', scannedAt: 'yesterday-ish' },
      { token: 42, scannedAt: T0.toISOString() },
      null,
      'CCC',
      { token: 'DDD', scannedAt: later(1).toISOString(), extra: 'ignored' },
    ]);
    expect(parseScans(raw)).toEqual([
      { token: 'AAA', scannedAt: T0.toISOString() },
      { token: 'DDD', scannedAt: later(1).toISOString() },
    ]);
  });

  it('de-duplicates and caps a list that was stored without those rules', () => {
    const entries = Array.from({ length: MAX_SAVED_SCANS + 10 }, (_, i) => ({
      token: `T${i}`,
      scannedAt: T0.toISOString(),
    }));
    const raw = JSON.stringify([entries[0], ...entries]);
    const parsed = parseScans(raw);
    expect(parsed).toHaveLength(MAX_SAVED_SCANS);
    expect(parsed.filter((s) => s.token === 'T0')).toHaveLength(1);
  });
});

describe('scannedWhen', () => {
  it('is relative for the first day', () => {
    expect(scannedWhen(T0.toISOString(), later(0))).toBe('Just now');
    expect(scannedWhen(T0.toISOString(), later(12))).toBe('12 min ago');
    expect(scannedWhen(T0.toISOString(), later(60 * 3 + 5))).toBe('3 hr ago');
  });

  it('is a date after that', () => {
    expect(scannedWhen(T0.toISOString(), later(60 * 30))).toMatch(/^\d{1,2} Sep 2026, \d{2}:\d{2}$/);
  });

  it('says "Just now" rather than a negative time when the clock has moved back', () => {
    expect(scannedWhen(later(5).toISOString(), T0)).toBe('Just now');
  });

  it('is empty for a time that is not one', () => {
    expect(scannedWhen('nonsense', T0)).toBe('');
  });
});

describe('displayToken', () => {
  it('shortens a label token to its two ends', () => {
    expect(displayToken('01KYX56HZT81QXS171WT4H9XGG')).toBe('01KYX56HZT…WT4H9XGG');
  });

  it('shows a short code, such as a serial barcode, whole', () => {
    expect(displayToken('PF3K2L9X')).toBe('PF3K2L9X');
  });
});

describe('SavedScans', () => {
  it('persists across instances on the same store', async () => {
    const store = new MemoryStore();
    await new SavedScans(store).add('AAA', T0);
    await new SavedScans(store).add('BBB', later(1));
    expect((await new SavedScans(store).list()).map((s) => s.token)).toEqual(['BBB', 'AAA']);
  });

  it('answers each change with the list as it now stands', async () => {
    const scans = new SavedScans(new MemoryStore());
    expect(await scans.add('AAA', T0)).toHaveLength(1);
    expect(await scans.add('AAA', later(1))).toHaveLength(1);
    expect(await scans.add('BBB', later(2))).toHaveLength(2);
    expect((await scans.remove('AAA')).map((s) => s.token)).toEqual(['BBB']);
    expect(await scans.clear()).toEqual([]);
    expect(await scans.list()).toEqual([]);
  });

  it('leaves nothing behind in storage once the last one is removed', async () => {
    const store = new MemoryStore();
    const scans = new SavedScans(store);
    await scans.add('AAA', T0);
    await scans.remove('AAA');
    expect(await store.get('techpioasset.offline.scans')).toBeNull();
  });

  it('starts empty over corrupt storage instead of throwing', async () => {
    const store = new MemoryStore();
    await store.set('techpioasset.offline.scans', '<<<');
    const scans = new SavedScans(store);
    expect(await scans.list()).toEqual([]);
    expect(await scans.add('AAA', T0)).toHaveLength(1);
  });
});
