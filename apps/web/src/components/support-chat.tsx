'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';

/**
 * The PioTrack support chat, on public pages only (v2.31).
 *
 * WHY AN ALLOWLIST AND NOT AN EXCLUSION
 *
 * The obvious implementation is "load everywhere except the signed-in app".
 * That is one forgotten prefix away from putting a third-party script on a page
 * showing staff names, emails, phone numbers and who holds which laptop - and
 * the failure is silent, because the widget would look like it was working
 * exactly as intended.
 *
 * So the rule is inverted: a route gets the widget only by being named here.
 * A new authenticated screen cannot acquire it by accident; a new public one
 * has to be added deliberately, which is the direction the mistake should run.
 *
 * The script is third-party and loads into the page's own origin, so it can
 * read the DOM and browser storage of any page it runs on. On /login that is a
 * form; on /people it would be the staff directory.
 */

/**
 * Public routes, matched as prefixes.
 *
 * `/` is exact-matched - as a prefix it would match every route in the app.
 */
const PUBLIC_PREFIXES = [
  // Marketing.
  '/about',
  '/contact',
  '/features',
  '/feedback',
  '/guides',
  '/how-it-works',
  // Ways in. A person locked out of login is the likeliest reason this widget
  // exists at all, so these matter more than the marketing pages do.
  '/login',
  '/forgot-password',
  '/reset-password',
  '/accept-invite',
];

const WIDGET_SRC = 'https://piotrack.com:8443/widget/piotrack-chat.js';
const WIDGET_ID = 'wc_bokfg1y9zfafyzsrqalxpvbq';

/**
 * Cross from a public page into the signed-in app with a FULL page load.
 *
 * A third-party script cannot be unloaded once it has run. This one appends its
 * UI as a sibling of the React root, so unmounting the component below removes
 * nothing: the widget would keep running straight through a client-side
 * navigation from /login into the dashboard - which is exactly the page the
 * allowlist exists to keep it off.
 *
 * A fresh document is the only reliable teardown. It costs one reload at the
 * sign-in boundary, which is a good place for one anyway: nothing accumulated
 * before authentication survives into the session.
 */
export function leaveForApp(path = '/dashboard'): void {
  window.location.replace(path);
}

export function isPublicRoute(pathname: string): boolean {
  if (pathname === '/') return true;
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function SupportChat() {
  const pathname = usePathname();
  const [loaded, setLoaded] = useState(false);
  const active = isPublicRoute(pathname ?? '');

  /**
   * Reserve the corner the bubble sits in, but only once it is really there.
   *
   * The widget is a 60px circle inset 20px from the bottom-right, so it covers
   * an 80px corner of the viewport - which was landing on the "Support" link in
   * the login footer and on the last line of the marketing one. The space is
   * reserved through a CSS variable rather than hard-coded padding because the
   * widget is served from a host that may not answer (see the note in the PR):
   * keyed on `onLoad`, a dead host leaves the layout exactly as it was instead
   * of an unexplained gap at the bottom of every public page.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (active && loaded) root.dataset.supportChat = 'on';
    else delete root.dataset.supportChat;
    return () => {
      delete root.dataset.supportChat;
    };
  }, [active, loaded]);

  if (!active) return null;

  return (
    <Script
      src={WIDGET_SRC}
      data-widget={WIDGET_ID}
      // afterInteractive rather than the snippet's plain `async`: the page is
      // rendered by Next, and a support widget must never compete with the
      // login form for the main thread.
      strategy="afterInteractive"
      onLoad={() => setLoaded(true)}
    />
  );
}
