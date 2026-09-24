/**
 * What is on screen, and for how long (U2).
 *
 * The app said everything through `Alert.alert` - 93 of them. A native alert
 * stops the app dead, dims the screen and demands a tap, which is the right
 * treatment for "delete this permanently" and completely wrong for "Saved".
 * Most of those 93 were the app telling you something went fine, or that a
 * request failed and you should try again: information, not a decision.
 *
 * This is the rule set behind the replacement, kept apart from the view so it
 * can be tested - the same split as `tablet-layout-rules` and `theme-tokens`.
 */

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  body?: string;
  /** When it should disappear, in ms since the epoch. */
  expiresAt: number;
}

/**
 * How long each tone stays.
 *
 * An error lingers because it usually carries something to act on - a reason,
 * a thing to try. A success is gone quickly: you did it, you know.
 */
export const TOAST_MS: Record<ToastTone, number> = {
  success: 3000,
  info: 4000,
  error: 6000,
};

/** Never more than this on screen. Beyond it, the oldest goes. */
export const MAX_VISIBLE = 2;

/**
 * Within this window the same message is not stacked twice - its time is
 * extended instead.
 *
 * This is not hypothetical tidiness. With no signal the scanner re-reads the
 * label in view about once a second and reports the same thing each time; as
 * native alerts those queued up behind one another and had to be dismissed
 * one at a time.
 */
export const DEDUPE_MS = 4000;

let counter = 0;

/** Ids only have to be unique within a session, and stable for React keys. */
export function nextToastId(): string {
  counter += 1;
  return `t${counter}`;
}

/**
 * The queue after adding one message.
 *
 * Pure, and takes `now` rather than reading the clock, so the timing rules
 * are testable rather than a matter of waiting around.
 */
export function pushToast(
  current: readonly Toast[],
  incoming: { tone: ToastTone; title: string; body?: string; id?: string },
  now: number,
): Toast[] {
  const live = current.filter((t) => t.expiresAt > now);

  const duplicate = live.find(
    (t) => t.tone === incoming.tone && t.title === incoming.title && t.body === incoming.body,
  );
  if (duplicate && duplicate.expiresAt - now <= DEDUPE_MS + TOAST_MS[incoming.tone]) {
    // Seen again while still showing: hold it a little longer, do not stack.
    return live.map((t) =>
      t.id === duplicate.id ? { ...t, expiresAt: now + TOAST_MS[incoming.tone] } : t,
    );
  }

  const next: Toast = {
    id: incoming.id ?? nextToastId(),
    tone: incoming.tone,
    title: incoming.title,
    body: incoming.body,
    expiresAt: now + TOAST_MS[incoming.tone],
  };
  // The newest is always kept; the oldest is what falls off the end.
  return [...live, next].slice(-MAX_VISIBLE);
}

/** Drops anything whose time is up. */
export function expireToasts(current: readonly Toast[], now: number): Toast[] {
  return current.filter((t) => t.expiresAt > now);
}

/**
 * Which tone a message that used to be a native alert should take.
 *
 * The 93 replaced call sites are overwhelmingly one of two things: "that
 * didn't work" or "that worked". The wording is the tell, and getting it
 * wrong is only a colour, never a lost message - so a title that matches
 * nothing is neutral rather than a guess.
 */
const FAILURE = /\b(could not|couldn't|cannot|can't|failed|not sent|no connection|unavailable|problem|error|denied|refused|too large|not allowed)\b/i;

export function toneForMessage(title: string): ToastTone {
  return FAILURE.test(title) ? 'error' : 'info';
}
