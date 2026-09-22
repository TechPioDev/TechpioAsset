/**
 * Tablet layout (Phase 7, v2.83 / app 0.3.38).
 *
 * The IT desk and the store room run the app on a tablet, where a full-width
 * list and a separate detail screen waste half the glass and make every
 * lookup a round trip. From this width up, lists keep the chosen item open
 * beside them. Measured in the window's current width, so a tablet held
 * upright or a phone turned sideways gets whichever layout actually fits.
 */
export const TABLET_MIN_WIDTH = 768;

/** Below this shortest side a device is a phone and stays upright. */
export const TABLET_MIN_SHORT_SIDE = 600;

export function isTabletWidth(width: number): boolean {
  return width >= TABLET_MIN_WIDTH;
}

/** A phone-sized device (by its shortest side, whichever way it is held). */
export function isPhoneSized(width: number, height: number): boolean {
  return Math.min(width, height) < TABLET_MIN_SHORT_SIDE;
}

/** The list column: a third of the screen, never cramped, never most of it. */
export function listPaneWidth(width: number): number {
  return Math.round(Math.min(440, Math.max(320, width * 0.36)));
}

/** How many cards sit side by side in a grid at this width. */
export function gridColumns(width: number): number {
  if (width >= 1200) return 4;
  if (width >= TABLET_MIN_WIDTH) return 3;
  return 2;
}
