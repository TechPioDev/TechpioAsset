import { SqliteStore } from './sqlite-store';

/**
 * What the phone remembers so a handover can be recorded with no signal
 * (Phase 6, v2.82): the last copy of each asset opened, and the people list
 * the handover sheet chooses from. Both are refreshed every time they load
 * online, and both say how old they are when shown offline.
 */
const store = new SqliteStore();

interface Cached<T> {
  savedAt: string;
  value: T;
}

async function put<T>(key: string, value: T): Promise<void> {
  try {
    await store.set(
      key,
      JSON.stringify({ savedAt: new Date().toISOString(), value } satisfies Cached<T>),
    );
  } catch {
    // A full or unavailable store only costs the offline copy.
  }
}

async function get<T>(key: string): Promise<Cached<T> | null> {
  try {
    const raw = await store.get(key);
    return raw ? (JSON.parse(raw) as Cached<T>) : null;
  } catch {
    return null;
  }
}

export const cacheAsset = <T>(id: string, value: T) => put(`offline.asset.${id}`, value);
export const cachedAsset = <T>(id: string) => get<T>(`offline.asset.${id}`);
export const cachePeople = <T>(value: T) => put('offline.people', value);
export const cachedPeople = <T>() => get<T>('offline.people');
export const cacheStock = <T>(value: T) => put('offline.stock', value);
export const cachedStock = <T>() => get<T>('offline.stock');

/** "3:42 pm" today, else "22 Sep, 3:42 pm". */
export function savedLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === now.toDateString()
    ? time
    : `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`;
}
