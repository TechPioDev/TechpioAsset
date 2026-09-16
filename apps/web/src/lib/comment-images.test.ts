import { describe, expect, it } from 'vitest';
import {
  MAX_COMMENT_IMAGES,
  addPendingImages,
  canSendMessage,
  imageCaption,
  imageFilesFrom,
  isCommentImage,
  removePendingImage,
  sentMessage,
} from './comment-images';

const jpg = (name = 'photo.jpg', size = 342 * 1024) => ({ name, type: 'image/jpeg', size });
const keys = () => {
  let n = 0;
  return () => `k${++n}`;
};

describe('comment images - pending list', () => {
  it('captions each image with its name and size in KB', () => {
    expect(imageCaption('photo.jpg', 342 * 1024)).toBe('photo.jpg · 342 KB');
    expect(imageCaption('big.png', 1.5 * 1024 * 1024)).toBe('big.png · 1.5 MB');
  });

  it('accepts JPG, PNG and HEIC, including a typeless HEIC by extension', () => {
    expect(isCommentImage(jpg())).toBe(true);
    expect(isCommentImage({ name: 'a.png', type: 'image/png' })).toBe(true);
    expect(isCommentImage({ name: 'IMG_1.HEIC', type: '' })).toBe(true);
    expect(isCommentImage({ name: 'quote.pdf', type: 'application/pdf' })).toBe(false);
    expect(isCommentImage({ name: 'script.png', type: 'text/plain' })).toBe(false);
  });

  it('adds images and explains, per file, what it left out', () => {
    const { next, rejected } = addPendingImages(
      [],
      [jpg(), { name: 'quote.pdf', type: 'application/pdf', size: 10 }, jpg('huge.jpg', 26 * 1024 * 1024)],
      keys(),
    );
    expect(next.map((p) => p.file.name)).toEqual(['photo.jpg']);
    expect(next[0]).toMatchObject({ key: 'k1', caption: 'photo.jpg · 342 KB' });
    expect(rejected).toEqual([
      'quote.pdf is not an image (JPG, PNG or HEIC). Add documents from the Attachments panel.',
      'huge.jpg is 26.0 MB; the limit is 25.0 MB.',
    ]);
  });

  it('stops at the per-message cap and says so', () => {
    const files = Array.from({ length: MAX_COMMENT_IMAGES + 2 }, (_, i) => jpg(`p${i}.jpg`));
    const { next, rejected } = addPendingImages([], files, keys());
    expect(next).toHaveLength(MAX_COMMENT_IMAGES);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]).toMatch(/Only 6 images/);
  });

  it('removes by key and leaves the rest in order', () => {
    const { next } = addPendingImages([], [jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg')], keys());
    expect(removePendingImage(next, 'k2').map((p) => p.file.name)).toEqual(['a.jpg', 'c.jpg']);
  });

  it('a message needs text or a picture', () => {
    expect(canSendMessage('', [])).toBe(false);
    expect(canSendMessage('   ', [])).toBe(false);
    expect(canSendMessage('hello', [])).toBe(true);
    expect(canSendMessage('', [{}])).toBe(true);
  });

  it('the toast names what went', () => {
    expect(sentMessage(false, 0)).toBe('Message sent');
    expect(sentMessage(true, 0)).toBe('Note added');
    expect(sentMessage(false, 1)).toBe('Message sent with 1 image');
    expect(sentMessage(true, 3)).toBe('Note added with 3 images');
  });

  it('keeps only the images out of a paste or drop', () => {
    expect(imageFilesFrom([jpg(), { name: 'x.txt', type: 'text/plain', size: 1 }]).map((f) => f.name)).toEqual(['photo.jpg']);
    expect(imageFilesFrom(null)).toEqual([]);
  });
});
