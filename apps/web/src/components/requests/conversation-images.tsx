'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageOff, ImagePlus } from 'lucide-react';
import { parseMessageBody } from '@techpioasset/domain';
import { API_BASE, ApiError, apiFetch, getAccessToken } from '@/lib/api-client';
import {
  COMMENT_IMAGE_ACCEPT,
  MAX_COMMENT_IMAGES,
  addPendingImages,
  imageCaption,
  removePendingImage,
  type PendingImage,
} from '@/lib/comment-images';
import { Skeleton } from '@/components/ui';
import { PhotoLightbox, type LightboxPhoto } from '@/components/assets/photo-lightbox';

/**
 * Pictures in a request conversation (v2.60), inline in the text since v2.61:
 * the ones being written into the message (see inline-image-editor.tsx), and
 * the ones already sent, rendered where their token sits in the thread. The
 * same pieces serve the new-request form, whose pictures become the
 * conversation's first message.
 */

export interface CommentAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
}

/**
 * The pictures waiting to go out, in the order they sit in the text, with
 * their previews. Previews are object URLs, owned here so they are revoked
 * when a picture is removed, sent, or the page is left. Side effects (toasts,
 * object URLs) stay outside the state updaters, which React may run twice in
 * development.
 */
export function usePendingImages(toast: { error: (message: string) => void }) {
  const [images, setImages] = useState<PendingImage<File>[]>([]);
  const previewsRef = useRef<Record<string, string>>({});
  useEffect(() => () => Object.values(previewsRef.current).forEach((u) => URL.revokeObjectURL(u)), []);

  const pendingRef = useRef(images);
  pendingRef.current = images;

  /** Queues what the server would accept and returns just those, keyed and previewed. */
  const addImages = useCallback(
    (files: Iterable<File> | null | undefined): PendingImage<File>[] => {
      const picked = Array.from(files ?? []);
      if (picked.length === 0) return [];
      const { next, rejected } = addPendingImages(pendingRef.current, picked);
      rejected.forEach((why) => toast.error(why));
      const added = next.slice(pendingRef.current.length);
      for (const p of added) previewsRef.current[p.key] = URL.createObjectURL(p.file);
      pendingRef.current = next;
      setImages(next);
      return added;
    },
    [toast],
  );
  const previewFor = useCallback((key: string): string | undefined => previewsRef.current[key], []);
  const removeImage = useCallback((key: string) => {
    const url = previewsRef.current[key];
    if (url) URL.revokeObjectURL(url);
    delete previewsRef.current[key];
    pendingRef.current = removePendingImage(pendingRef.current, key);
    setImages(pendingRef.current);
  }, []);
  /**
   * The editor reports the pictures still in the text, in reading order. The
   * list follows: reordered to match, and anything the person deleted from
   * the text (backspace, the remove control) is let go here too.
   */
  const setOrder = useCallback((keys: readonly string[]) => {
    const byKey = new Map(pendingRef.current.map((p) => [p.key, p]));
    const next = keys.flatMap((k) => byKey.get(k) ?? []);
    for (const p of pendingRef.current) {
      if (!keys.includes(p.key)) {
        const url = previewsRef.current[p.key];
        if (url) URL.revokeObjectURL(url);
        delete previewsRef.current[p.key];
      }
    }
    const same = next.length === pendingRef.current.length && next.every((p, i) => p === pendingRef.current[i]);
    if (same) return;
    pendingRef.current = next;
    setImages(next);
  }, []);
  const clearImages = useCallback(() => {
    Object.values(previewsRef.current).forEach((u) => URL.revokeObjectURL(u));
    previewsRef.current = {};
    pendingRef.current = [];
    setImages([]);
  }, []);

  return { images, addImages, previewFor, removeImage, setOrder, clearImages };
}

/** "Add image": a file picker limited to what the server takes. */
export function AddImagesButton({
  onFiles,
  disabled,
  label = 'Add images to the message',
}: {
  onFiles: (files: FileList | null) => void;
  disabled: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={COMMENT_IMAGE_ACCEPT}
        multiple
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        title={`Up to ${MAX_COMMENT_IMAGES} images, inserted where the cursor is; you can also drop or paste them`}
        className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-2.5 text-xs font-medium hover:bg-[var(--color-surface-sunken)] disabled:opacity-50"
      >
        <ImagePlus aria-hidden="true" className="size-3.5" />
        Add image
      </button>
    </>
  );
}

/**
 * Posts a message. Plain text goes as JSON; with pictures it is one multipart
 * call - the text with its `pending:N` tokens and the files in that order -
 * so the text and its images land together or not at all.
 */
