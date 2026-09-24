/**
 * How things move (U4).
 *
 * The app had no motion at all: rows popped in, a row you had just approved
 * vanished between frames, and a screen went from skeleton to content with a
 * hard cut. None of that is broken, but all of it reads as abrupt, and the
 * missing feedback matters most at exactly the moment you have just decided
 * something.
 *
 * Kept pure and separate from the views, like `theme-tokens` and
 * `toast-queue`, so the rules can be tested rather than eyeballed.
 *
 * Two principles behind the numbers. Motion is information, not decoration -
 * every duration here is short enough that nobody waits on it. And a thing
 * leaving is quicker than a thing arriving: once you have decided, the app
 * should get out of the way, whereas something arriving is worth a moment to
 * notice.
 */

/** Base durations in milliseconds. */
export const MOTION = {
  /** Something appearing: a card, a screen's content, a banner. */
  enter: 260,
  /** Something leaving: a row you just approved. */
  exit: 180,
  /** A small state change in place - a chip selecting, a value ticking over. */
  quick: 120,
} as const;

export type MotionRole = keyof typeof MOTION;

/**
 * How long a step should actually take.
 *
 * "Reduce motion" is a real accessibility setting, and people turn it on
 * because movement makes them ill, not because they dislike it. Honouring it
 * means going to the final state immediately - zero, not merely faster - so
 * the result is the same screen with none of the travel.
 */
export function durationFor(role: MotionRole, reduceMotion: boolean): number {
  return reduceMotion ? 0 : MOTION[role];
}

/**
 * The delay before the nth item in a list appears.
 *
 * A stagger makes a list feel like it is being laid out rather than dumped,
 * but only for the first handful: by the tenth row it is just latency, and on
 * a list of two hundred assets it would be absurd. So it caps, and with
 * reduced motion there is none at all.
 */
export const STAGGER_STEP = 40;
export const STAGGER_MAX_ITEMS = 6;

export function staggerDelay(index: number, reduceMotion: boolean): number {
  if (reduceMotion || index < 0) return 0;
  return Math.min(index, STAGGER_MAX_ITEMS) * STAGGER_STEP;
}

/**
 * How far something travels as it arrives, in points.
 *
 * Small on purpose. A card sliding a long way draws attention to the
 * animation; a few points reads as the content settling.
 */
export const ENTER_OFFSET = 10;

export function enterOffset(reduceMotion: boolean): number {
  return reduceMotion ? 0 : ENTER_OFFSET;
}
