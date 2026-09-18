import { describe, expect, it } from 'vitest';
import { assetSlides, conditionSlides, slideCountLabel } from './asset-slides';

const groups = [
  {
    holder: 'Rohit Chaudhary',
    handover: [{ id: 'h1', caption: 'Lid', takenAt: '2026-08-13T10:00:00Z', by: 'Harry Singh' }],
    returned: [{ id: 'r1', caption: null, takenAt: '2026-09-01T10:00:00Z', by: 'Harry Singh' }],
  },
  {
    holder: null,
    handover: [{ id: 'h2', caption: null, takenAt: '2026-09-10T10:00:00Z', by: null }],
    returned: [],
  },
];

describe('the pictures in the asset page lead box', () => {
  it('leads with the catalogue picture, then the unit photo, then condition photos in custody order', () => {
    const slides = assetSlides({
      assetId: 'a1',
      source: { kind: 'catalogue', productId: 'p1', imageId: 'i1' },
      ownPhoto: { id: 'own1', createdAt: '2026-09-17T00:00:00Z' },
      catalogue: { productId: 'p1', imageId: 'i1' },
      groups,
    });
    expect(slides.map((s) => s.id)).toEqual([
      'catalogue:i1',
      'photo:own1',
      'condition:h1',
      'condition:r1',
      'condition:h2',
    ]);
    expect(slides[0]!.path).toBe('/vendor-products/p1/images/i1');
    expect(slides[2]!.stageLabel).toBe('At handover · Rohit Chaudhary');
    expect(slides[4]!.stageLabel).toBe('At handover · unknown holder');
  });

  it('leads with the unit photo when that is what the rule picked', () => {
    const slides = assetSlides({
      assetId: 'a1',
      source: { kind: 'photo', photoId: 'own1' },
      ownPhoto: { id: 'own1', createdAt: '2026-09-17T00:00:00Z' },
      catalogue: null,
      groups: [],
    });
    expect(slides.map((s) => s.id)).toEqual(['photo:own1']);
    expect(slides[0]!.path).toBe('/assets/a1/photos/own1');
  });

  it('covers the box with the newest condition photo when there is no lead picture', () => {
    const slides = assetSlides({
      assetId: 'a1',
      source: { kind: 'illustration', icon: 'laptop', brand: null },
      ownPhoto: null,
      catalogue: null,
      groups,
    });
    // h2 is the most recent; the rest keep custody order, each exactly once.
    expect(slides.map((s) => s.id)).toEqual(['condition:h2', 'condition:h1', 'condition:r1']);
  });

  it('is empty when the asset has no picture of any kind', () => {
    expect(
      assetSlides({
        assetId: 'a1',
        source: { kind: 'illustration', icon: 'laptop', brand: null },
        ownPhoto: null,
        catalogue: null,
        groups: [],
      }),
    ).toEqual([]);
  });

  it('lists the condition photos alone in the same custody order', () => {
    const slides = conditionSlides('a1', groups);
    expect(slides.map((s) => s.id)).toEqual(['condition:h1', 'condition:r1', 'condition:h2']);
    expect(slides[1]!.path).toBe('/assets/a1/photos/r1');
    expect(slides[1]!.stageLabel).toBe('On return · Rohit Chaudhary');
    expect(conditionSlides('a1', [])).toEqual([]);
  });

  it('counts in words', () => {
    expect(slideCountLabel(1)).toBe('1 photo');
    expect(slideCountLabel(7)).toBe('7 photos');
  });
});