export async function postComment(
  requestId: string,
  message: { body: string; isInternal: boolean; images: File[] },
): Promise<void> {
  if (message.images.length === 0) {
    await apiFetch(`/requests/${requestId}/comments`, {
      method: 'POST',
      body: { body: message.body, isInternal: message.isInternal },
    });
    return;
  }
  const form = new FormData();
  form.append('body', message.body);
  form.append('isInternal', String(message.isInternal));
  for (const image of message.images) form.append('images', image, image.name);
  const res = await fetch(`${API_BASE}/requests/${requestId}/comments`, {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
    body: form,
  });
  if (!res.ok) throw new ApiError(await res.json().catch(() => null), res.status);
}

/**
 * One sent image behind the API's auth: the bytes are fetched with the token
 * and handed to <img> as an object URL, revoked on unmount - the same approach
 * as condition photos, for the same reason (a bare src cannot carry a header).
 */
function SentImage({
  requestId,
  attachment,
  inline,
  onReady,
  onOpen,
}: {
  requestId: string;
  attachment: CommentAttachment;
  /** In the flow of the text (up to 480px wide) rather than a thumbnail. */
  inline: boolean;
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

  const box = inline ? 'max-h-[360px] max-w-[480px]' : 'max-h-[240px] max-w-[240px]';
  const width = inline ? 'max-w-[480px]' : 'max-w-[240px]';

  return (
    <figure className={`w-fit ${width}`}>
      {failed ? (
        <div className="grid h-24 w-40 place-items-center rounded-[var(--radius-control)] border border-[var(--color-border)] text-[var(--color-content-subtle)]">
          <ImageOff aria-hidden="true" className="size-5" />
        </div>
      ) : !url ? (
        <Skeleton className={`${inline ? 'h-40 w-64' : 'h-32 w-40'} rounded-[var(--radius-control)]`} />
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
            className={`${box} rounded-[var(--radius-control)] border border-[var(--color-border)] object-contain transition-opacity hover:opacity-90`}
          />
        </button>
      )}
      <figcaption className={`mt-1 ${width} truncate text-[11px] text-[var(--color-content-subtle)]`} title={caption}>
        {caption}
      </figcaption>
    </figure>
  );
}

/** Where a token points at a picture the viewer cannot see, or that is gone. */
function UnavailableImage() {
  return (
    <span className="my-1 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-strong)] px-2 py-1 align-bottom text-xs text-[var(--color-content-subtle)]">
      <ImageOff aria-hidden="true" className="size-3.5" />
      Image unavailable
    </span>
  );
}

/**
 * A sent message: its text, with each picture rendered where the writer put
 * it. Pictures the text does not mention (messages from before v2.61, and
 * older phone builds) follow the text as thumbnails, as they always have. A
 * token for an attachment the server did not return - one the viewer may not
 * see, or one since removed - shows as unavailable rather than as a broken
 * picture or a leaked id. One full-size viewer steps through all of them.
 */
export function MessageBody({
  requestId,
  body,
  attachments,
  sentBy,
  sentAt,
  isInternal,
}: {
  requestId: string;
  body: string;
  attachments: CommentAttachment[];
  sentBy: string;
  sentAt: string;
  isInternal: boolean;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const onReady = useCallback((id: string, url: string) => setUrls((prev) => ({ ...prev, [id]: url })), []);

  const images = attachments.filter((a) => a.isImage);
  const byId = new Map(images.map((a) => [a.id, a]));
  const segments = parseMessageBody(body);
  const referenced = new Set(
    segments.flatMap((s) => (s.kind === 'image' && s.ref.kind === 'attachment' && byId.has(s.ref.id) ? [s.ref.id] : [])),
  );
  const trailing = images.filter((a) => !referenced.has(a.id));
  // Pictures in reading order, for the viewer's index.
  const ordered = [
    ...segments.flatMap((s) => (s.kind === 'image' && s.ref.kind === 'attachment' ? (byId.get(s.ref.id) ?? []) : [])),
    ...trailing,
  ].filter((a, i, all) => all.indexOf(a) === i);

  if (segments.length === 0 && images.length === 0) return null;

  // Only the ones that have loaded can be viewed; the index is over that set.
  const viewable: LightboxPhoto[] = ordered
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
      <div className="mt-0.5 text-[var(--color-content-muted)]">
        {segments.map((s, i) => {
          if (s.kind === 'text') {
            return (
              <span key={i} className="whitespace-pre-wrap">
                {s.text}
              </span>
            );
          }
          const attachment = s.ref.kind === 'attachment' ? byId.get(s.ref.id) : undefined;
          if (!attachment) return <UnavailableImage key={i} />;
          return (
            <span key={i} className="my-1 inline-block max-w-full align-bottom">
              <SentImage requestId={requestId} attachment={attachment} inline onReady={onReady} onOpen={setOpenId} />
            </span>
          );
        })}
      </div>
      {trailing.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {trailing.map((a) => (
            <SentImage key={a.id} requestId={requestId} attachment={a} inline={false} onReady={onReady} onOpen={setOpenId} />
          ))}
        </div>
      ) : null}
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
