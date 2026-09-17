import { describe, expect, it } from 'vitest';
import {
  DRAFT_IMAGES_FAILED_MESSAGE,
  MAX_COMMENT_IMAGES,
  addPendingPhoto,
  canSendMessage,
  commentPayload,
  failedMessage,
  insertPhotoMarker,
  markersToTokens,
  photoCaption,
  photoMarkersIn,
  removePendingPhoto,
  removePhotoMarker,
  sentMessage,
  submittedMessage,
  syncPhotosToMarkers,
  withPhotoSize,
  wordsWithoutMarkers,
  type PendingPhoto,
} from './comment-images';

const shot = (name = 'photo.jpg', sizeBytes: number | null = 342 * 1024) => ({
  uri: `file:///tmp/${name}`,
  name,
  type: 'image/jpeg',
  sizeBytes,
});
const keys = () => {
  let n = 0;
  return () => `k${++n}`;
};

describe('comment photos on the phone', () => {
  it('captions with the size in KB, or the name alone until measured', () => {
    expect(photoCaption(shot())).toBe('photo.jpg · 342 KB');
    expect(photoCaption(shot('big.jpg', 2.5 * 1024 * 1024))).toBe('big.jpg · 2.5 MB');
    expect(photoCaption(shot('new.jpg', null))).toBe('new.jpg');
  });

  it('queues up to the cap and then says so', () => {
    let list: PendingPhoto[] = [];
    const key = keys();
    for (let i = 0; i < MAX_COMMENT_IMAGES; i++) {
      const { next, rejected } = addPendingPhoto(list, shot(`p${i}.jpg`), key);
      expect(rejected).toBeNull();
      list = next;
    }
    const { next, rejected } = addPendingPhoto(list, shot('one-too-many.jpg'), key);
    expect(next).toHaveLength(MAX_COMMENT_IMAGES);
    expect(rejected).toBe('Only 6 images can go in one message.');
  });

  it('removes by key and records a measured size', () => {
    const key = keys();
    const a = addPendingPhoto([], shot('a.jpg', null), key).next;
    const ab = addPendingPhoto(a, shot('b.jpg'), key).next;
    expect(removePendingPhoto(ab, 'k1').map((p) => p.name)).toEqual(['b.jpg']);
    expect(withPhotoSize(ab, 'k1', 2048)[0]?.sizeBytes).toBe(2048);
    expect(withPhotoSize(ab, 'k1', 2048)[1]?.sizeBytes).toBe(342 * 1024);
  });

  it('a message needs text or a picture', () => {
    expect(canSendMessage('', [])).toBe(false);
    expect(canSendMessage('  ', [])).toBe(false);
    expect(canSendMessage('hi', [])).toBe(true);
    expect(canSendMessage('', [{}])).toBe(true);
  });

  it('sends plain text as JSON and pictures as multipart under "images"', () => {
    expect(commentPayload('  Hello  ', true, [])).toEqual({
      kind: 'json',
      body: { body: 'Hello', isInternal: true },
    });
    const photos = addPendingPhoto([], shot(), keys()).next;
    expect(commentPayload('', false, photos)).toEqual({
      kind: 'multipart',
      fields: [
        ['body', ''],
        ['isInternal', 'false'],
      ],
      files: [{ field: 'images', uri: 'file:///tmp/photo.jpg', name: 'photo.jpg', type: 'image/jpeg' }],
    });
  });

  it('a marker in the text goes on the wire as the API token for the same picture', () => {
    const photos = addPendingPhoto([], shot(), keys()).next;
    expect(commentPayload('The corner: [photo 1] cracked', false, photos)).toMatchObject({
      kind: 'multipart',
      fields: [
        ['body', 'The corner: ![image 1](pending:1) cracked'],
        ['isInternal', 'false'],
      ],
    });
    // A stale marker with no picture behind it is not sent as a token.
    expect(commentPayload('Just words [photo 1]', false, [])).toEqual({
      kind: 'json',
      body: { body: 'Just words', isInternal: false },
    });
  });

  it('puts the marker in at the cursor, spaced from the words, or at the end with no cursor', () => {
    expect(insertPhotoMarker('The corner cracked', { start: 10, end: 10 }, 1)).toEqual({
      text: 'The corner [photo 1] cracked',
      caret: 20,
    });
    expect(insertPhotoMarker('Front:\n', { start: 7, end: 7 }, 2)).toEqual({ text: 'Front:\n[photo 2]', caret: 16 });
    expect(insertPhotoMarker('See this', null, 1)).toEqual({ text: 'See this [photo 1]', caret: 18 });
    // A selection is replaced.
    expect(insertPhotoMarker('a XXX b', { start: 2, end: 5 }, 1).text).toBe('a [photo 1] b');
    expect(insertPhotoMarker('', null, 1)).toEqual({ text: '[photo 1]', caret: 9 });
  });

  it('lists the markers in the text once each, in order', () => {
    expect(photoMarkersIn('[photo 2] a [photo 1] b [photo 2]')).toEqual([2, 1]);
    expect(photoMarkersIn('no markers')).toEqual([]);
  });

  it('a marker the person deleted takes its picture with it, and the rest renumber', () => {
    const key = keys();
    let photos: PendingPhoto[] = [];
    for (const name of ['a.jpg', 'b.jpg', 'c.jpg']) photos = addPendingPhoto(photos, shot(name), key).next;
    const { text, photos: kept } = syncPhotosToMarkers('x [photo 1] y [photo 3] z', photos);
    expect(text).toBe('x [photo 1] y [photo 2] z');
    expect(kept.map((p) => p.name)).toEqual(['a.jpg', 'c.jpg']);
    // Removing via the thumbnail's control is the same path.
    const after = syncPhotosToMarkers(removePhotoMarker(text, 1), kept);
    expect(after.text).toBe('x  y [photo 1] z');
    expect(after.photos.map((p) => p.name)).toEqual(['c.jpg']);
  });

  it('the words alone, for the business reason; the tokens, for the wire', () => {
    expect(wordsWithoutMarkers('Dropped it [photo 1] and the corner  cracked [photo 2]\n\n\nBadly.')).toBe(
      'Dropped it and the corner cracked\n\nBadly.',
    );
    expect(markersToTokens('a [photo 1] b [photo 12]')).toBe('a ![image 1](pending:1) b ![image 12](pending:12)');
  });

  it('the banners after raising a request', () => {
    expect(submittedMessage(0)).toBe('Request submitted for approval');
    expect(submittedMessage(1)).toBe('Request submitted for approval with 1 image');
    expect(submittedMessage(3)).toBe('Request submitted for approval with 3 images');
    expect(DRAFT_IMAGES_FAILED_MESSAGE).toMatch(/saved as a draft/);
  });

  it('the banners say what happened and that nothing was lost', () => {
    expect(sentMessage(false, 0)).toBe('Message sent');
    expect(sentMessage(true, 2)).toBe('Note added with 2 images');
    expect(failedMessage(false, 'Only images can be sent in a message')).toBe(
      'The message was not sent - Only images can be sent in a message. Nothing was lost; try again.',
    );
    expect(failedMessage(true, null)).toBe('The note was not added. Nothing was lost; try again.');
  });
});
