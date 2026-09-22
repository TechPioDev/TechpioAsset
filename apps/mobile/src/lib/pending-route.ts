/**
 * Where a link into the app was going when the lock stopped it (v2.81).
 *
 * Long-press "Scan" on the icon opens the app on /scan. If the app is locked
 * the session gate sends it to the unlock prompt first - and before this, the
 * destination was dropped there, so every shortcut landed on Home. The gate
 * remembers it here; the sign-in screen takes it once unlocked. One slot, used
 * once: an old destination must never reappear after a later sign-in.
 */
const PUBLIC = new Set(['/', '/login', '/forgot-password', '/index']);
let pending: string | null = null;

export function rememberDestination(pathname: string | null | undefined): void {
  if (!pathname || PUBLIC.has(pathname) || !pathname.startsWith('/')) return;
  pending = pathname;
}

export function takeDestination(): string | null {
  const next = pending;
  pending = null;
  return next;
}
