/**
 * Buttons on a phone notification (Phase 2, v2.78).
 *
 * The server names a category on the push; the phone has registered what
 * buttons each category shows. Both sides read this file, so a button the
 * server asks for is always one the phone knows how to handle.
 *
 * Every button OPENS the app. None of them acts unseen: an approval or a
 * receipt is a record somebody may be asked to stand behind, so the button
 * lands on the screen that already offers the action, with the action ready,
 * behind the app's biometric unlock. The screen still checks the person may
 * do it - a button on a notification is never a way round a rule.
 */

export const PUSH_CATEGORY = {
  /** An approval step waiting on the recipient. */
  approval: 'approval',
  /** An asset handed to the recipient, not yet confirmed as received. */
  receipt: 'receipt',
} as const;
export type PushCategory = (typeof PUSH_CATEGORY)[keyof typeof PUSH_CATEGORY];

export const PUSH_ACTION = {
  approve: 'approve',
  reject: 'reject',
  confirmReceipt: 'confirm-receipt',
} as const;
export type PushAction = (typeof PUSH_ACTION)[keyof typeof PUSH_ACTION];

export interface PushButton {
  identifier: PushAction;
  title: string;
}

/** What each category shows, in order. */
export const PUSH_CATEGORY_BUTTONS: Readonly<Record<PushCategory, readonly PushButton[]>> = {
  approval: [
    { identifier: 'approve', title: 'Approve' },
    { identifier: 'reject', title: 'Reject' },
  ],
  receipt: [{ identifier: 'confirm-receipt', title: 'Confirm receipt' }],
};

/** Ids are cuids; anything else in a push is not followed. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function idFrom(
  data: Readonly<Record<string, unknown>> | null | undefined,
  key: string,
): string | null {
  const value = data?.[key];
  return typeof value === 'string' && ID.test(value) ? value : null;
}

/**
 * Where a tapped BUTTON leads on the phone, or null when the tap was on the
 * notification itself (or a button this build does not know) - the caller
 * then follows the notification's ordinary link.
 */
export function pushActionRoute(
  actionIdentifier: string | null | undefined,
  data: Readonly<Record<string, unknown>> | null | undefined,
): string | null {
  if (actionIdentifier === PUSH_ACTION.approve || actionIdentifier === PUSH_ACTION.reject) {
    const requestId = idFrom(data, 'requestId');
    return requestId ? `/request/${requestId}?action=${actionIdentifier}` : null;
  }
  if (actionIdentifier === PUSH_ACTION.confirmReceipt) {
    const assetId = idFrom(data, 'assetId');
    return assetId ? `/asset/${assetId}?action=${PUSH_ACTION.confirmReceipt}` : null;
  }
  return null;
}

/**
 * Where tapping the notification itself leads when its web link has no phone
 * screen: "your laptop is assigned to you" links to the web's My assets page,
 * which the phone does not have - the asset itself is the better landing.
 */
export function pushFallbackRoute(
  data: Readonly<Record<string, unknown>> | null | undefined,
): string | null {
  const assetId = idFrom(data, 'assetId');
  if (assetId) return `/asset/${assetId}`;
  const requestId = idFrom(data, 'requestId');
  return requestId ? `/request/${requestId}` : null;
}
