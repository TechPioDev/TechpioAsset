/**
 * The asset's own photographs (v2.65): how many, and what size fits.
 *
 * The owner looked at a phone photo filling the detail page's lead box and saw
 * the top of the laptop cut off: the box is twice as wide as it is tall, and a
 * phone photograph is not. Two answers, both here so the web, the phone and
 * the API say the same thing:
 *
 *  - the upload control states the exact size that fits the box, and says so
 *    again, with the picture's own dimensions, when one that does not fit is
 *    chosen;
 *  - an asset holds at most five of them, and replacing one deletes the file
 *    it replaces.
 */

/** At most this many photographs of one unit. */
export const MAX_ASSET_PHOTOS = 5;

/** The lead box is this shape, on the web and on the phone. */
export const ASSET_PHOTO_ASPECT = 2;

/** The exact size that fills the lead box edge to edge. */
export const ASSET_PHOTO_BEST_WIDTH = 1600;
export const ASSET_PHOTO_BEST_HEIGHT = 800;

/** What the server accepts, in megabytes (the controller's 15 MB ceiling). */
export const ASSET_PHOTO_MAX_MB = 15;

/** "1600 × 800 px" */
export function assetPhotoBestSize(): string {
  return `${ASSET_PHOTO_BEST_WIDTH} × ${ASSET_PHOTO_BEST_HEIGHT} px`;
}

/** The line under the upload control. */
export function assetPhotoHint(count: number): string {
  return (
    `Best size ${assetPhotoBestSize()} (landscape, 2:1) - JPG, PNG or WebP, up to ` +
    `${ASSET_PHOTO_MAX_MB} MB. ${assetPhotoCountLabel(count)}.`
  );
}

/** "2 of 5 photos" */
export function assetPhotoCountLabel(count: number): string {
  return `${Math.min(count, MAX_ASSET_PHOTOS)} of ${MAX_ASSET_PHOTOS} photos`;
}

/** Whether another photograph may be added, as opposed to replacing one. */
export function canAddAssetPhoto(count: number): boolean {
  return count < MAX_ASSET_PHOTOS;
}

/** Said in place of an upload when the asset already holds five. */
export function assetPhotoLimitMessage(): string {
  return `An asset holds at most ${MAX_ASSET_PHOTOS} photos. Replace or remove one to add another.`;
}

/**
 * Whether a picture of these dimensions fills the lead box without much lost.
 * A tenth either way is not visible; a portrait phone photo (0.75) is.
 */
export function fitsAssetPhotoBox(width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return true;
  const ratio = width / height;
  return Math.abs(ratio - ASSET_PHOTO_ASPECT) / ASSET_PHOTO_ASPECT <= 0.1;
}

/**
 * What to tell somebody who has just uploaded a picture, given its size; null
 * when it fits and there is nothing to add. The upload is never refused for
 * its shape: a photo that shows the unit whole with a border is still worth
 * more than no photo.
 */
export function assetPhotoFitNotice(width: number, height: number): string | null {
  if (fitsAssetPhotoBox(width, height)) return null;
  return (
    `This picture is ${Math.round(width)} × ${Math.round(height)} px. The box is 2:1, so it is ` +
    `shown whole with a soft border; ${assetPhotoBestSize()} fills it exactly.`
  );
}

/** One stored photograph of the unit, as GET /assets/:id lists it. */
export interface AssetOwnPhoto {
  id: string;
  createdAt: string;
  sizeBytes?: number | null;
}

/** "840 KB", "2.4 MB" - the size shown beside each photograph. */
export function photoSizeLabel(bytes: number | null | undefined): string | null {
  if (bytes == null || !(bytes >= 0)) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
