import { describe, expect, it } from 'vitest';
import { assetPhotoLimitMessage, assetSlides, MAX_ASSET_PHOTOS } from '@techpioasset/domain';
import {
  addPhotoRefusal,
  REPLACE_DELETES_OLD,
  removePhotoPrompt,
  unitPhotoActions,
  unitPhotoCoverPath,
  unitPhotoImagePath,
  unitPhotoLabel,
  unitPhotoRemovePath,
  unitPhotos,
  unitPhotoUploadPath,
  uploadedAlert,
  usesLegacyPhotoRoutes,
} from './asset-photos';

const photo = (id: string, sizeBytes?: number) => ({
  id,
  mimeType: 'image/jpeg',
  createdAt: `2026-09-0${id.slice(-1)}T10:00:00.000Z`,
  ...(sizeBytes === undefined ? {} : { sizeBytes }),
});

describe('reading the photos off GET /assets/:id', () => {
  it('takes the v2.65 list as sent, the cover first', () => {
    const list = unitPhotos({ photo: photo('p2'), photos: [photo('p2', 2048), photo('p1', 4096)] });
    expect(list.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(list[0]).toEqual({ id: 'p2', createdAt: '2026-09-02T10:00:00.000Z', sizeBytes: 2048 });
  });

  it('falls back to the single cover when an older API sends no list', () => {
    expect(unitPhotos({ photo: photo('p1') })).toEqual([
      { id: 'p1', createdAt: '2026-09-01T10:00:00.000Z', sizeBytes: null },
    ]);
    expect(unitPhotos({ photo: null })).toEqual([]);
    expect(unitPhotos({})).toEqual([]);
  });

  it('believes an empty list over a stale cover', () => {
    expect(unitPhotos({ photo: photo('p1'), photos: [] })).toEqual([]);
  });

  it('knows an older API by the missing list, not by an empty one', () => {
    expect(usesLegacyPhotoRoutes({ photo: photo('p1') })).toBe(true);
    expect(usesLegacyPhotoRoutes({ photo: null, photos: [] })).toBe(false);
  });

  it('feeds the slideshow every unit photo, in the same order', () => {
    const own = unitPhotos({ photos: [photo('p3'), photo('p1'), photo('p2')] });
    const slides = assetSlides({
      assetId: 'a1',
      source: { kind: 'photo', photoId: 'p3' },
      ownPhoto: own[0] ?? null,
      ownPhotos: own,
      catalogue: null,
      groups: [],
    });
    expect(slides.map((s) => s.path)).toEqual([
      '/assets/a1/photos/p3',
      '/assets/a1/photos/p1',
      '/assets/a1/photos/p2',
    ]);
  });
});

describe('adding', () => {
  it('allows a fifth photo and refuses a sixth in the words the server uses', () => {
    expect(addPhotoRefusal(0)).toBeNull();
    expect(addPhotoRefusal(MAX_ASSET_PHOTOS - 1)).toBeNull();
    expect(addPhotoRefusal(MAX_ASSET_PHOTOS)).toBe(assetPhotoLimitMessage());
  });

  it('never lets "Add" overwrite the one photo an older API holds', () => {
    expect(addPhotoRefusal(0, true)).toBeNull();
    expect(addPhotoRefusal(1, true)).toMatch(/Replace or remove/);
  });
});

describe('routes', () => {
  it('uploads to unit-photos, naming the photo to swap when replacing', () => {
    expect(unitPhotoUploadPath('a1', null)).toBe('/assets/a1/unit-photos');
    expect(unitPhotoUploadPath('a1', 'p 1')).toBe('/assets/a1/unit-photos?replace=p%201');
  });

  it('removes, promotes and reads one photo by id', () => {
    expect(unitPhotoRemovePath('a1', 'p1')).toBe('/assets/a1/unit-photos/p1');
    expect(unitPhotoCoverPath('a1', 'p1')).toBe('/assets/a1/unit-photos/p1/cover');
    expect(unitPhotoImagePath('a1', 'p1')).toBe('/assets/a1/photos/p1');
  });

  it('keeps to the one-photo routes against an older API', () => {
    expect(unitPhotoUploadPath('a1', 'p1', true)).toBe('/assets/a1/photo');
    expect(unitPhotoRemovePath('a1', 'p1', true)).toBe('/assets/a1/photo');
  });
});

describe('the per-photo sheet', () => {
  it('offers replace, make cover and remove for a photo that is not the cover', () => {
    expect(unitPhotoActions({ isCover: false }).map((a) => a.key)).toEqual(['replace', 'cover', 'remove']);
  });

  it('does not offer the cover the chance to become the cover', () => {
    expect(unitPhotoActions({ isCover: true }).map((a) => a.key)).toEqual(['replace', 'remove']);
  });

  it('has no "make cover" against an older API', () => {
    expect(unitPhotoActions({ isCover: false, legacy: true }).map((a) => a.key)).toEqual(['replace', 'remove']);
  });

  it('says what each action does to the stored file', () => {
    const actions = unitPhotoActions({ isCover: false });
    expect(actions.find((a) => a.key === 'replace')?.hint).toBe(REPLACE_DELETES_OLD);
    expect(REPLACE_DELETES_OLD).toMatch(/deleted automatically/);
    const remove = actions.find((a) => a.key === 'remove');
    expect(remove?.hint).toMatch(/file is deleted/);
    expect(remove?.destructive).toBe(true);
  });

  it('labels thumbnails for a screen reader, marking the cover', () => {
    expect(unitPhotoLabel(0, 3)).toBe('Photo 1 of 3, cover');
    expect(unitPhotoLabel(2, 3)).toBe('Photo 3 of 3');
  });
});

describe('after an upload', () => {
  it('says nothing more about a picture that fits the 2:1 box', () => {
    expect(uploadedAlert({ replaced: false, dimensions: { width: 1600, height: 800 } })).toEqual({
      title: 'Photo added',
    });
  });

  it('states the size of a phone photo and the exact size that fits', () => {
    const alert = uploadedAlert({ replaced: false, dimensions: { width: 3000, height: 4000 } });
    expect(alert.title).toBe('Photo added');
    expect(alert.message).toContain('3000 × 4000 px');
    expect(alert.message).toContain('1600 × 800 px');
  });

  it('says the old picture is gone after a replacement, with the size note when it applies', () => {
    expect(uploadedAlert({ replaced: true, dimensions: { width: 2000, height: 1000 } })).toEqual({
      title: 'Photo replaced',
      message: 'The old picture has been deleted.',
    });
    const odd = uploadedAlert({ replaced: true, dimensions: { width: 1000, height: 1000 } });
    expect(odd.message).toMatch(/^The old picture has been deleted\./);
    expect(odd.message).toContain('1000 × 1000 px');
  });

  it('keeps quiet about the shape when the picker reported no size', () => {
    expect(uploadedAlert({ replaced: false, dimensions: null })).toEqual({ title: 'Photo added' });
  });
});

describe('before a removal', () => {
  it('always says the file is deleted', () => {
    for (const input of [
      { isCover: true, count: 1 },
      { isCover: true, count: 3 },
      { isCover: false, count: 3 },
    ]) {
      expect(removePhotoPrompt(input).message).toMatch(/file is deleted/);
    }
  });

  it('says where the cover goes', () => {
    expect(removePhotoPrompt({ isCover: true, count: 3 }).message).toMatch(/oldest photo left becomes the cover/);
    expect(removePhotoPrompt({ isCover: false, count: 3 }).message).not.toMatch(/cover/);
    expect(removePhotoPrompt({ isCover: true, count: 1 }).message).toMatch(/catalogue picture or an illustration/);
  });
});
