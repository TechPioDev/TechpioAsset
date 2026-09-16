import { MAX_COMMENT_IMAGES } from '@techpioasset/contracts';
import { formatFileSize } from '@techpioasset/domain';

/**
 * Pictures going out with a request message on the phone (v2.60) - the pure
 * part: what is queued, how it is captioned, what the multipart form carries,
 * and what the banner says afterwards. The native pickers and FormData stay
 * in the component.
 */

export { MAX_COMMENT_IMAGES };

export interface PendingPhoto {
  key: string;
  uri: string;
  name: string;
  type: string;
  /** Unknown until the file has been measured; the caption then says so. */
  sizeBytes: number | null;
}

/** "photo.jpg · 342 KB", or the name alone while the size is still being read. */
export function photoCaption(photo: Pick<PendingPhoto, 'name' | 'sizeBytes'>): string {
  return photo.sizeBytes === null ? photo.name : `${photo.name} · ${formatFileSize(photo.sizeBytes)}`;
}

/** Queues one picture, or explains why not; the list never exceeds the cap. */
export function addPendingPhoto(
  current: readonly PendingPhoto[],
  photo: Omit<PendingPhoto, 'key'>,
  nextKey: () => string = () => Math.random().toString(36).slice(2),
): { next: PendingPhoto[]; rejected: string | null } {
  if (current.length >= MAX_COMMENT_IMAGES) {
    return { next: [...current], rejected: `Only ${MAX_COMMENT_IMAGES} images can go in one message.` };
  }
  return { next: [...current, { key: nextKey(), ...photo }], rejected: null };
}

export function removePendingPhoto(current: readonly PendingPhoto[], key: string): PendingPhoto[] {
  return current.filter((p) => p.key !== key);
}

export function withPhotoSize(current: readonly PendingPhoto[], key: string, sizeBytes: number): PendingPhoto[] {
  return current.map((p) => (p.key === key ? { ...p, sizeBytes } : p));
}

/** A message needs text or at least one picture. */
export function canSendMessage(body: string, photos: readonly unknown[]): boolean {
  return body.trim().length > 0 || photos.length > 0;
}

/**
 * What goes on the wire. Plain text is JSON, which is what every installed
 * build already sends; with pictures it is multipart, the text and images in
 * one call. Returned as data so the component only has to append it.
 */
export type CommentPayload =
  | { kind: 'json'; body: { body: string; isInternal: boolean } }
  | {
      kind: 'multipart';
      fields: [string, string][];
      files: { field: string; uri: string; name: string; type: string }[];
    };

export function commentPayload(body: string, isInternal: boolean, photos: readonly PendingPhoto[]): CommentPayload {
  const text = body.trim();
  if (photos.length === 0) return { kind: 'json', body: { body: text, isInternal } };
  return {
    kind: 'multipart',
    fields: [
      ['body', text],
      ['isInternal', isInternal ? 'true' : 'false'],
    ],
    files: photos.map((p) => ({ field: 'images', uri: p.uri, name: p.name, type: p.type })),
  };
}

/** The banner after a send, naming what went. */
export function sentMessage(isInternal: boolean, photoCount: number): string {
  const what = isInternal ? 'Note added' : 'Message sent';
  if (photoCount === 0) return what;
  return `${what} with ${photoCount === 1 ? '1 image' : `${photoCount} images`}`;
}

/** The banner after a failed send: the server's reason, and that nothing was lost. */
export function failedMessage(isInternal: boolean, reason: string | null): string {
  const what = isInternal ? 'The note was not added' : 'The message was not sent';
  return `${what}${reason ? ` - ${reason}` : ''}. Nothing was lost; try again.`;
}
