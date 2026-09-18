import {
  assetPhotoFitNotice,
  assetPhotoLimitMessage,
  canAddAssetPhoto,
  type AssetOwnPhoto,
} from '@techpioasset/domain';
import type { IconName } from '../components/ui';

/**
 * The phone's half of "up to five photos of the unit" (v2.65).
 *
 * How many an asset may hold, the exact size that fills the lead box and what
 * to say about a picture that does not are the domain package's rules
 * (asset-photo-rules.ts there), shared with the web and the API. What lives
 * here is the phone's own: reading the list off GET /assets/:id whichever API
 * answered, the routes each action goes to, what the per-photo sheet offers,
 * and the words of the alerts. Nothing here touches React Native, so all of it
 * runs under vitest.
 */

// ---------------------------------------------------------------------------
// Reading the list
// ---------------------------------------------------------------------------

/**
 * The two fields of GET /assets/:id this reads; `photos` arrived with v2.65.
 *
 * v2.66: `photo` is the asset's PRIMARY picture, and no longer always one of
 * the unit's own photographs - the owner may choose a handover or return photo.
 * `entityType` says which: 'AssetPhoto' for a photo of the unit, otherwise the
 * custody record a condition photo is filed under.
 */
export interface AssetPhotoFields {
  photo?: { id: string; createdAt: string; sizeBytes?: number | null; entityType?: string | null } | null;
  photos?: readonly { id: string; createdAt: string; sizeBytes?: number | null }[] | null;
}

/** What `photo.entityType` says for a photograph of the unit (v2.66). */
const UNIT_PHOTO_ENTITY = 'AssetPhoto';

/**
 * Every photograph of the unit, in the order the API sends - the primary first
 * when it is one of them. An API that predates v2.65 sends only `photo` (the
 * app can reach a phone before the server is updated), and that one picture is
 * then the whole list.
 *
 * v2.66: the list is believed whenever the server sent one, EVEN EMPTY. With a
 * handover photo chosen as the primary and no photos of the unit, `photos` is
 * [] and `photo` is that handover photo; falling back to `[photo]` there would
 * file a condition photo under "Photos of this unit", offer to replace or
 * delete it through routes that do not own it, and show it twice in the
 * slideshow. The fallback is for a missing list only, and only ever for a
 * photo of the unit.
 */
export function unitPhotos(asset: AssetPhotoFields): AssetOwnPhoto[] {
  const legacy =
    asset.photo && (asset.photo.entityType == null || asset.photo.entityType === UNIT_PHOTO_ENTITY)
      ? [asset.photo]
      : [];
  const list = asset.photos ?? legacy;
  return list.map((p) => ({ id: p.id, createdAt: p.createdAt, sizeBytes: p.sizeBytes ?? null }));
}

/**
 * The attachment id of the asset's primary picture, or null when nobody has
 * chosen one (v2.66). It may be a photo of the unit or a condition photo; the
 * "Primary" mark in the strip and the badge in the viewer both follow this id,
 * never "first in the list" - with a condition photo as the primary, or none
 * chosen, no thumbnail in the strip is marked.
 */
export function primaryPhotoId(asset: AssetPhotoFields): string | null {
  return asset.photo?.id ?? null;
}

/**
 * Whether the API that answered predates v2.65: it lists no `photos`, and has
 * none of the unit-photos routes either. The card then keeps to the one-photo
 * routes that API does have, rather than offering buttons that would 404.
 */
export function usesLegacyPhotoRoutes(asset: AssetPhotoFields): boolean {
  return asset.photos == null;
}

/**
 * Why "Add photo" is switched off, or null when another may be added. The
 * limit and its wording are the domain's - the same sentence the server sends
 * with its 400 - so the button and a refusal never disagree. A legacy API
 * keeps one photo, and its upload route would silently overwrite it: there the
 * one photo is replaced from its thumbnail, knowingly, and not by "Add".
 */
