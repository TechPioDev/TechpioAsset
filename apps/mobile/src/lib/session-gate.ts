/**
 * Which screens need a signed-in, UNLOCKED session (v2.78).
 *
 * The biometric lock was only enforced by the start screen, which sends a
 * locked session to the unlock prompt. A screen opened any other way - a link
 * into the app (techpioasset://request/...) or a reload of the web build -
 * rendered straight away, and the API client quietly refreshed the stored
 * session behind it, so records loaded without the unlock ever being asked
 * for. Notification buttons (Approve, Confirm receipt) made that matter more:
 * they must sit behind the lock, never beside it.
 *
 * Everything is protected except the three screens that exist to get you in.
 */
export type SessionStatus = 'loading' | 'authenticated' | 'anonymous' | 'locked';

const PUBLIC_SCREENS: ReadonlySet<string> = new Set(['', 'index', 'login', 'forgot-password']);

/** Where to send this session instead, or null to let it through. */
export function gateRedirect(status: SessionStatus, segments: readonly string[]): '/login' | null {
  // Still reading the keychain: nothing is known yet, so nothing is decided.
  if (status === 'loading' || status === 'authenticated') return null;
  const first = segments[0] ?? '';
  return PUBLIC_SCREENS.has(first) ? null : '/login';
}
