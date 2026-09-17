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
