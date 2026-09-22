import Constants from 'expo-constants';
import { useRouter, useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useSession } from '../providers/session';
import { SqliteStore } from '../lib/sqlite-store';
import { WHATS_NEW_SEEN_KEY, notesToShow } from '../lib/whats-new';

const store = new SqliteStore();

/**
 * Opens "What's new" once after an update (Phase 5, v2.81). Renders nothing.
 *
 * Waits for a signed-in, unlocked session and for the app to be past the
 * sign-in screen, then looks once per launch. The version is recorded as seen
 * the moment the screen opens, so backing out of it still counts - it is a
 * note, not a form to complete.
 */
export function WhatsNewGate() {
  const { status } = useSession();
  const segments = useSegments();
  const router = useRouter();
  const checked = useRef(false);
  const onSignIn = segments[0] === 'login' || segments[0] === undefined;

  useEffect(() => {
    if (status !== 'authenticated' || onSignIn || checked.current) return;
    checked.current = true;
    const current = Constants.expoConfig?.version;
    if (!current) return;
    void (async () => {
      try {
        const lastSeen = await store.get(WHATS_NEW_SEEN_KEY);
        if (notesToShow(current, lastSeen).length === 0) {
          if (lastSeen !== current) await store.set(WHATS_NEW_SEEN_KEY, current);
          return;
        }
        await store.set(WHATS_NEW_SEEN_KEY, current);
        router.push(`/whats-new?from=${encodeURIComponent(lastSeen ?? '')}` as never);
      } catch {
        // Storage unavailable: skip the note rather than risk showing it every launch.
      }
    })();
  }, [status, onSignIn, router]);

  return null;
}
