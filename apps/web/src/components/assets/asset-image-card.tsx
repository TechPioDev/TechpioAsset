'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Camera,
  Expand,
  ImagePlus,
  Images,
  RefreshCw,
  Star,
  Headphones,
  Keyboard,
  Laptop,
  Monitor,
  Mouse,
  Network,
  Printer,
  Server,
  Smartphone,
  Tablet,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { API_BASE, getAccessToken } from '@/lib/api-client';
import { useAuthedBlobs } from '@/lib/use-authed-blob';
import { slideCountLabel, type AssetSlide } from '@/lib/asset-slides';
import { usePrimaryPhoto } from '@/lib/use-primary-photo';
import {
  assetPhotoCountLabel,
  assetPhotoFitNotice,
  assetPhotoHint,
  assetPhotoLimitMessage,
  canAddAssetPhoto,
  photoSizeLabel,
  slidePhotoId,
  type AssetOwnPhoto,
} from '@techpioasset/domain';
import { PhotoLightbox, type LightboxPhoto } from '@/components/assets/photo-lightbox';
import {
  illustrationIcon,
  type AssetImageSource,
  type IllustrationIcon,
} from '@/lib/asset-overview';
import { useToast } from '@/providers/toast-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { Button, Card, Skeleton } from '@/components/ui';

/**
 * The picture that leads the asset page (v2.61).
 *
 * Three sources, in order: the catalogue listing's primary image when the unit
 * came through procurement; a photo somebody uploaded of this very unit; and
 * failing both, a clean illustration by type with the brand name. The rule
 * itself is resolveAssetImageSource in lib/asset-overview.ts; this only draws
 * the result and offers add / replace / remove to people who may edit the
 * record.
 *
 * v2.62: the box shows the asset's attached pictures, filling it, and a click
 * opens all of them as a slideshow - the lead picture first, then every
 * condition photo. With no lead picture the newest condition photo is the
 * cover; the illustration is only for an asset nobody has photographed. Only
 * the cover is downloaded with the page; the rest wait for the first click.
 *
 * v2.65: the owner saw a phone photo filling the box with the top of the
 * laptop cut off, and asked for three things. The picture is now shown whole,
 * over a blurred copy of itself that fills the box, so no shape of photo is
 * cropped. The upload control states the exact size that fits (and says it
 * again, with the picture's own size, after one that does not). And an asset
 * holds up to five photographs of the unit, managed here; replacing one
 * deletes the file it replaces.
 */

const ILLUSTRATIONS: Record<IllustrationIcon, LucideIcon> = {
  laptop: Laptop,
  desktop: Monitor,
  monitor: Monitor,
  phone: Smartphone,
  tablet: Tablet,
  headset: Headphones,
  printer: Printer,
  keyboard: Keyboard,
  mouse: Mouse,
  network: Network,
  server: Server,
  other: Box,
};

/** The icon for the header thumbnail too, so both read as the same device. */
export function DeviceIcon({
  typeKey,
  className,
}: {
  typeKey: string | null | undefined;
  className?: string;
}) {
  const Icon = ILLUSTRATIONS[illustrationIcon(typeKey)];
  return <Icon aria-hidden="true" className={className} />;
}

