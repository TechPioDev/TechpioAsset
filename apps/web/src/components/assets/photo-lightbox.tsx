'use client';

import { useCallback, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Star, X } from 'lucide-react';

/**
 * A condition photo at full size (v2.36).
 *
 * The thumbnails are 96px, which is enough to see that a photo exists and not
 * enough to see the scratch it was taken for. This is the screen where the
 * question actually gets answered, so it carries the caption, who took it and
 * when - a photograph on its own proves nothing without those.
 *
 * Arrow keys and the buttons step through the set rather than making somebody
 * close and reopen for each one: comparing a handover shot against the return
 * shot means going back and forth, repeatedly.
 *
 * v2.66: the owner opened the slideshow and found no way to the next picture.
 * The arrows used to sit in a row beside the image, and a photograph as wide
 * as the window pushed them off both edges of the screen. They now float over
 * the picture, on a dark disc so they show against any photograph, with a
 * "2 / 5" counter and a dot per picture underneath; a swipe steps too. A
 * picture still downloading has its place in the set from the start, so the
 * arrows are there on the first click rather than appearing one by one.
 */

export interface LightboxPhoto {
  id: string;
  /** Null while the bytes are still on their way: the slide shows as loading. */
  url: string | null;
  caption: string | null;
  takenAt: string;
  by: string | null;
  /** "At handover" / "On return" - which end of the custody event this was. */
  stageLabel: string;
}

/**
 * "Set as primary" (v2.66), for a viewer whose caller may edit the asset. The
 * owner asked to make any image the one the page leads with, and this is the
 * screen where a picture is actually looked at, so the choice is offered here.
 */
export interface LightboxPrimary {
  /** The attachment id of the asset's primary picture, if one is chosen. */
  currentId: string | null;
  /** The attachment behind a photo; null for the catalogue picture. */
  idOf: (photo: LightboxPhoto) => string | null;
  busy: boolean;
  /** A photo's id, or null to clear the choice so the catalogue picture leads. */
  onSet: (photoId: string | null) => void;
}

export function PhotoLightbox({
  photos,
  index,
  onClose,
  onIndexChange,
  primary,
}: {
  photos: LightboxPhoto[];
  index: number;
  onClose: () => void;
  onIndexChange: (next: number) => void;
  /** Omitted for somebody who may not edit the asset: they are offered nothing. */
  primary?: LightboxPrimary;
}) {
  const photo = photos[index];
  const many = photos.length > 1;
  /** Where a touch began, to tell a swipe from a tap. */
  const touchX = useRef<number | null>(null);

  const step = useCallback(
    (delta: number) => {
      if (!many) return;
      onIndexChange((index + delta + photos.length) % photos.length);
    },
    [index, many, onIndexChange, photos.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    // The page behind must not scroll while this is over it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose, step]);

  if (!photo) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={photo.caption ?? 'Condition photo'}
      className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm"
      // Clicking the backdrop closes; clicking the image itself must not.
      onClick={onClose}
    >
      <div className="flex items-start justify-between gap-4 p-4 text-white">
        <div className="min-w-0">
          <p className="text-sm font-medium">{photo.caption ?? photo.stageLabel}</p>
          <p className="mt-0.5 text-xs text-white/70">
            {photo.stageLabel}
            {/* The catalogue picture has no date of its own. */}
            {photo.takenAt ? ` · ${new Date(photo.takenAt).toLocaleString()}` : ''}
            {photo.by ? ` · ${photo.by}` : ''}
            {many ? ` · ${index + 1} of ${photos.length}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {primary ? <PrimaryControl photo={photo} primary={primary} /> : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4 sm:px-20"
        onTouchStart={(e) => {
          touchX.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const from = touchX.current;
          touchX.current = null;
          const to = e.changedTouches[0]?.clientX;
          if (from == null || to == null || Math.abs(to - from) < 40) return;
          step(to < from ? 1 : -1);
        }}
      >
        {photo.url ? (
          // A blob: URL from an authenticated fetch; next/image cannot fetch it
          // server-side, and these must not be cached anywhere shared.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.url}
            alt={photo.caption ?? `${photo.stageLabel} photo`}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded object-contain"
          />
        ) : (
          <p role="status" className="text-sm text-white/70" onClick={(e) => e.stopPropagation()}>
            Loading photo…
          </p>
        )}

        {many ? (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                step(-1);
              }}
              aria-label="Previous photo"
              className="absolute left-3 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/65 text-white shadow-lg ring-1 ring-white/30 hover:bg-black/85 focus-visible:outline-2 focus-visible:outline-white sm:left-5"
            >
              <ChevronLeft aria-hidden="true" className="size-7" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                step(1);
              }}
              aria-label="Next photo"
              className="absolute right-3 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/65 text-white shadow-lg ring-1 ring-white/30 hover:bg-black/85 focus-visible:outline-2 focus-visible:outline-white sm:right-5"
            >
              <ChevronRight aria-hidden="true" className="size-7" />
            </button>
          </>
        ) : null}
      </div>

      {many ? (
        <div
          className="flex items-center justify-center gap-3 pb-5 text-white"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="rounded-full bg-black/65 px-2.5 py-0.5 text-xs font-medium tabular-nums">
            {index + 1} / {photos.length}
          </span>
          <span className="flex items-center gap-1.5">
            {photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onIndexChange(i)}
                aria-label={`Photo ${i + 1} of ${photos.length}`}
                aria-current={i === index}
                className={`size-2.5 rounded-full transition-colors ${
                  i === index ? 'bg-white' : 'bg-white/35 hover:bg-white/60'
                }`}
              />
            ))}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The badge on the primary picture, and the button on every other one. The
 * catalogue picture is not an attachment, so making it lead means clearing the
 * choice - offered only when there is a choice to clear.
 */
function PrimaryControl({ photo, primary }: { photo: LightboxPhoto; primary: LightboxPrimary }) {
  const id = primary.idOf(photo);
  const isPrimary = id !== null && id === primary.currentId;
  if (isPrimary) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium text-white">
          <Star aria-hidden="true" className="size-3.5 fill-current" />
          Primary image
        </span>
        {/* The way back: an asset with no catalogue listing has no catalogue
            slide, so without this its choice could be moved but never undone. */}
        <button
          type="button"
          disabled={primary.busy}
          onClick={() => primary.onSet(null)}
          className="rounded-full px-3 py-1.5 text-xs font-medium text-white/85 ring-1 ring-white/35 hover:bg-white/10 hover:text-white disabled:opacity-60"
        >
          {primary.busy ? 'Clearing…' : 'Clear'}
        </button>
      </span>
    );
  }
  if (id === null && primary.currentId === null) return null;
  return (
    <button
      type="button"
      disabled={primary.busy}
      onClick={() => primary.onSet(id)}
      className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-white/90 disabled:opacity-60"
    >
      <Star aria-hidden="true" className="size-3.5" />
      {primary.busy ? 'Saving…' : id === null ? 'Show catalogue picture first' : 'Set as primary'}
    </button>
  );
}
