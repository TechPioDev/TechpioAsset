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

/** The two fields of GET /assets/:id this reads; `photos` arrived with v2.65. */
export interface AssetPhotoFields {
  photo?: { id: string; createdAt: string; sizeBytes?: number | null } | null;
  photos?: readonly { id: string; createdAt: string; sizeBytes?: number | null }[] | null;
}

/**
 * Every photograph of the unit, the cover first - the order the API sends and
 * the order the slideshow walks. An API that predates v2.65 sends only `photo`
 * (the app can reach a phone before the server is updated), and that one
 * picture is then the whole list.
 */
export function unitPhotos(asset: AssetPhotoFields): AssetOwnPhoto[] {
  const list = asset.photos ?? (asset.photo ? [asset.photo] : []);
  return list.map((p) => ({ id: p.id, createdAt: p.createdAt, sizeBytes: p.sizeBytes ?? null }));
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

/** POST here makes the photograph the cover. */
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

export type UnitPhotoActionKey = 'replace' | 'cover' | 'remove';

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
 * What a tap on a thumbnail offers. "Make cover" is left out for the photo
 * that already is the cover, and against a legacy API, which has one photo and
 * no such route.
 */
export function unitPhotoActions(input: { isCover: boolean; legacy?: boolean }): UnitPhotoAction[] {
  const actions: UnitPhotoAction[] = [
    {
      key: 'replace',
      label: 'Replace',
      icon: 'swap-horizontal-outline',
      hint: REPLACE_DELETES_OLD,
    },
  ];
  if (!input.isCover && !input.legacy) {
    actions.push({
      key: 'cover',
      label: 'Make cover',
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

/** "Photo 2 of 3, cover" - what a screen reader says for a thumbnail. */
export function unitPhotoLabel(index: number, count: number): string {
  return `Photo ${index + 1} of ${count}${index === 0 ? ', cover' : ''}`;
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
 * and what the asset shows afterwards: the next photo as cover, or - with none
 * left - whatever the image rule falls back to.
 */
export function removePhotoPrompt(input: { isCover: boolean; count: number }): Required<PhotoAlert> {
  const deleted = 'The file is deleted and cannot be brought back.';
  const remaining = input.count - 1;
  if (remaining <= 0) {
    return {
      title: 'Remove this photo?',
      message: `${deleted} The asset goes back to its catalogue picture or an illustration.`,
    };
  }
  return {
    title: 'Remove this photo?',
    message: input.isCover ? `${deleted} The oldest photo left becomes the cover.` : deleted,
  };
}
