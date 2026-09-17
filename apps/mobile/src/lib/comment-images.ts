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
  // Markers travel as tokens; a body without pictures cannot carry any.
  const text = photos.length === 0 ? wordsWithoutMarkers(body) : markersToTokens(body).trim();
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

/**
 * v2.61 - pictures inline in the text. A TextInput cannot hold a picture, so
 * on the phone the Nth picture is a marker in the words - `[photo N]` - put
 * in where the cursor is, with the picture itself shown in the strip below.
 * On send the markers become the `![image N](pending:N)` tokens the API
 * takes, and the thread renders the picture where the marker was.
 */
export const PHOTO_MARKER_HINT =
  'Photos go in where the cursor is, shown as [photo 1] in the text; they appear in place once sent.';

const MARKER = /\[photo (\d{1,2})\]/g;

export function photoMarker(n: number): string {
  return `[photo ${n}]`;
}

export interface TextSelection {
  start: number;
  end: number;
}

/** Puts the marker in at the selection (replacing anything selected), spaced from the words around it. */
export function insertPhotoMarker(text: string, selection: TextSelection | null, n: number): { text: string; caret: number } {
  const start = Math.min(Math.max(selection?.start ?? text.length, 0), text.length);
  const end = Math.min(Math.max(selection?.end ?? start, start), text.length);
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
  const trail = after.length > 0 && !/^\s/.test(after) ? ' ' : '';
  const inserted = `${lead}${photoMarker(n)}${trail}`;
  return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

/** The marker numbers present in the text, in the order they appear, once each. */
export function photoMarkersIn(text: string): number[] {
  const seen: number[] = [];
  for (const m of text.matchAll(MARKER)) {
    const n = Number(m[1]);
    if (!seen.includes(n)) seen.push(n);
  }
  return seen;
}

/**
 * Keeps the pictures and their markers in step after the text changed: a
 * picture whose marker the person deleted is let go, and the rest are
 * renumbered 1..k in list order so marker N always means photos[N-1].
 */
export function syncPhotosToMarkers(
  text: string,
  photos: readonly PendingPhoto[],
): { text: string; photos: PendingPhoto[] } {
  const present = photoMarkersIn(text);
  const kept = photos.map((p, i) => ({ photo: p, oldNumber: i + 1 })).filter(({ oldNumber }) => present.includes(oldNumber));
  const renumber = new Map(kept.map(({ oldNumber }, i) => [oldNumber, i + 1]));
  const next = text.replace(MARKER, (whole, n: string) => {
    const to = renumber.get(Number(n));
    return to === undefined ? '' : photoMarker(to);
  });
  return { text: next, photos: kept.map(({ photo }) => photo) };
}

/** Removes the Nth picture's marker from the text (its picture goes with it via syncPhotosToMarkers). */
export function removePhotoMarker(text: string, n: number): string {
  return text.replace(MARKER, (whole, m: string) => (Number(m) === n ? '' : whole));
}

/** The words with the markers taken out - what the request's business reason stores. */
export function wordsWithoutMarkers(text: string): string {
  return text.replace(MARKER, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

/** The body that goes on the wire: each marker becomes the API's token for the same picture. */
export function markersToTokens(text: string): string {
  return text.replace(MARKER, (_whole, n: string) => `![image ${n}](pending:${n})`);
}

/** The banner after a request is raised, naming the pictures that went with it. */
export function submittedMessage(photoCount: number): string {
  const what = 'Request submitted for approval';
  if (photoCount === 0) return what;
  return `${what} with ${photoCount === 1 ? '1 image' : `${photoCount} images`}`;
}

/** The request was created but its pictures did not go up: it stays a draft, to be finished from its page. */
export const DRAFT_IMAGES_FAILED_MESSAGE =
  'Request saved as a draft but the images could not be uploaded — open it and add them from the conversation';
