'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageOff, X } from 'lucide-react';
import { API_BASE, getAccessToken } from '@/lib/api-client';
import { imageCaption, type PendingImage } from '@/lib/comment-images';
import { Skeleton } from '@/components/ui';
import { PhotoLightbox, type LightboxPhoto } from '@/components/assets/photo-lightbox';

/**
 * Pictures in a request conversation (v2.60): the ones waiting to go out with
 * the message being written, and the ones already sent, inline in the thread.
 */

export interface CommentAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
}

/** Thumbnails of what will go with the message, each with its size and a remove control. */
export function PendingImageStrip({
  images,
  previews,
  onRemove,
  disabled,
}: {
  images: PendingImage<File>[];
  /** key -> object URL, owned by the composer so it can revoke them. */
  previews: Record<string, string>;
  onRemove: (key: string) => void;
  disabled: boolean;
}) {
  if (images.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Images to send">
      {images.map((image) => (
        <li
          key={image.key}
          className="relative w-28 rounded-[var(--radius-control)] border border-[var(--color-border)] p-1"
        >
          {previews[image.key] ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL; nothing to optimise.
            <img
              src={previews[image.key]}
              alt=""
              className="h-20 w-full rounded object-cover"
            />
          ) : (
            <div className="grid h-20 w-full place-items-center rounded bg-[var(--color-surface-sunken)] text-[var(--color-content-subtle)]">
              <ImageOff aria-hidden="true" className="size-4" />
            </div>
          )}
          <p className="mt-1 truncate text-[11px] text-[var(--color-content-muted)]" title={image.caption}>
            {image.caption}
          </p>
          <button
            type="button"
            onClick={() => onRemove(image.key)}
            disabled={disabled}
            aria-label={`Remove ${image.file.name}`}
            className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-content-muted)] shadow-sm hover:text-[var(--tone-critical-fg)] disabled:opacity-50"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * One sent image behind the API's auth: the bytes are fetched with the token
 * and handed to <img> as an object URL, revoked on unmount - the same approach
 * as condition photos, for the same reason (a bare src cannot carry a header).
 */
function SentImage({
  requestId,
  attachment,
  onReady,
  onOpen,
}: {
  requestId: string;
  attachment: CommentAttachment;
  onReady: (id: string, url: string) => void;
  onOpen: (id: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const revoke = useRef<string | null>(null);
  const caption = imageCaption(attachment.originalName, attachment.sizeBytes);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/requests/${requestId}/attachments/${attachment.id}`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (!alive) return;
        const objectUrl = URL.createObjectURL(blob);
        revoke.current = objectUrl;
        setUrl(objectUrl);
        onReady(attachment.id, objectUrl);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      if (revoke.current) URL.revokeObjectURL(revoke.current);
    };
  }, [requestId, attachment.id, onReady]);

  return (
    <figure className="w-fit max-w-[240px]">
      {failed ? (
        <div className="grid h-24 w-40 place-items-center rounded-[var(--radius-control)] border border-[var(--color-border)] text-[var(--color-content-subtle)]">
          <ImageOff aria-hidden="true" className="size-5" />
        </div>
      ) : !url ? (
        <Skeleton className="h-32 w-40 rounded-[var(--radius-control)]" />
      ) : (
        <button
          type="button"
          onClick={() => onOpen(attachment.id)}
          aria-label={`View ${attachment.originalName} at full size`}
          className="block cursor-zoom-in"
        >
          {/* eslint-disable-next-line @next/next/no-img-element --
              an object URL from an authenticated fetch; next/image cannot
              fetch it and the picture must not be cached anywhere shared. */}
          <img
            src={url}
            alt={attachment.originalName}
            className="max-h-[240px] max-w-[240px] rounded-[var(--radius-control)] border border-[var(--color-border)] object-cover transition-opacity hover:opacity-90"
          />
        </button>
      )}
      <figcaption className="mt-1 max-w-[240px] truncate text-[11px] text-[var(--color-content-subtle)]" title={caption}>
        {caption}
      </figcaption>
    </figure>
  );
}

/** The pictures under one message, with a full-size viewer that steps through them. */
export function CommentImages({
  requestId,
  attachments,
  sentBy,
  sentAt,
  isInternal,
}: {
  requestId: string;
  attachments: CommentAttachment[];
  sentBy: string;
  sentAt: string;
  isInternal: boolean;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const onReady = useCallback((id: string, url: string) => setUrls((prev) => ({ ...prev, [id]: url })), []);

  const images = attachments.filter((a) => a.isImage);
  if (images.length === 0) return null;

  // Only the ones that have loaded can be viewed; the index is over that set.
  const viewable: LightboxPhoto[] = images
    .filter((a) => urls[a.id])
    .map((a) => ({
      id: a.id,
      url: urls[a.id]!,
      caption: imageCaption(a.originalName, a.sizeBytes),
      takenAt: sentAt,
      by: sentBy,
      stageLabel: isInternal ? 'Internal note' : 'Message',
    }));
  const openIndex = openId ? viewable.findIndex((p) => p.id === openId) : -1;

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {images.map((a) => (
          <SentImage key={a.id} requestId={requestId} attachment={a} onReady={onReady} onOpen={setOpenId} />
        ))}
      </div>
      {openIndex >= 0 ? (
        <PhotoLightbox
          photos={viewable}
          index={openIndex}
          onClose={() => setOpenId(null)}
          onIndexChange={(next) => setOpenId(viewable[next]?.id ?? null)}
        />
      ) : null}
    </>
  );
}
