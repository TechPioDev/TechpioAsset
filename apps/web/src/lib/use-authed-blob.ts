'use client';

import { useEffect, useRef, useState } from 'react';
import { API_BASE, getAccessToken } from '@/lib/api-client';

/**
 * An object URL for a file behind the API's auth (v2.61).
 *
 * A bare <img src> cannot carry the Authorization header, so the bytes are
 * fetched and handed over as a blob: URL - the same pattern condition-photos
 * and the catalogue's OfferImage each carry inline. Revoked on change and on
 * unmount, or a page that swaps pictures leaks every one it has rendered.
 *
 * `path` is relative to the API base; null means "nothing to fetch", which
 * resolves to `{ url: null, failed: false }` rather than an error.
 */
export function useAuthedBlob(path: string | null): { url: string | null; failed: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const revoke = useRef<string | null>(null);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (!path) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}${path}`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (!alive) return;
        const objectUrl = URL.createObjectURL(blob);
        revoke.current = objectUrl;
        setUrl(objectUrl);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      if (revoke.current) {
        URL.revokeObjectURL(revoke.current);
        revoke.current = null;
      }
    };
  }, [path]);

  return { url, failed };
}

/**
 * Object URLs for several files at once (v2.62), keyed by path.
 *
 * For the asset page's slideshow: the cover is asked for alone, and the rest
 * only once somebody opens the viewer, so a page view does not download every
 * photograph the asset has ever had taken. A path already fetched is not
 * fetched again when the list grows. A failure leaves that picture out - a
 * slideshow with one missing picture is still a slideshow - and is reported so
 * the cover can fall back instead of waiting forever.
 */
export function useAuthedBlobs(paths: readonly string[]): {
  urls: Record<string, string>;
  /** Paths that could not be fetched, so a caller can stop waiting for them. */
  failed: ReadonlySet<string>;
} {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const made = useRef<Record<string, string>>({});
  const asked = useRef<Set<string>>(new Set());
  // Unmounted, not "this effect run is over": a download started for one list
  // must still land when the list grows, or its path is marked asked-for and
  // its picture never appears.
  const mounted = useRef(true);
  const key = paths.join('|');

  useEffect(() => {
    for (const path of paths) {
      if (asked.current.has(path)) continue;
      asked.current.add(path);
      void (async () => {
        try {
          const res = await fetch(`${API_BASE}${path}`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
          });
          if (!res.ok) throw new Error(String(res.status));
          const objectUrl = URL.createObjectURL(await res.blob());
          if (!mounted.current) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          made.current[path] = objectUrl;
          setUrls((prev) => ({ ...prev, [path]: objectUrl }));
        } catch {
          if (mounted.current) setFailed((prev) => new Set(prev).add(path));
        }
      })();
    }
    // `key` stands for `paths`: a new array with the same paths must not refetch.
  }, [key]);

  // Revoked once, on unmount: the URLs are shared by the cover and the viewer.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const url of Object.values(made.current)) URL.revokeObjectURL(url);
      made.current = {};
      asked.current = new Set();
    };
  }, []);

  return { urls, failed };
}

