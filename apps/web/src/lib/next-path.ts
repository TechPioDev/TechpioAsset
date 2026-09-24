/**
 * Where to go back to after signing in (v2.88).
 *
 * Clicking a link into the app with an expired session took you to sign in and
 * then to the dashboard, losing what you had asked for. That is the same
 * broken promise as a filtered link opening the unfiltered list: you named a
 * page and got a different one. The phone has remembered its destination since
 * 0.3.36 (`lib/pending-route`); this is the web's half.
 *
 * The destination travels on the login URL as `?next=`, and everything here
 * exists to make that safe. A redirect target taken from a URL and followed
 * without checking is an open redirect: send someone
 * `pioassets.com/login?next=https://evil.example/login`, they sign in on a
 * page that looks like ours and hand their password to somebody else. So the
 * rule is deliberately narrow - a path inside this app, and nothing else.
 */

/** Pages that exist to get you IN; sending you back to one would loop. */
const AUTH_PAGES = ['/login', '/forgot-password', '/reset-password', '/accept-invite'];

/** Long enough for any real page and its filters, short enough to bound. */
const MAX_LENGTH = 512;

/**
 * The destination, if it is one we are willing to follow; null otherwise.
 *
 * Accepts only a path on this origin. Rejected, each for its own reason:
 *
 * - `https://evil.example` and any `scheme:` - a different site entirely.
 * - `//evil.example` - protocol-relative, which the browser reads as another
 *   origin even though it starts with a slash.
 * - `/\evil.example` and `\\evil.example` - browsers normalise the backslash
 *   to a slash, so this is the line above wearing a hat.
 * - anything not starting with `/` - relative to wherever we happen to be.
 * - control characters, newlines, tabs - header and parser tricks.
 * - the sign-in pages themselves - a loop.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value.length > MAX_LENGTH) return null;

  // Control characters and whitespace anywhere: never legitimate in a path we
  // built ourselves, and the cheapest way to smuggle something past a check.
  // Written as a scan rather than a regex - a literal control character inside
  // one is exactly the sort of thing a linter is right to object to.
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f || ch.trim() === '') return null;
  }

  // Must be an absolute path on this origin, and only one leading slash.
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  if (value.includes('\\')) return null;

  // A scheme anywhere means it is trying to leave, however it is dressed up.
  if (value.includes(':')) return null;

  const path = value.split(/[?#]/)[0] ?? value;
  if (AUTH_PAGES.some((p) => path === p || path.startsWith(`${p}/`))) return null;

  return value;
}

/**
 * The sign-in URL that remembers where someone was going.
 *
 * A destination we would refuse on the way back is simply not carried, so the
 * URL never advertises a target that cannot work.
 */
export function loginHref(pathname: string, search = ''): string {
  const target = safeNextPath(`${pathname}${search}`);
  return target ? `/login?next=${encodeURIComponent(target)}` : '/login';
}