function Illustration({
  icon,
  brand,
  name,
}: {
  icon: IllustrationIcon;
  brand: string | null;
  name: string;
}) {
  const Icon = ILLUSTRATIONS[icon];
  return (
    <div
      role="img"
      aria-label={`${brand ? `${brand} ` : ''}${name}`}
      className="grid size-full place-items-center bg-[var(--color-surface-sunken)] text-[var(--color-content-subtle)]"
    >
      <div className="grid place-items-center gap-2">
        <Icon aria-hidden="true" className="size-20" strokeWidth={1.25} />
        {brand ? (
          <span className="text-sm font-medium text-[var(--color-content-muted)]">{brand}</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A picture file's pixel size, or null when the browser cannot decode it
 * (HEIC, outside Safari). Only ever used to word a notice, so a failure is
 * not an error.
 */
async function pictureSize(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

/**
 * The small picture in the page header (v2.64): the same cover the lead box
 * shows, so an asset somebody has photographed reads as that device from the
 * first line of the page. The type's glyph stands in while it loads, when it
 * fails, and for an asset with no picture at all.
 */
export function AssetHeaderThumb({
  assetName,
  typeKey,
  coverUrl,
}: {
  assetName: string;
  typeKey: string | null | undefined;
  coverUrl: string | null;
}) {
  return (
    <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]">
      {coverUrl ? (
        // An in-memory blob: URL from an authenticated fetch; next/image cannot
        // serve it (see condition-photos.tsx for the full reasoning).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt={assetName} className="size-full object-cover" />
      ) : (
        <DeviceIcon typeKey={typeKey} className="size-7" />
      )}
    </div>
  );
}

export function AssetImageCard({
  assetId,
  assetName,
  typeKey,
  brand,
  source,
  ownPhotos,
  primaryPhotoId,
  slides,
  coverUrl,
  coverFailed,
  canManage,
}: {
  assetId: string;
  assetName: string;
  typeKey: string | null | undefined;
  brand: string | null;
  source: AssetImageSource;
  /** The photographs uploaded of this unit (up to five), the cover first. */
  ownPhotos: readonly AssetOwnPhoto[];
  /** v2.66 - the attachment chosen as the primary picture, of any kind; null for none. */
  primaryPhotoId: string | null;
  /**
   * The asset's pictures in slideshow order, and the first of them already
   * downloaded - from the page's useAssetCover, which the header thumbnail
   * reads too, so the cover is fetched once for both (v2.64).
   */
  slides: readonly AssetSlide[];
  coverUrl: string | null;
  coverFailed: boolean;
  canManage: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  /** What the last upload's size means for the box; stays until the next one. */
  const [notice, setNotice] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  /** The photograph the file being chosen will replace; null adds a new one. */
  const replacing = useRef<string | null>(null);
  const mayAdd = canAddAssetPhoto(ownPhotos.length);
  // v2.67 - the handover and return photos, which may also be made the primary
  // picture. The owner looked under the box for that choice on a laptop with
  // handover photos only, and found nothing: the panel listed unit photos alone.
  const custodyPhotos = slides.filter((s) => s.id.startsWith('condition:'));
  const manageable = ownPhotos.length + custodyPhotos.length;
  const primary = usePrimaryPhoto(assetId);
  /** The slide on screen in the viewer, by id - the list grows as pictures load. */
  const [viewing, setViewing] = useState<string | null>(null);
  /** Set by the first click: only then are the pictures behind the cover fetched. */
  const [wantAll, setWantAll] = useState(false);

  const cover = slides[0] ?? null;
  // Everything behind the cover, and only once somebody has opened the viewer.
  const paths = useMemo(
    () => (wantAll ? slides.slice(1).map((s) => s.path) : []),
    [wantAll, slides],
  );
  const { urls: restUrls, failed: restFailed } = useAuthedBlobs(paths);
  const url = cover ? coverUrl : null;
  const failed = coverFailed;
  const urls: Record<string, string> =
    cover && coverUrl ? { ...restUrls, [cover.path]: coverUrl } : restUrls;

  // Every slide has its place from the first click - one still downloading
  // shows as loading - so the arrows and the count are right at once. Only a
  // picture that could not be fetched is left out.
  const viewable: LightboxPhoto[] = slides
    .filter((s) => !restFailed.has(s.path))
    .map((s) => ({
      id: s.id,
      url: urls[s.path] ?? null,
      caption: s.caption,
      takenAt: s.takenAt,
      by: s.by,
      stageLabel: s.stageLabel,
    }));
  const viewingIndex = viewing ? viewable.findIndex((p) => p.id === viewing) : -1;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['asset', assetId] });

  const send = async (path: string, init: RequestInit, fallback: string) => {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
    });
    if (!res.ok) {
      const problem = await res.json().catch(() => null);
      throw new Error(problem?.detail ?? problem?.title ?? fallback);
    }
  };

  const upload = useMutation({
    mutationFn: async ({ file, replaceId }: { file: File; replaceId: string | null }) => {
      // Measured before it goes, so the answer can say what the box makes of
      // it. A format the browser cannot decode (HEIC) simply has no size.
      const size = await pictureSize(file);
      const body = new FormData();
      body.append('file', file);
      await send(
        `/assets/${assetId}/unit-photos${replaceId ? `?replace=${encodeURIComponent(replaceId)}` : ''}`,
        { method: 'POST', body },
        'Could not upload that photo',
      );
      return { size, replaced: Boolean(replaceId) };
    },
    onSuccess: ({ size, replaced }) => {
      setError(null);
      setNotice(size ? assetPhotoFitNotice(size.width, size.height) : null);
      toast.success(replaced ? 'Photo replaced - the old one was deleted' : 'Photo added');
      void refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (photoId: string) =>
      send(
        `/assets/${assetId}/unit-photos/${photoId}`,
        { method: 'DELETE' },
        'Could not remove the photo',
      ),
    onSuccess: () => {
      setError(null);
      setNotice(null);
      toast.success('Photo removed');
      void refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const choose = (replaceId: string | null) => {
    if (!replaceId && !mayAdd) {
      setError(assetPhotoLimitMessage());
      return;
    }
    replacing.current = replaceId;
    fileRef.current?.click();
  };

  // A picture that will not load (permission, deleted file) falls back to the
  // illustration rather than a broken-image box.
  const showIllustration = !cover || failed;

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-[2/1] w-full">
        {showIllustration ? (
          <Illustration icon={illustrationIcon(typeKey)} brand={brand} name={assetName} />
        ) : url && cover ? (
          <button
            type="button"
            onClick={() => {
              setWantAll(true);
              setViewing(cover.id);
            }}
            aria-label={`View ${slideCountLabel(slides.length)} of ${assetName}`}
            className="group relative block size-full cursor-zoom-in overflow-hidden bg-[var(--color-surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]"
          >
            {/* An in-memory blob: URL from an authenticated fetch; next/image
                cannot serve it (see condition-photos.tsx for the full
                reasoning). Two copies of one picture: a blurred one fills
                the box, and the real one sits whole on top of it. A 2:1
                picture covers the blur entirely; a phone photo keeps its
                top and bottom instead of losing them to a crop. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 size-full scale-110 object-cover opacity-70 blur-2xl"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={assetName}
              className="relative size-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"
            />
            <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-xs font-medium text-white">
              <Expand aria-hidden="true" className="size-3.5" />
              {slideCountLabel(slides.length)}
            </span>
          </button>
        ) : (
          <Skeleton className="size-full rounded-none" />
        )}
        {brand ? (
          <span className="absolute left-3 top-3 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-raised)]/90 px-2.5 py-0.5 text-xs font-semibold backdrop-blur">
            {brand}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-2.5">
        <p className="text-xs text-[var(--color-content-subtle)]">
          {source.kind === 'catalogue' && !failed ? (
            <>
              Catalogue picture ·{' '}
              <Link
                href={`/catalogue/${source.productId}`}
                className="text-[var(--color-brand)] hover:underline"
              >
                view listing
              </Link>
            </>
          ) : cover && !failed ? (
            `${cover.stageLabel} · click to view ${slides.length === 1 ? 'it' : `all ${slides.length}`} full size`
          ) : (
            'No picture on file — illustration by type'
          )}
        </p>
        {canManage ? (
          <span className="flex items-center gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) upload.mutate({ file, replaceId: replacing.current });
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              loading={upload.isPending && !replacing.current}
              disabled={!mayAdd}
              title={mayAdd ? undefined : assetPhotoLimitMessage()}
              onClick={() => choose(null)}
            >
              <ImagePlus aria-hidden="true" className="size-3.5" />
              Add photo
            </Button>
            {manageable > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={managing}
                onClick={() => {
                  // The thumbnails are the pictures behind the cover: fetched now.
                  setWantAll(true);
                  setManaging((m) => !m);
                }}
              >
                <Images aria-hidden="true" className="size-3.5" />
                {managing ? 'Done' : `Manage photos (${manageable})`}
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>

      {canManage ? (
        <p className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-content-subtle)]">
          <Camera aria-hidden="true" className="mr-1.5 inline size-3.5 align-[-2px]" />
          {assetPhotoHint(ownPhotos.length)}
        </p>
      ) : null}

      {canManage && managing && manageable > 0 ? (
        <div className="border-t border-[var(--color-border)] px-4 py-3">
          <p className="mb-3 text-xs text-[var(--color-content-muted)]">
            <Star aria-hidden="true" className="mr-1 inline size-3.5 align-[-2px]" />
            The primary image leads this box, the page header and the slideshow. Any photo here can
            be it.
          </p>
          {ownPhotos.length > 0 ? (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">Photos of this unit</h3>
                <span className="text-xs text-[var(--color-content-subtle)]">
                  {assetPhotoCountLabel(ownPhotos.length)}
                </span>
              </div>
              {source.kind === 'catalogue' ? (
                <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
                  The catalogue picture leads the box; these follow it in the slideshow.
                </p>
              ) : null}
              <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {ownPhotos.map((photo, i) => {
                  const thumb = urls[`/assets/${assetId}/photos/${photo.id}`];
                  const size = photoSizeLabel(photo.sizeBytes);
                  const busy =
                    (upload.isPending && replacing.current === photo.id) ||
                    (remove.isPending && remove.variables === photo.id) ||
                    primary.busy;
                  return (
                    <li
                      key={photo.id}
                      className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)]"
                    >
                      <div className="relative aspect-[2/1] bg-[var(--color-surface-sunken)]">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumb}
                            alt={`Photo ${i + 1} of ${assetName}`}
                            className="size-full object-contain"
                          />
                        ) : (
                          <Skeleton className="size-full rounded-none" />
                        )}
                        {photo.id === primaryPhotoId ? (
                          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white">
                            <Star aria-hidden="true" className="size-3" />
                            Primary
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-1 px-2 py-1.5">
                        <span className="text-xs text-[var(--color-content-subtle)]">
                          Photo {i + 1}
                          {size ? ` · ${size}` : ''}
                        </span>
                        <span className="flex items-center">
                          {photo.id !== primaryPhotoId ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => primary.setPrimary(photo.id)}
                            >
                              <Star aria-hidden="true" className="size-3.5" />
                              Set as primary
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={upload.isPending && replacing.current === photo.id}
                            disabled={busy}
                            title="Upload a new picture in its place; the old one is deleted"
                            onClick={() => choose(photo.id)}
                          >
                            <RefreshCw aria-hidden="true" className="size-3.5" />
                            Replace
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            aria-label={`Remove photo ${i + 1}`}
                            onClick={async () => {
                              const ok = await confirm({
                                title: 'Remove this photo?',
                                body: 'The file is deleted. It cannot be brought back.',
                                confirmLabel: 'Remove',
                                destructive: true,
                              });
                              if (ok) remove.mutate(photo.id);
                            }}
                          >
                            <Trash2 aria-hidden="true" className="size-3.5" />
                          </Button>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          {custodyPhotos.length > 0 ? (
            <>
              <h3 className={`text-sm font-semibold ${ownPhotos.length > 0 ? 'mt-5' : ''}`}>
                Handover and return photos
              </h3>
              <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
                Evidence of condition: they can lead the page, and are added or removed in the
                Condition photos section below.
              </p>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {custodyPhotos.map((slide) => {
                  const photoId = slidePhotoId(slide);
                  const thumb = urls[slide.path];
                  const isPrimary = photoId !== null && photoId === primaryPhotoId;
                  return (
                    <li
                      key={slide.id}
                      className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)]"
                    >
                      <div className="relative aspect-[2/1] bg-[var(--color-surface-sunken)]">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumb}
                            alt={slide.caption ?? slide.stageLabel}
                            className="size-full object-contain"
                          />
                        ) : (
                          <Skeleton className="size-full rounded-none" />
                        )}
                        {isPrimary ? (
                          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white">
                            <Star aria-hidden="true" className="size-3" />
                            Primary
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-1 px-2 py-1.5">
                        <span className="min-w-0 truncate text-xs text-[var(--color-content-subtle)]">
                          {slide.stageLabel}
                        </span>
                        {isPrimary ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={primary.busy}
                            onClick={() => primary.setPrimary(null)}
                          >
                            Clear
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={primary.busy}
                            onClick={() => primary.setPrimary(photoId)}
                          >
                            <Star aria-hidden="true" className="size-3.5" />
                            Set as primary
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-content-muted)]"
        >
          {notice}
        </p>
      ) : null}
      {viewingIndex >= 0 ? (
        <PhotoLightbox
          photos={viewable}
          index={viewingIndex}
          onClose={() => setViewing(null)}
          onIndexChange={(next) => setViewing(viewable[next]?.id ?? null)}
          primary={
            canManage
              ? {
                  currentId: primaryPhotoId,
                  idOf: slidePhotoId,
                  busy: primary.busy,
                  onSet: primary.setPrimary,
                }
              : undefined
          }
        />
      ) : null}
      {error ? (
        <p
          role="alert"
          className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--tone-critical-fg)]"
        >
          {error}
        </p>
      ) : null}
    </Card>
  );
}
