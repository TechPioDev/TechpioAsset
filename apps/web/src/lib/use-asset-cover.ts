'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useAuthedBlob } from '@/lib/use-authed-blob';
import { assetSlides, type AssetSlide, type SlideCustodyGroup } from '@/lib/asset-slides';
import { resolveAssetImageSource } from '@/lib/asset-overview';

/** What of an asset decides its pictures; the detail response carries all of it. */
export interface CoverAsset {
  vendorProduct?: { id: string; primaryImageId?: string | null } | null;
  photo?: { id: string; createdAt: string } | null;
  /** v2.65 - every photograph of the unit, the cover first. Absent from an older API. */
  photos?: readonly { id: string; createdAt: string }[] | null;
  subcategory?: { key: string } | null;
  brand: string | null;
}

/**
 * An asset's pictures in slideshow order, and the first of them downloaded
 * (v2.64).
 *
 * Held by the page rather than the lead box so the header thumbnail and the
 * box show one picture from one download: the photo routes answer `no-store`,
 * so two components asking for the same cover would fetch it twice. It also
 * keeps the thumbnail on screen on the tabs where the box is not mounted.
 *
 * The photos query shares its key with the condition-photos card: one request
 * serves both. Somebody who may not read them gets an error there, which
 * simply means no condition photos among the slides.
 */
export function useAssetCover(
  assetId: string,
  asset: CoverAsset | null | undefined,
): { slides: AssetSlide[]; coverUrl: string | null; coverFailed: boolean } {
  const { data: groups } = useQuery<SlideCustodyGroup[]>({
    queryKey: ['asset-photos', assetId],
    queryFn: () => apiFetch(`/assets/${assetId}/photos`),
    enabled: Boolean(asset),
  });

  const productId = asset?.vendorProduct?.id ?? null;
  const imageId = asset?.vendorProduct?.primaryImageId ?? null;
  const photoId = asset?.photo?.id ?? null;
  const photoAt = asset?.photo?.createdAt ?? null;
  // One string for the whole list, so the memo below can key on its value.
  const unitKey = (asset?.photos ?? []).map((p) => `${p.id}@${p.createdAt}`).join('|');
  const typeKey = asset?.subcategory?.key ?? null;
  const brand = asset?.brand ?? null;
  const known = Boolean(asset);

  // Keyed on the values, not the asset object: a refetch hands over a new
  // object with the same pictures, and that must not rebuild the slides.
  const slides = useMemo(() => {
    if (!known) return [];
    const vendorProduct = productId ? { id: productId, primaryImageId: imageId } : null;
    const photo = photoId && photoAt ? { id: photoId, createdAt: photoAt } : null;
    return assetSlides({
      assetId,
      source: resolveAssetImageSource({
        vendorProduct,
        photo,
        subcategory: typeKey ? { key: typeKey } : null,
        brand,
      }),
      ownPhoto: photo,
      ownPhotos: unitKey
        ? unitKey.split('|').map((entry) => {
            const at = entry.indexOf('@');
            return { id: entry.slice(0, at), createdAt: entry.slice(at + 1) };
          })
        : undefined,
      catalogue: productId && imageId ? { productId, imageId } : null,
      groups: groups ?? [],
    });
  }, [known, assetId, productId, imageId, photoId, photoAt, typeKey, brand, unitKey, groups]);

  const { url, failed } = useAuthedBlob(slides[0]?.path ?? null);
  return { slides, coverUrl: url, coverFailed: failed };
}
