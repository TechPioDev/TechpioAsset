import { MAX_COMMENT_IMAGES } from '@techpioasset/contracts';
import { formatFileSize } from '@techpioasset/domain';

/**
 * Pictures waiting to go out with a request message (v2.60) - the pure part,
 * kept away from the DOM so it can be tested: what is accepted, how many, how
 * each is captioned, and what the toast says once the message lands.
 */

/** What the server's default ALLOWED_UPLOAD_MIME takes, minus documents. */
export const COMMENT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/heic'] as const;
/** For the file picker: browsers report HEIC with an empty type, so the extension is named too. */
export const COMMENT_IMAGE_ACCEPT = 'image/jpeg,image/png,image/heic,.jpg,.jpeg,.png,.heic';
/** The API's per-file cap for request attachments. */
export const MAX_COMMENT_IMAGE_BYTES = 25 * 1024 * 1024;
export { MAX_COMMENT_IMAGES };

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

export interface PendingImage<F extends FileLike = FileLike> {
  /** Stable key for the list; the same file can be added twice on purpose. */
  key: string;
  file: F;
  caption: string;
}

/** "photo.jpg · 342 KB" - the caption under a thumbnail, pending or sent. */
export function imageCaption(name: string, sizeBytes: number): string {
  return `${name} · ${formatFileSize(sizeBytes)}`;
}

export function isCommentImage(file: Pick<FileLike, 'name' | 'type'>): boolean {
  if ((COMMENT_IMAGE_TYPES as readonly string[]).includes(file.type)) return true;
  // HEIC from Safari and Windows often arrives typeless; the server checks the bytes anyway.
  return file.type === '' && /\.(jpe?g|png|heic)$/i.test(file.name);
}

/**
 * Adds files to the pending list, refusing what the server would refuse so the
 * person hears about it now rather than after typing a message. Returns the
 * new list and one plain sentence per file left out.
 */
export function addPendingImages<F extends FileLike>(
  current: readonly PendingImage<F>[],
  files: readonly F[],
  nextKey: () => string = () => Math.random().toString(36).slice(2),
): { next: PendingImage<F>[]; rejected: string[] } {
  const next = [...current];
  const rejected: string[] = [];
  for (const file of files) {
    if (!isCommentImage(file)) {
      rejected.push(`${file.name} is not an image (JPG, PNG or HEIC). Add documents from the Attachments panel.`);
      continue;
    }
    if (file.size > MAX_COMMENT_IMAGE_BYTES) {
      rejected.push(`${file.name} is ${formatFileSize(file.size)}; the limit is ${formatFileSize(MAX_COMMENT_IMAGE_BYTES)}.`);
      continue;
    }
    if (next.length >= MAX_COMMENT_IMAGES) {
      rejected.push(`Only ${MAX_COMMENT_IMAGES} images can go in one message; ${file.name} was left out.`);
      continue;
    }
    next.push({ key: nextKey(), file, caption: imageCaption(file.name, file.size) });
  }
  return { next, rejected };
}

export function removePendingImage<F extends FileLike>(
  current: readonly PendingImage<F>[],
  key: string,
): PendingImage<F>[] {
  return current.filter((p) => p.key !== key);
}

/** Whether there is anything to send: text, or at least one picture. */
export function canSendMessage(body: string, images: readonly unknown[]): boolean {
  return body.trim().length > 0 || images.length > 0;
}

/** The success toast, which names what was sent. */
export function sentMessage(isInternal: boolean, imageCount: number): string {
  const what = isInternal ? 'Note added' : 'Message sent';
  if (imageCount === 0) return what;
  return `${what} with ${imageCount === 1 ? '1 image' : `${imageCount} images`}`;
}

/** Pasted or dropped items: only the files, only the images. */
export function imageFilesFrom<F extends FileLike>(files: Iterable<F> | null | undefined): F[] {
  if (!files) return [];
  return Array.from(files).filter((f) => isCommentImage(f));
}

/** The image files on a clipboard (a pasted screenshot); text items are ignored. */
export function clipboardImageFiles<F extends FileLike>(
  items: Iterable<{ kind: string; getAsFile(): F | null }> | null | undefined,
): F[] {
  if (!items) return [];
  return imageFilesFrom(
    Array.from(items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((f): f is F => f !== null),
  );
}

/**
 * v2.61 - pictures attached while RAISING a request. They travel as the
 * conversation's first message (photo-only, from the requester), so there is
 * one storage path and one set of visibility rules. The toast names them.
 */
export function submittedMessage(imageCount: number): string {
  const what = 'Request submitted for approval';
  if (imageCount === 0) return what;
  return `${what} with ${imageCount === 1 ? '1 image' : `${imageCount} images`}`;
}

/**
 * When the request was created but its pictures did not go up: it is left as a
 * draft, deliberately - submitting without them would send approvers a report
 * of damage they cannot see. The person finishes it from the request page.
 */
export const DRAFT_IMAGES_FAILED_MESSAGE =
  'Request saved as a draft but the images could not be uploaded — open it and add them from the conversation';
