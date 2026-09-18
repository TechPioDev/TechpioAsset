import { describe, expect, it } from 'vitest';
import {
  assetPhotoCountLabel,
  assetPhotoFitNotice,
  assetPhotoHint,
  assetPhotoLimitMessage,
  canAddAssetPhoto,
  fitsAssetPhotoBox,
  photoSizeLabel,
} from './asset-photo-rules';

describe("the rules for an asset's own photographs", () => {
  it('states the exact size that fits and how many are on file', () => {
    expect(assetPhotoHint(2)).toBe(
      'Best size 1600 × 800 px (landscape, 2:1) - JPG, PNG or WebP, up to 15 MB. 2 of 5 photos.',
    );
    expect(assetPhotoCountLabel(9)).toBe('5 of 5 photos');
  });

  it('allows a fifth and not a sixth', () => {
    expect(canAddAssetPhoto(4)).toBe(true);
    expect(canAddAssetPhoto(5)).toBe(false);
    expect(assetPhotoLimitMessage()).toContain('at most 5 photos');
  });

  it('says nothing about a picture that fits the box', () => {
    expect(fitsAssetPhotoBox(1600, 800)).toBe(true);
    expect(fitsAssetPhotoBox(1920, 1000)).toBe(true);
    expect(assetPhotoFitNotice(3200, 1600)).toBeNull();
  });

  it("names a phone photo's own size and the one that fits", () => {
    const notice = assetPhotoFitNotice(3000, 4000);
    expect(notice).toContain('3000 × 4000 px');
    expect(notice).toContain('1600 × 800 px');
  });

  it('does not guess about a picture it could not measure', () => {
    expect(assetPhotoFitNotice(0, 0)).toBeNull();
  });

  it('writes sizes the way people read them', () => {
    expect(photoSizeLabel(860_000)).toBe('840 KB');
    expect(photoSizeLabel(2_500_000)).toBe('2.4 MB');
    expect(photoSizeLabel(null)).toBeNull();
  });
});
