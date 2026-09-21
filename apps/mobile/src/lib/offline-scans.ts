import { ApiError } from './api-client';
import { SCAN_MESSAGES } from './scan-code';
import type { KeyValueStore } from './storage';

/**
 * Scanning with no signal (0.3.29).
 *
 * A scan is a lookup - `/assets/by-qr/:token` - so in a basement store room or
 * a server cage it simply failed, and the screen said "that code does not match
 * an asset you can access", which was not true: nobody had been asked. The code
 * is now kept on the phone with the time it was read, and opened from "Saved
 * scans" once there is a connection again.
 *
 * Only the code is kept, never an answer: what somebody may see is decided by
 * the server at the moment they look, so a saved scan is looked up afresh under
 * whoever is signed in when it is opened.
 *
 * The list rules are pure functions and the persistence takes an injected
 * KeyValueStore - the same arrangement as the offline queue - so all of it runs
 * in vitest against MemoryStore, and on the phone against SQLite.
 */

export interface SavedScan {
  /** What `/assets/by-qr/` takes - already through qrTokenFrom. */
  token: string;
  /** ISO time the code was read. */
  scannedAt: string;
}

/**
 * Plenty for a walk round a dead zone, and small enough that a phone left
 * scanning a poster overnight cannot grow the store without limit.
 */
export const MAX_SAVED_SCANS = 50;

const STORE_KEY = 'techpioasset.offline.scans';

export const OFFLINE_SCAN_MESSAGES = {
  saved: 'No connection — saved. Open it from Saved scans when you are back online.',
  stillOffline: 'Still no connection. It stays saved — try again when you are back online.',
} as const;

/** Thrown by {@link withLookupTimeout} when nothing came back in time. */
export class LookupTimeoutError extends Error {
  constructor() {
    super('The lookup timed out');
    this.name = 'LookupTimeoutError';
  }
}

/**
 * Did the request fail to reach the server at all?
 *
 * The distinction the whole feature rests on. The API client throws ApiError
 * only once a response has arrived, so an ApiError of any status - 404 for a
 * code that is not ours, 403 for one outside this person's scope, 500 - means
 * the server was reached and answered, and saving the code "for when you are
 * back online" would promise something a connection cannot fix.
 *
 * What is left is `fetch` itself rejecting. React Native says `TypeError:
 * Network request failed`, browsers `Failed to fetch`, and an aborted or timed
 * out request carries its own name. A SyntaxError from a proxy's HTML page is
 * deliberately not one of these: something answered.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof ApiError) return false;
  if (error instanceof LookupTimeoutError) return true;
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  if (error instanceof TypeError) {
    return /network request failed|failed to fetch|network ?error|load failed|timed? ?out/i.test(
      error.message,
    );
  }
  return false;
}

/**
 * One bar of signal is worse than none: the request neither fails nor finishes,
 * and the scanner sits locked behind it. `fetch` has no timeout of its own in
 * React Native, so the lookup is raced against a clock and a slow one is
 * treated as no connection - the code is saved, and scanning goes on.
 *
 * The request itself is left to finish or fail unobserved; the API client takes
 * no abort signal, and a GET that lands late changes nothing.
 */
export const LOOKUP_TIMEOUT_MS = 12000;

export function withLookupTimeout<T>(work: Promise<T>, timeoutMs = LOOKUP_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LookupTimeoutError()), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Why a lookup failed, in words for the person holding the phone. Used when a
 * saved scan is retried, where "it failed" has three different next steps:
 * wait for signal, give up on the code, or try again later.
 */
export function lookupFailureMessage(error: unknown): string {
  if (isNetworkFailure(error)) return OFFLINE_SCAN_MESSAGES.stillOffline;
  if (error instanceof ApiError) {
    // The same sentence a live scan has always shown for a code that is not ours.
    if (error.status === 404 || error.status === 403) return SCAN_MESSAGES.notAsset;
    if (error.status === 401) return 'You are signed out. Sign in, then open it again.';
    return `The server could not look that code up (${error.status}). Try again in a moment.`;
  }
  return 'That code could not be looked up. Try again in a moment.';
}

/**
 * Adds a code, newest first.
 *
 * The same code scanned again is one entry, moved to the top with the new
 * time - the live camera reports a label many times while it is held in view,
 * and a list of ten copies of one laptop is no use to anybody. Past the cap
 * the oldest fall off the end.
 */
export function addScan(list: readonly SavedScan[], token: string, scannedAt: Date): SavedScan[] {
  const clean = token.trim();
  if (!clean) return [...list];
  const rest = list.filter((entry) => entry.token !== clean);
  return [{ token: clean, scannedAt: scannedAt.toISOString() }, ...rest].slice(0, MAX_SAVED_SCANS);
}

export function removeScan(list: readonly SavedScan[], token: string): SavedScan[] {
  return list.filter((entry) => entry.token !== token);
}

export function serialiseScans(list: readonly SavedScan[]): string {
  return JSON.stringify(list.map(({ token, scannedAt }) => ({ token, scannedAt })));
}

/**
 * Reads the stored list back, keeping only entries that are whole. Corrupt
 * storage gives an empty list rather than a crash on the scan screen - the
 * same choice the offline queue makes, for the same reason. The rules of
 * addScan are applied again on the way in, so a list written by a build with a
 * larger cap, or edited by hand, still comes out de-duplicated and capped.
 */
export function parseScans(raw: string | null | undefined): SavedScan[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const list: SavedScan[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const { token, scannedAt } = entry as Record<string, unknown>;
    if (typeof token !== 'string' || !token.trim()) continue;
    if (typeof scannedAt !== 'string' || Number.isNaN(Date.parse(scannedAt))) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    list.push({ token, scannedAt });
  }
  return list.slice(0, MAX_SAVED_SCANS);
}

/**
 * "Just now", "12 min ago", "3 hr ago", then the date and time. Relative while
 * it is recent because that is how somebody finds "the one I scanned in the
 * basement a minute ago"; absolute after a day because "41 hr ago" is a sum.
 */
export function scannedWhen(scannedAt: string, now: Date): string {
  const then = new Date(scannedAt);
  if (Number.isNaN(then.getTime())) return '';
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${then.getDate()} ${MONTHS[then.getMonth()]} ${then.getFullYear()}, ${pad(then.getHours())}:${pad(then.getMinutes())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A long token shortened for a row: a label's token is a 26-character ULID,
 * and the two ends are what tells one from another. A serial-number barcode is
 * short and is shown whole.
 */
export function displayToken(token: string): string {
  return token.length > 22 ? `${token.slice(0, 10)}…${token.slice(-8)}` : token;
}

/** The saved list, persisted. Every method answers with the list as it now stands. */
export class SavedScans {
  constructor(private readonly store: KeyValueStore) {}

  async list(): Promise<SavedScan[]> {
    return parseScans(await this.store.get(STORE_KEY));
  }

  async add(token: string, scannedAt: Date = new Date()): Promise<SavedScan[]> {
    const next = addScan(await this.list(), token, scannedAt);
    await this.store.set(STORE_KEY, serialiseScans(next));
    return next;
  }

  async remove(token: string): Promise<SavedScan[]> {
    const next = removeScan(await this.list(), token);
    if (next.length === 0) await this.store.delete(STORE_KEY);
    else await this.store.set(STORE_KEY, serialiseScans(next));
    return next;
  }

  async clear(): Promise<SavedScan[]> {
    await this.store.delete(STORE_KEY);
    return [];
  }
}
