import { ISSUE_CATEGORIES, findIssueCategory } from '@techpioasset/domain';

/**
 * "Report a problem" on the phone (Phase 4, v2.80).
 *
 * The web has had a catalogue-driven "Report an issue" since v2.14; the phone
 * made an employee type out a whole new-request form. This is the phone's
 * front door to the SAME thing: the catalogue decides the request type and
 * how urgent it starts, the request goes through the ordinary approval
 * workflow, and the photo travels as the conversation's first message exactly
 * as it does from the New request form.
 */

/**
 * What is offered, in catalogue order. "Replacement request" is left out: a
 * replacement is a decision to ask for, not a fault to report, and the New
 * request form already asks for one properly.
 */
export const PROBLEM_CATEGORIES = ISSUE_CATEGORIES.filter((c) => c.key !== 'REPLACEMENT');

/** Faults a photo shows. For these the screen offers the camera first. */
const VISIBLE_FAULTS: ReadonlySet<string> = new Set(['DISPLAY', 'HARDWARE_DAMAGE', 'INPUT_DEVICE']);
export function photoHelps(categoryKey: string | null): boolean {
  return categoryKey !== null && VISIBLE_FAULTS.has(categoryKey);
}

export interface ProblemAsset {
  id: string;
  name: string;
  assetTag: string;
}

/**
 * The request the server is sent. The reason always says what and which, so
 * the employee may send without typing a word - the server wants ten
 * characters of reason, and "Display issue on Dell Latitude 5450 (AST-0009)."
 * is a better ten than anything typed in a hurry.
 */
export function problemRequest(
  categoryKey: string,
  asset: ProblemAsset | null,
  words: string,
): {
  type: string;
  priority: string;
  issueCategory: string;
  businessReason: string;
  details: { targetAssetId: string } | null;
} | null {
  const category = findIssueCategory(categoryKey);
  if (!category) return null;
  const about = asset ? ` on ${asset.name} (${asset.assetTag})` : '';
  const said = words.trim();
  return {
    type: category.requestType,
    priority: category.priority,
    issueCategory: category.key,
    businessReason: `${category.label}${about}.${said ? ` ${said}` : ''}`.slice(0, 2000),
    details: asset ? { targetAssetId: asset.id } : null,
  };
}

/** Which asset starts selected: the one it was opened from, or the only one held. */
export function initialAsset(
  assets: readonly ProblemAsset[],
  openedFrom: string | null,
): string | null {
  if (openedFrom && assets.some((a) => a.id === openedFrom)) return openedFrom;
  return assets.length === 1 ? assets[0]!.id : null;
}
