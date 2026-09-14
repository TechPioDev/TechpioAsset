/**
 * The phone-only half of the asset detail screen.
 *
 * Every label the web page also shows comes from `@techpioasset/domain`
 * (asset-detail.ts) so the two cannot drift. What lives here is what only the
 * phone needs: the software list arrives page by page and is searched on the
 * device, and a warranty page opened in the system browser cannot be handed a
 * copied serial the way the web's clipboard can.
 */

/** The API's page-size ceiling - fewest round trips for a long software list. */
export const SOFTWARE_PAGE_SIZE = 100;

/**
 * Stop after this many pages. A workstation with a thousand installed packages
 * is already far past anything a person scrolls on a phone, and an unbounded
 * loop is one bad `totalItems` away from never finishing.
 */
export const SOFTWARE_MAX_PAGES = 10;

/** Rows mounted at once; past this the list asks for a search instead. */
export const SOFTWARE_RENDER_MAX = 200;

export interface SoftwareRow {
  id: string;
  name: string;
  version: string | null;
  publisher: string | null;
}

/**
 * The mobile client drops the page meta, so a short page is what says "that was
 * the last one"; the page cap stops the loop regardless.
 */
export function hasMoreSoftware(lastPageLength: number, pagesLoaded: number): boolean {
  return lastPageLength === SOFTWARE_PAGE_SIZE && pagesLoaded < SOFTWARE_MAX_PAGES;
}

/** Case-insensitive match on application name or publisher; blank shows all. */
export function filterSoftware<T extends SoftwareRow>(rows: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter(
    (r) => r.name.toLowerCase().includes(q) || (r.publisher ?? '').toLowerCase().includes(q),
  );
}

/**
 * What to tell the technician before opening a vendor's warranty page.
 *
 * Dell and Lenovo resolve the device from the link itself, so those simply
 * open. The form-based vendors need the serial typed in on arrival: the web
 * copies it to the clipboard, which this app has no module for, so the phone
 * shows it first instead. Null means "just open it".
 */
export function warrantyCheckNotice(
  source: { label: string; serialInUrl: boolean },
  serial: string | null | undefined,
): string | null {
  if (source.serialInUrl || !serial) return null;
  return `Enter serial ${serial} on the ${source.label} page.`;
}

/**
 * The asset's holder as the web names them: the asset's assigned user first
 * (imported records have one without any handover), falling back to the open
 * assignment's user.
 */
export function holderDisplayName(
  assignedUser: { email: string; profile: { firstName: string; lastName: string } | null } | null | undefined,
  openAssignmentUser?: { email: string; profile: { firstName: string; lastName: string } | null } | null,
): string | null {
  const who = assignedUser ?? openAssignmentUser ?? null;
  if (!who) return null;
  return who.profile ? `${who.profile.firstName} ${who.profile.lastName}` : who.email;
}
