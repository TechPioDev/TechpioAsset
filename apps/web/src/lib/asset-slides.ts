import type { AssetImageSource } from '@/lib/asset-overview';

/**
 * Every picture the asset page's lead box can show, in the order a slideshow
 * walks them (v2.62).
 *
 * The box used to show one picture - the catalogue listing's or an uploaded
 * photo - and an illustration otherwise, while the photographs people had
 * actually taken of the unit sat in a card further down. The owner asked for
 * the attached pictures here, filling the box, with a click opening them as a
 * slideshow.
 *
 * Order: the lead picture the existing rule picks (catalogue, else the unit's
 * own photo), then the other of those two if both exist, then the condition
 * photos in custody order, handover before return - the same order the
 * condition-photo viewer uses, so the two never disagree. The first slide is
 * the cover. With no lead picture the most recent condition photo becomes the
 * cover, because a real photograph of the unit beats an illustration.
 */

export interface SlidePhoto {
  id: string;
  caption: string | null;
  takenAt: string;
  by: string | null;
}

export interface SlideCustodyGroup {
  holder: string | null;
  handover: SlidePhoto[];
  returned: SlidePhoto[];
}

export interface AssetSlide {
  /** Stable across reloads, and unique within the list. */
  id: string;
  /** Relative to the API base; fetched with the session's token. */
  path: string;
  stageLabel: string;
  caption: string | null;
  takenAt: string;
  by: string | null;
}

export function assetSlides(input: {
  assetId: string;
  source: AssetImageSource;
  ownPhoto: { id: string; createdAt: string } | null;
  catalogue: { productId: string; imageId: string } | null;
  groups: readonly SlideCustodyGroup[];
}): AssetSlide[] {
  const { assetId, source, ownPhoto, catalogue, groups } = input;

  const own: AssetSlide | null = ownPhoto
    ? {
        id: `photo:${ownPhoto.id}`,
        path: `/assets/${assetId}/photos/${ownPhoto.id}`,
        stageLabel: 'Photo of this unit',
        caption: null,
        takenAt: ownPhoto.createdAt,
        by: null,
      }
    : null;
  const listing: AssetSlide | null = catalogue
    ? {
        id: `catalogue:${catalogue.imageId}`,
        path: `/vendor-products/${catalogue.productId}/images/${catalogue.imageId}`,
        stageLabel: 'Catalogue picture',
        caption: null,
        takenAt: '',
        by: null,
      }
    : null;

  // The existing rule decides which of the two leads; the other follows it.
  const lead = source.kind === 'photo' ? [own, listing] : [listing, own];

  const condition: AssetSlide[] = groups.flatMap((g) => {
    const holder = g.holder ?? 'unknown holder';
    const of = (p: SlidePhoto, stage: string): AssetSlide => ({
      id: `condition:${p.id}`,
      path: `/assets/${assetId}/photos/${p.id}`,
      stageLabel: `${stage} · ${holder}`,
      caption: p.caption,
      takenAt: p.takenAt,
      by: p.by,
    });
    return [
      ...g.handover.map((p) => of(p, 'At handover')),
      ...g.returned.map((p) => of(p, 'On return')),
    ];
  });

  const leading = lead.filter((s): s is AssetSlide => s !== null);
  if (leading.length > 0) return [...leading, ...condition];

  // No lead picture: the newest condition photo covers the box, and the rest
  // keep their custody order behind it.
  if (condition.length === 0) return [];
  const newest = condition.reduce((a, b) => (b.takenAt > a.takenAt ? b : a));
  return [newest, ...condition.filter((s) => s.id !== newest.id)];
}

/** "1 photo" / "7 photos", for the badge on the cover. */
export function slideCountLabel(count: number): string {
  return count === 1 ? '1 photo' : `${count} photos`;
}
