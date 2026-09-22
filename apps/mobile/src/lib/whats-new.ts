/**
 * "What's new" after an update (Phase 5, v2.81 / app 0.3.36).
 *
 * People install a new APK because the banner asked them to, and then have no
 * idea what changed - so the buttons that appeared on their notifications last
 * week went unnoticed. This is the short list shown once, after an update, of
 * what they can now do. Written for the person holding the phone: what they
 * will see, not how it was built.
 *
 * Newest first. Only versions worth telling someone about are listed; a
 * release with nothing visible simply has no entry and shows nothing.
 */
export interface ReleaseNotes {
  version: string;
  items: { icon: string; title: string; body: string }[];
}

export const WHATS_NEW: readonly ReleaseNotes[] = [
  {
    version: '0.3.37',
    items: [
      {
        icon: 'cloud-offline-outline',
        title: 'Works with no signal',
        body: 'Record a handover, a return or a stock count with no connection. It is sent as soon as you are back online.',
      },
      {
        icon: 'alert-circle-outline',
        title: 'Nothing overwritten',
        body: 'If someone else changed the same asset first, yours is held back and shown to you - never applied on top.',
      },
      {
        icon: 'layers-outline',
        title: 'Count stock',
        body: 'Tap Count on any stock line to record what is on the shelf.',
      },
    ],
  },
  {
    version: '0.3.36',
    items: [
      {
        icon: 'apps-outline',
        title: 'Shortcuts on the app icon',
        body: 'Press and hold the PioAssets icon for Scan, New request and My equipment.',
      },
      {
        icon: 'sparkles-outline',
        title: 'This screen',
        body: 'After each update, a short list of what changed. It shows once.',
      },
    ],
  },
  {
    version: '0.3.35',
    items: [
      {
        icon: 'warning-outline',
        title: 'Report a problem',
        body: 'From Home: pick the item and what is wrong, add a photo, send. IT gets it straight away.',
      },
      {
        icon: 'checkmark-circle-outline',
        title: 'Confirm what you received',
        body: 'Anything handed to you waits at the top of Home until you confirm it.',
      },
    ],
  },
  {
    version: '0.3.34',
    items: [
      {
        icon: 'notifications-outline',
        title: 'Act from the notification',
        body: 'Approve or reject a request, or confirm receipt, from the notification itself.',
      },
      {
        icon: 'search-outline',
        title: 'Search by name',
        body: 'Type a colleague’s name to find what they hold and the requests they raised.',
      },
    ],
  },
];

/** At most this many releases at once: somebody three updates behind needs the gist, not a history. */
const MAX_RELEASES = 3;

function compare(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * What to show now. `lastSeen` is the version whose notes were last shown on
 * this phone; null means never - either a fresh install or a phone updating
 * from before this screen existed. Both are shown the current release only.
 */
export function notesToShow(current: string, lastSeen: string | null): ReleaseNotes[] {
  if (lastSeen && compare(lastSeen, current) >= 0) return [];
  return WHATS_NEW.filter(
    (r) =>
      compare(r.version, current) <= 0 &&
      (lastSeen ? compare(r.version, lastSeen) > 0 : r.version === current),
  ).slice(0, MAX_RELEASES);
}

export const WHATS_NEW_SEEN_KEY = 'whatsNew.lastSeen';
