'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Camera,
  Expand,
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
import { API_BASE, apiFetch, getAccessToken } from '@/lib/api-client';
import { useAuthedBlobs } from '@/lib/use-authed-blob';
import { assetSlides, slideCountLabel, type SlideCustodyGroup } from '@/lib/asset-slides';
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

export function AssetImageCard({
  assetId,
  assetName,
  typeKey,
  brand,
  source,
  ownPhoto,
  catalogue,
  canManage,
}: {
  assetId: string;
  assetName: string;
  typeKey: string | null | undefined;
  brand: string | null;
  source: AssetImageSource;
  /** The photo uploaded of this unit, whatever is being shown. */
  ownPhoto: { id: string; createdAt: string } | null;
  /** The catalogue listing's primary image, when the unit came through one. */
  catalogue: { productId: string; imageId: string } | null;
  canManage: boolean;
}) {
  const hasOwnPhoto = Boolean(ownPhoto);
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  /** The slide on screen in the viewer, by id - the list grows as pictures load. */
  const [viewing, setViewing] = useState<string | null>(null);
  /** Set by the first click: only then are the pictures behind the cover fetched. */
  const [wantAll, setWantAll] = useState(false);

  // The same query, under the same key, as the condition-photos card further
  // down the page: one request serves both. Somebody who may not read them gets
  // an error here, which simply means no condition photos in the slideshow.
  const { data: groups } = useQuery<SlideCustodyGroup[]>({
    queryKey: ['asset-photos', assetId],
    queryFn: () => apiFetch(`/assets/${assetId}/photos`),
  });

  const slides = useMemo(
    () => assetSlides({ assetId, source, ownPhoto, catalogue, groups: groups ?? [] }),
    [assetId, source, ownPhoto, catalogue, groups],
  );
  const cover = slides[0] ?? null;
  const paths = useMemo(
    () => (wantAll ? slides.map((s) => s.path) : cover ? [cover.path] : []),
    [wantAll, slides, cover],
  );
  const { urls, failed: failedPaths } = useAuthedBlobs(paths);
  const url = cover ? (urls[cover.path] ?? null) : null;
  const failed = cover ? failedPaths.has(cover.path) : false;

  const viewable: LightboxPhoto[] = slides
    .filter((s) => urls[s.path])
    .map((s) => ({
      id: s.id,
      url: urls[s.path]!,
      caption: s.caption,
      takenAt: s.takenAt,
      by: s.by,
      stageLabel: s.stageLabel,
    }));
  const viewingIndex = viewing ? viewable.findIndex((p) => p.id === viewing) : -1;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['asset', assetId] });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`${API_BASE}/assets/${assetId}/photo`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        body,
      });
      if (!res.ok) {
        const problem = await res.json().catch(() => null);
        throw new Error(problem?.detail ?? problem?.title ?? 'Could not upload that photo');
      }
    },
    onSuccess: () => {
      setError(null);
      toast.success(hasOwnPhoto ? 'Photo replaced' : 'Photo added');
      void refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/assets/${assetId}/photo`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
      });
      if (!res.ok) {
        const problem = await res.json().catch(() => null);
        throw new Error(problem?.detail ?? problem?.title ?? 'Could not remove the photo');
      }
    },
    onSuccess: () => {
      setError(null);
      toast.success('Photo removed');
      void refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  // A picture that will not load (permission, deleted file) falls back to the
  // illustration rather than a broken-image box.
  const showIllustration = !cover || failed;

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-[16/9] w-full sm:aspect-[2/1]">
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
            className="group block size-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]"
          >
            {/* An in-memory blob: URL from an authenticated fetch; next/image
                cannot serve it (see condition-photos.tsx for the full
                reasoning). object-cover: the owner asked for the picture to
                fill the box; the viewer shows it uncropped. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={assetName}
              className="size-full bg-[var(--color-surface-sunken)] object-cover transition-transform duration-300 group-hover:scale-[1.02]"
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
                if (file) upload.mutate(file);
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              loading={upload.isPending}
              onClick={() => fileRef.current?.click()}
            >
              <Camera aria-hidden="true" className="size-3.5" />
              {hasOwnPhoto ? 'Replace photo' : 'Add photo'}
            </Button>
            {hasOwnPhoto ? (
              <Button
                size="sm"
                variant="ghost"
                loading={remove.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Remove this photo?',
                    body: 'The asset goes back to its catalogue picture or an illustration.',
                    confirmLabel: 'Remove',
                    destructive: true,
                  });
                  if (ok) remove.mutate();
                }}
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
                Remove
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
      {viewingIndex >= 0 ? (
        <PhotoLightbox
          photos={viewable}
          index={viewingIndex}
          onClose={() => setViewing(null)}
          onIndexChange={(next) => setViewing(viewable[next]?.id ?? null)}
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
