import { describe, expect, it } from 'vitest';
import { assetSlides, resolveAssetImageSource, slidePhotoId } from '@techpioasset/domain';
import { primaryPhotoId, unitPhotos } from './asset-photos';
import {
  PRIMARY_FAILED_TITLE,
  primaryChangedAlert,
  primaryControl,
  primaryPhotoBody,
  primaryPhotoPath,
} from './primary-photo';

const unit = { id: 'photo:u1' };
const handover = { id: 'condition:h1' };
const listing = { id: 'catalogue:img1' };

describe('the route', () => {
  it('patches the asset, naming the photo in the body', () => {
    expect(primaryPhotoPath('a1')).toBe('/assets/a1/primary-photo');
    expect(primaryPhotoBody('h1')).toEqual({ photoId: 'h1' });
  });

  it('sends null as null, which is the instruction to clear the choice', () => {
    expect(JSON.stringify(primaryPhotoBody(null))).toBe('{"photoId":null}');
  });
});

describe('what the viewer offers on a slide', () => {
  it('badges the slide that is the primary, of either kind', () => {
    expect(primaryControl(unit, 'u1')).toMatchObject({
      kind: 'badge',
      label: 'Primary image',
      clearLabel: 'Clear',
    });
    expect(primaryControl(handover, 'h1')).toMatchObject({
      kind: 'badge',
      label: 'Primary image',
      clearLabel: 'Clear',
    });
  });

  it('offers every other photograph, a condition photo included', () => {
    expect(primaryControl(handover, 'u1')).toMatchObject({
      kind: 'set',
      photoId: 'h1',
      label: 'Set as primary',
    });
    expect(primaryControl(unit, 'h1')).toMatchObject({
      kind: 'set',
      photoId: 'u1',
      label: 'Set as primary',
    });
    expect(primaryControl(unit, null)).toMatchObject({ kind: 'set', photoId: 'u1' });
    expect(primaryControl(unit, undefined)).toMatchObject({ kind: 'set', photoId: 'u1' });
  });

  it('offers the catalogue picture only a way to clear a choice somebody made', () => {
    expect(primaryControl(listing, 'h1')).toMatchObject({
      kind: 'set',
      photoId: null,
      label: 'Show catalogue picture first',
    });
  });

  it('offers the catalogue picture nothing when it already leads', () => {
    expect(primaryControl(listing, null)).toBeNull();
    expect(primaryControl(listing, undefined)).toBeNull();
  });

  it('never badges the catalogue picture, which is not an attachment', () => {
    // An attachment id that happens to equal the listing's image id.
    expect(primaryControl(listing, 'img1')?.kind).toBe('set');
  });

  it('says it is saving while the request is out', () => {
    const control = primaryControl(unit, null);
    expect(control?.kind === 'set' ? control.busyLabel : null).toBe('Saving…');
  });
});

describe('alerts', () => {
  it('says what changed and where it shows', () => {
    expect(primaryChangedAlert('h1').title).toBe('Primary image set');
    expect(primaryChangedAlert(null)).toEqual({
      title: 'Primary image cleared',
      // Not "the catalogue picture leads again": an asset without a listing can clear too.
      message: 'This asset goes back to its default picture: the catalogue picture if it has one.',
    });
    expect(PRIMARY_FAILED_TITLE).toMatch(/primary image/);
  });
});

/**
 * The screen's wiring, end to end through the domain: GET /assets/:id as the
 * v2.66 API sends it, read by the phone's helpers, walked by assetSlides.
 */
describe('a handover photo as the primary picture', () => {
  const groups = [
    {
      holder: 'Rohit',
      handover: [{ id: 'h1', caption: null, takenAt: '2026-08-13T10:00:00.000Z', by: 'Harry' }],
      returned: [{ id: 'r1', caption: null, takenAt: '2026-09-01T10:00:00.000Z', by: 'Harry' }],
    },
  ];
  const catalogue = { productId: 'vp1', imageId: 'img1' };

  it('leads the slideshow ahead of the catalogue picture, with no unit photos at all', () => {
    const asset = {
      brand: 'Lenovo',
      vendorProduct: { id: 'vp1', primaryImageId: 'img1' },
      photo: { id: 'h1', createdAt: '2026-08-13T10:00:00.000Z', entityType: 'AssetAssignment' },
      photos: [],
    };
    const own = unitPhotos(asset);
    // The empty list is believed: the handover photo is not a photo of the unit.
    expect(own).toEqual([]);
    const slides = assetSlides({
      assetId: 'a1',
      source: resolveAssetImageSource(asset),
      ownPhoto: own[0] ?? null,
      ownPhotos: own,
      catalogue,
      groups,
    });
    expect(slides.map((s) => s.id)).toEqual(['condition:h1', 'catalogue:img1', 'condition:r1']);
    // Shown once, not again as a "photo of this unit".
    expect(slides.filter((s) => slidePhotoId(s) === 'h1')).toHaveLength(1);

    const id = primaryPhotoId(asset);
    expect(slides.map((s) => primaryControl(s, id)?.kind ?? null)).toEqual(['badge', 'set', 'set']);
    expect(primaryControl(slides[1]!, id)).toMatchObject({ photoId: null });
  });

  it('marks no unit photo when the primary is a condition photo', () => {
    const asset = {
      photo: { id: 'h1', createdAt: '2026-08-13T10:00:00.000Z', entityType: 'AssetAssignment' },
      photos: [
        { id: 'u1', createdAt: '2026-09-01T10:00:00.000Z' },
        { id: 'u2', createdAt: '2026-09-02T10:00:00.000Z' },
      ],
    };
    const id = primaryPhotoId(asset);
    expect(unitPhotos(asset).filter((p) => p.id === id)).toEqual([]);
  });

  it('has no primary when the choice is cleared, and the catalogue picture leads again', () => {
    const asset = {
      brand: null,
      vendorProduct: { id: 'vp1', primaryImageId: 'img1' },
      photo: null,
      photos: [{ id: 'u1', createdAt: '2026-09-01T10:00:00.000Z' }],
    };
    expect(primaryPhotoId(asset)).toBeNull();
    const own = unitPhotos(asset);
    const slides = assetSlides({
      assetId: 'a1',
      source: resolveAssetImageSource(asset),
      ownPhoto: own[0] ?? null,
      ownPhotos: own,
      catalogue,
      groups: [],
    });
    expect(slides.map((s) => s.id)).toEqual(['catalogue:img1', 'photo:u1']);
    expect(slides.map((s) => primaryControl(s, null)?.kind ?? null)).toEqual([null, 'set']);
  });
});
