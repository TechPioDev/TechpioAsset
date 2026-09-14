/**
 * Where tapping a notification should take you on the phone (v2.55).
 *
 * The server writes one link per notification, and it is the web app's path:
 * `/catalogue/abc`, `/requests/xyz`. The phone's screens are named differently -
 * `/offer/abc`, `/request/xyz` - so the link has to be translated before it can
 * be followed.
 *
 * Before this, nothing followed it at all. Tapping a push opened the app on
 * whichever screen it was last left on, which for a supplier told that an offer
 * was rejected meant hunting for the offer to find out why.
 *
 * Returns null for a link with no phone equivalent - an invite, a password
 * reset - rather than guessing. Opening the app is still better than landing
 * on a screen that says "not found".
 */

/** Web collection -> [phone list route, phone detail route prefix]. */
const ROUTES: Readonly<Record<string, readonly [string, string | null]>> = {
  catalogue: ['/(tabs)/catalogue', '/offer'],
  requests: ['/(tabs)/requests', '/request'],
  assets: ['/(tabs)/assets', '/asset'],
  licenses: ['/licenses', '/license'],
  people: ['/people', '/person'],
  maintenance: ['/maintenance', '/work-order'],
  inventory: ['/(tabs)/inventory', null],
  procurement: ['/purchase-orders', '/purchase-order'],
  invoices: ['/invoices', '/invoice'],
};

/** Whole web paths with their own phone screen that the table above cannot express. */
const EXACT: Readonly<Record<string, string>> = {
  '/people/invitations': '/people-invitations',
  '/settings/security': '/settings/security',
};

/** Ids look like cuids; anything with a dot or a nested segment is not one. */
const ID = /^[A-Za-z0-9_-]+$/;

export function notificationRoute(linkPath: unknown): string | null {
  if (typeof linkPath !== 'string') return null;

  // Drop any query or fragment: the phone's screens take the id, not the web's
  // filters, and carrying them across would pass parameters nothing reads.
  const path = linkPath.split(/[?#]/)[0]!.trim();
  if (!path.startsWith('/')) return null;
  const exact = EXACT[path.replace(/\/+$/, '')];
  if (exact) return exact;

  const [collection, id, ...rest] = path.slice(1).split('/').filter(Boolean);
  if (!collection) return null;

  const route = ROUTES[collection];
  if (!route) return null;
  const [list, detail] = route;

  // `/catalogue` alone, or a web sub-page such as `/catalogue/import` that the
  // phone does not have: the list is the honest nearest place.
  if (!id || rest.length > 0 || !detail || !ID.test(id)) return list;

  // A few web collections use named sub-pages that are not ids. Sending those
  // to the detail screen would ask for a record called "new".
  if (['new', 'import', 'compare', 'company', 'invitations', 'edit'].includes(id)) return list;

  return `${detail}/${id}`;
}
