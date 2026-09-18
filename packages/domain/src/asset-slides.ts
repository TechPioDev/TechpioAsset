import type { AssetImageSource } from './asset-overview';

/**
 * Every picture the asset page's lead box can show, in the order a slideshow
 * walks them (v2.62). Written for the web page; moved here when the phone's
 * asset screen took the same box, so both walk the pictures in one order.
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

/**
 * The condition photos alone, in custody order, handover before return. The
 * lead box's slideshow ends with these, and the phone's condition-photo
 * section opens its own viewer on exactly this list - one function, so the two
 * never disagree about which picture comes next.
 */
export function conditionSlides(assetId: string, groups: readonly SlideCustodyGroup[]): AssetSlide[] {
  return groups.flatMap((g) => {
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
}

export function assetSlides(input: {
  assetId: string;
  source: AssetImageSource;
  ownPhoto: { id: string; createdAt: string } | null;
  /**
   * v2.65 - every photograph of the unit (up to five), the cover first. When
   * given it stands in for `ownPhoto`, which older callers still pass alone.
   */
  ownPhotos?: readonly { id: string; createdAt: string }[];
  catalogue: { productId: string; imageId: string } | null;
  groups: readonly SlideCustodyGroup[];
}): AssetSlide[] {
  const { assetId, source, ownPhoto, ownPhotos, catalogue, groups } = input;

  // `ownPhotos` is the list of unit photographs when the server sends one
  // (even empty: the primary picture may then be a condition photo, which is
  // already among the groups). `ownPhoto` alone is an older caller's.
  const units = ownPhotos ?? (ownPhoto ? [ownPhoto] : []);
  const own: AssetSlide[] = units.map((p, i) => ({
    id: `photo:${p.id}`,
    path: `/assets/${assetId}/photos/${p.id}`,
    stageLabel: units.length > 1 ? `Photo of this unit · ${i + 1} of ${units.length}` : 'Photo of this unit',
    caption: null,
    takenAt: p.createdAt,
    by: null,
  }));
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
  const lead = source.kind === 'photo' ? [...own, listing] : [listing, ...own];

  const condition = conditionSlides(assetId, groups);

  const leading = lead.filter((s): s is AssetSlide => s !== null);
  const all = [...leading, ...condition];

  // v2.66 - the primary picture may be any photograph on the asset, a
  // condition photo included: whichever it is opens the set, and the rest keep
  // their order behind it.
  const primary =
    source.kind === 'photo' ? all.find((s) => slidePhotoId(s) === source.photoId) : undefined;
  if (primary) return [primary, ...all.filter((s) => s !== primary)];
  if (leading.length > 0) return all;

  // No lead picture: the newest condition photo covers the box, and the rest
  // keep their custody order behind it.
  if (condition.length === 0) return [];
  const newest = condition.reduce((a, b) => (b.takenAt > a.takenAt ? b : a));
  return [newest, ...condition.filter((s) => s.id !== newest.id)];
}

/**
 * The attachment behind a slide, or null for the catalogue picture, which is
 * not one. What "make this the primary picture" sends to the server.
 */
export function slidePhotoId(slide: Pick<AssetSlide, 'id'>): string | null {
  const at = slide.id.indexOf(':');
  const kind = slide.id.slice(0, at);
  return kind === 'photo' || kind === 'condition' ? slide.id.slice(at + 1) : null;
}

/** "1 photo" / "7 photos", for the badge on the cover. */
export function slideCountLabel(count: number): string {
  return count === 1 ? '1 photo' : `${count} photos`;
}