export function addPhotoRefusal(count: number, legacy = false): string | null {
  if (legacy) {
    return count >= 1
      ? 'This server keeps one photo per asset until it is updated. Replace or remove that one instead.'
      : null;
  }
  return canAddAssetPhoto(count) ? null : assetPhotoLimitMessage();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Where an upload goes. `replaceId` swaps that photograph - the server deletes
 * the old file itself, so there is no second call to make. The legacy route
 * holds one photo and always replaces it.
 */
export function unitPhotoUploadPath(assetId: string, replaceId: string | null, legacy = false): string {
  if (legacy) return `/assets/${assetId}/photo`;
  const base = `/assets/${assetId}/unit-photos`;
  return replaceId ? `${base}?replace=${encodeURIComponent(replaceId)}` : base;
}

/** DELETE here removes the photograph and its file. */
export function unitPhotoRemovePath(assetId: string, photoId: string, legacy = false): string {
  return legacy ? `/assets/${assetId}/photo` : `/assets/${assetId}/unit-photos/${photoId}`;
}

/**
 * POST here makes a photograph of the unit the primary picture. v2.65's route,
 * kept for the strip because a v2.65 server has it too; on v2.66 it does
 * exactly what PATCH /assets/:id/primary-photo does (lib/primary-photo.ts),
 * which the full-size viewer uses since it must also reach condition photos.
 */
export function unitPhotoCoverPath(assetId: string, photoId: string): string {
  return `/assets/${assetId}/unit-photos/${photoId}/cover`;
}

/** The bytes, for a thumbnail - the same route the slideshow reads. */
export function unitPhotoImagePath(assetId: string, photoId: string): string {
  return `/assets/${assetId}/photos/${photoId}`;
}

// ---------------------------------------------------------------------------
// The per-photo sheet
// ---------------------------------------------------------------------------

export type UnitPhotoActionKey = 'replace' | 'primary' | 'remove';

export interface UnitPhotoAction {
  key: UnitPhotoActionKey;
  label: string;
  icon: IconName;
  /** The small line under the label: what the action does to the stored file. */
  hint: string;
  destructive?: boolean;
}

/** Said wherever a replacement is offered: the owner asked that it be automatic, and known. */
export const REPLACE_DELETES_OLD = 'The old picture is deleted automatically when the new one is saved.';

/**
 * What a tap on a thumbnail offers. "Set as primary" is left out for the photo
 * that already is the primary, and against a legacy API, which has one photo
 * and no such route. Until v2.66 this read "Make cover"; the app now says
 * "primary" everywhere, the word the viewer and the web use.
 */
export function unitPhotoActions(input: { isPrimary: boolean; legacy?: boolean }): UnitPhotoAction[] {
  const actions: UnitPhotoAction[] = [
    {
      key: 'replace',
      label: 'Replace',
      icon: 'swap-horizontal-outline',
      hint: REPLACE_DELETES_OLD,
    },
  ];
  if (!input.isPrimary && !input.legacy) {
    actions.push({
      key: 'primary',
      label: 'Set as primary',
      icon: 'star-outline',
      hint: 'Shown first on the asset, and as its thumbnail.',
    });
  }
  actions.push({
    key: 'remove',
    label: 'Remove',
    icon: 'trash-outline',
    hint: 'The file is deleted.',
    destructive: true,
  });
  return actions;
}

/**
 * "Photo 2 of 3, primary" - what a screen reader says for a thumbnail. The
 * mark follows the primary id, not the position: the first photo in the strip
 * is not the primary when a condition photo is, or when none is chosen.
 */
export function unitPhotoLabel(index: number, count: number, isPrimary = false): string {
  return `Photo ${index + 1} of ${count}${isPrimary ? ', primary' : ''}`;
}

/** Under the strip: what a tap on a thumbnail offers, in one line. */
export function unitPhotoStripHint(legacy = false): string {
  return legacy
    ? 'Tap the photo to replace or remove it.'
    : 'Tap a photo to replace it, set it as the primary image or remove it.';
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export interface PhotoAlert {
  title: string;
  message?: string;
}

/**
 * What to say once an upload has been saved. The picture's own size is stated
 * when it does not fit the 2:1 box (the domain's assetPhotoFitNotice, which
 * names the exact size that does); a picture that fits gets the plain success.
 * Never a refusal: the photo is already stored by the time this is read.
 */
export function uploadedAlert(input: {
  replaced: boolean;
  dimensions: { width: number; height: number } | null;
}): PhotoAlert {
  const fit = input.dimensions ? assetPhotoFitNotice(input.dimensions.width, input.dimensions.height) : null;
  if (input.replaced) {
    const deleted = 'The old picture has been deleted.';
    return { title: 'Photo replaced', message: fit ? `${deleted}\n\n${fit}` : deleted };
  }
  return fit ? { title: 'Photo added', message: fit } : { title: 'Photo added' };
}

/**
 * The question asked before a photograph is removed. It says the file goes,
 * and what the asset shows afterwards: the oldest photo left as the primary
 * (what the server does when the primary is removed), or - with none left -
 * whatever the image rule falls back to. `isPrimary` follows the primary id
 * (v2.66): removing a unit photo while a handover photo leads changes nothing
 * at the top of the screen, so nothing is said about it.
 */
export function removePhotoPrompt(input: { isPrimary: boolean; count: number }): Required<PhotoAlert> {
  const deleted = 'The file is deleted and cannot be brought back.';
  const remaining = input.count - 1;
  if (!input.isPrimary) return { title: 'Remove this photo?', message: deleted };
  if (remaining <= 0) {
    return {
      title: 'Remove this photo?',
      message: `${deleted} The asset goes back to its catalogue picture, a condition photo or an illustration.`,
    };
  }
  return {
    title: 'Remove this photo?',
    message: `${deleted} The oldest photo left becomes the primary image.`,
  };
}
