import { describe, expect, it } from 'vitest';
import {
  MAX_COMMENT_IMAGES,
  addPendingPhoto,
  canSendMessage,
  commentPayload,
  failedMessage,
  photoCaption,
  removePendingPhoto,
  sentMessage,
  withPhotoSize,
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

  it('the banners say what happened and that nothing was lost', () => {
    expect(sentMessage(false, 0)).toBe('Message sent');
    expect(sentMessage(true, 2)).toBe('Note added with 2 images');
    expect(failedMessage(false, 'Only images can be sent in a message')).toBe(
      'The message was not sent - Only images can be sent in a message. Nothing was lost; try again.',
    );
    expect(failedMessage(true, null)).toBe('The note was not added. Nothing was lost; try again.');
  });
});
