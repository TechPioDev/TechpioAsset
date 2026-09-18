import { slidePhotoId, type AssetSlide } from '@techpioasset/domain';

/**
 * The phone's half of "make any image the primary one" (v2.66).
 *
 * The owner asked to pick which picture leads an asset - the one in the lead
 * box, the header thumbnail and the first slide - from ANY photograph on it: a
 * photo of the unit, or a handover or return photo, because the best picture of
 * a laptop is often the one taken when it was handed over. The server keeps one
 * pointer (PATCH /assets/:id/primary-photo) and moves nothing; the order the
 * slideshow walks is the domain's assetSlides, shared with the web.
 *
 * What lives here is what the full-size viewer shows for the slide on screen -
 * a badge, a button or nothing - and the route, body and words that go with it.
 * Nothing here touches React Native, so all of it runs under vitest.
 */

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

/** PATCH here chooses the primary picture, or clears the choice. */
export function primaryPhotoPath(assetId: string): string {
  return `/assets/${assetId}/primary-photo`;
}

/**
 * The body of that PATCH. `null` is sent as null, not left out: it is the
 * instruction to clear the choice, and the page then goes back to its default
 * (the catalogue picture, else the unit's photos, else the newest condition
 * photo).
 */
export function primaryPhotoBody(photoId: string | null): { photoId: string | null } {
  return { photoId };
}

// ---------------------------------------------------------------------------
// What the viewer offers on a slide
// ---------------------------------------------------------------------------

export type PrimaryControl =
  /**
   * This slide is the primary picture: a badge, and beside it the way back
   * (0.3.26). The owner asked for it: an asset with no catalogue listing has
   * no catalogue slide, so without this its choice could be moved but never
   * undone.
   */
  | { kind: 'badge'; label: string; clearLabel: string; busyLabel: string }
  /** Press to make this slide lead. `photoId` null clears the choice. */
  | { kind: 'set'; photoId: string | null; label: string; busyLabel: string };

/**
 * What the viewer shows for one slide, or null for nothing.
 *
 *  - the slide that is the primary picture carries the badge, and "Clear";
 *  - every other photograph - of the unit, or a condition photo - may be set;
 *  - the catalogue picture is not an attachment, so it cannot be "set". It is
 *    what leads when nothing is chosen, so there the offer is to clear the
 *    choice - and only when there is a choice to clear. With none, the
 *    catalogue picture already leads and a button would do nothing.
 */
export function primaryControl(
  slide: Pick<AssetSlide, 'id'>,
  primaryPhotoId: string | null | undefined,
): PrimaryControl | null {
  const id = slidePhotoId(slide);
  const current = primaryPhotoId ?? null;
  if (id === null) {
    return current === null
      ? null
      : { kind: 'set', photoId: null, label: 'Show catalogue picture first', busyLabel: 'Saving…' };
  }
  if (id === current) {
    return { kind: 'badge', label: 'Primary image', clearLabel: 'Clear', busyLabel: 'Clearing…' };
  }
  return { kind: 'set', photoId: id, label: 'Set as primary', busyLabel: 'Saving…' };
}

// ---------------------------------------------------------------------------
// The handover and return photos under the lead box (0.3.27)
// ---------------------------------------------------------------------------

/**
 * The condition photos among a set of slides. The owner looked under the lead
 * box for the primary-image choice on a laptop that had handover photos only,
 * and the strip - unit photos alone - offered nothing. They are listed there
 * too now (web: the Manage photos panel), to be chosen from, not managed:
 * adding and removing them stays in the Condition photos section, with its
 * custody rules.
 */
export function custodySlides<T extends Pick<AssetSlide, 'id'>>(slides: readonly T[]): T[] {
  return slides.filter((slide) => slide.id.startsWith('condition:'));
}

export interface CustodyPhotoAction {
  /** What to send: a photo id to choose it, null to clear the choice. */
  photoId: string | null;
  label: string;
  hint: string;
}

/** The one thing the sheet offers for a handover or return photo. */
export function custodyPhotoAction(photoId: string, primaryPhotoId: string | null | undefined): CustodyPhotoAction {
  return photoId === (primaryPhotoId ?? null)
    ? {
        photoId: null,
        label: 'Clear primary',
        hint: 'The asset goes back to its default picture. The photo itself stays on file.',
      }
    : {
        photoId,
        label: 'Set as primary',
        hint: 'It leads this asset: the box, the header and the slideshow. Nothing is moved or deleted.',
      };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/** What to say once the choice is saved: what changed, and where it shows. */
export function primaryChangedAlert(photoId: string | null): { title: string; message: string } {
  return photoId
    ? { title: 'Primary image set', message: 'It now leads this asset and opens its photos.' }
    : {
        title: 'Primary image cleared',
        message:
          'This asset goes back to its default picture: the catalogue picture if it has one.',
      };
}

/** The title of the alert when the server refuses; its own words are the message. */
export const PRIMARY_FAILED_TITLE = 'Could not set the primary image';
