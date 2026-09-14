'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, ImageOff, Trash2 } from 'lucide-react';
import { apiFetch, API_BASE, getAccessToken } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { PERMISSIONS, conditionPhotosEmptyMessage } from '@techpioasset/domain';
import { Button, Card, Skeleton } from '@/components/ui';
import { PhotoLightbox, type LightboxPhoto } from './photo-lightbox';

/**
 * Condition photos, before and after (v2.32).
 *
 * Laid out as one row per custody event with handover on the left and return on
 * the right, because the only question anyone brings to this screen is whether
 * something arrived back in the state it went out in. A single gallery sorted by
 * date holds the same pictures and answers nothing: you cannot tell which visit
 * a photo belongs to, and by the time it matters the person who took it has
 * forgotten.
 *
 * The words recorded at each end sit in the same row as the pictures. "GOOD ->
 * FAIR" with two photographs beside it is the whole case, readable at a glance.
 */

interface Photo {
  id: string;
  originalName: string;
  caption: string | null;
  mimeType: string;
  sizeBytes: number;
  takenAt: string;
  by: string | null;
}

interface CustodyGroup {
  assignmentId: string;
  holder: string | null;
  assignedAt: string;
  conditionOut: string;
  returnedAt: string | null;
  conditionIn: string | null;
  open: boolean;
  handover: Photo[];
  returned: Photo[];
}

/**
 * An <img> for a photo behind the API's auth.
 *
 * A bare src cannot carry the Authorization header, so the bytes are fetched
 * and handed to the tag as an object URL - and revoked on unmount, or a page
 * showing a year of handovers leaks every image it has ever rendered.
 */
function AuthedImage({
  assetId,
  photo,
  onReady,
  onOpen,
}: {
  assetId: string;
  photo: Photo;
  /** Hands the blob URL up so the full-size view reuses it instead of refetching. */
  onReady: (photoId: string, url: string) => void;
  onOpen: (photoId: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const revoke = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/assets/${assetId}/photos/${photo.id}`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (!alive) return;
        const objectUrl = URL.createObjectURL(blob);
        revoke.current = objectUrl;
        setUrl(objectUrl);
        onReady(photo.id, objectUrl);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      if (revoke.current) URL.revokeObjectURL(revoke.current);
    };
    // onReady is a stable useCallback in the parent.
  }, [assetId, photo.id, onReady]);

  if (failed) {
    return (
      <div className="grid size-24 place-items-center rounded-[var(--radius-control)] border border-[var(--color-border)] text-[var(--color-content-subtle)]">
        <ImageOff aria-hidden="true" className="size-5" />
      </div>
    );
  }

  if (!url) return <Skeleton className="size-24 rounded-[var(--radius-control)]" />;

  return (
    <button
      type="button"
      onClick={() => onOpen(photo.id)}
      aria-label={`View ${photo.caption ?? 'condition photo'} at full size`}
      className="block cursor-zoom-in"
    >
      {/* eslint-disable-next-line @next/next/no-img-element --
          next/image cannot serve these. The source is an in-memory blob: URL
          created from an authenticated fetch, and the optimizer would have to
          re-request the file server-side with no user token, for a private
          photograph that must not be cached anywhere shared. */}
      <img
        src={url}
        // The caption is the useful description; the filename ("IMG_4821.HEIC")
        // tells a screen-reader user nothing about the condition it shows.
        alt={photo.caption ?? `Condition photo taken ${new Date(photo.takenAt).toLocaleString()}`}
        className="size-24 rounded-[var(--radius-control)] border border-[var(--color-border)] object-cover transition-opacity hover:opacity-90"
      />
    </button>
  );
}

function PhotoColumn({
  title,
  photos,
  assetId,
  canRemove,
  onRemove,
  removingId,
  onReady,
  onOpen,
}: {
  title: string;
  photos: Photo[];
  assetId: string;
  canRemove: boolean;
  onRemove: (id: string) => void;
  removingId: string | null;
  onReady: (photoId: string, url: string) => void;
  onOpen: (photoId: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium text-[var(--color-content-muted)]">{title}</p>
      {photos.length === 0 ? (
        <p className="text-xs text-[var(--color-content-subtle)]">No photos</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <li key={p.id} className="grid gap-1">
              <AuthedImage assetId={assetId} photo={p} onReady={onReady} onOpen={onOpen} />
              <p className="max-w-24 truncate text-[0.7rem] text-[var(--color-content-subtle)]">
                {p.caption ?? new Date(p.takenAt).toLocaleDateString()}
              </p>
              {p.by ? (
                <p className="max-w-24 truncate text-[0.7rem] text-[var(--color-content-subtle)]">
                  {p.by}
                </p>
              ) : null}
              {canRemove ? (
                <button
                  type="button"
                  onClick={() => onRemove(p.id)}
                  disabled={removingId === p.id}
                  className="inline-flex items-center gap-1 text-[0.7rem] text-[var(--tone-danger-fg)] hover:underline disabled:opacity-50"
                >
                  <Trash2 aria-hidden="true" className="size-3" />
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ConditionPhotos({
  assetId,
  holderName,
}: {
  assetId: string;
  /** Who currently holds it, if anyone. Only used to explain an empty state. */
  holderName?: string | null;
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<'HANDOVER' | 'RETURN'>('HANDOVER');
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  /**
   * Blob URLs the thumbnails already fetched, so opening one at full size shows
   * it instantly instead of downloading the same bytes a second time.
   */
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewing, setViewing] = useState<string | null>(null);
  const onReady = useCallback((photoId: string, url: string) => {
    setUrls((prev) => (prev[photoId] === url ? prev : { ...prev, [photoId]: url }));
  }, []);

  // Either custody right is enough - the person issuing kit and the person
  // taking it back are often not the same person.
  const canCapture = can(PERMISSIONS.ASSETS_ASSIGN) || can(PERMISSIONS.ASSETS_RETURN);

  const { data, isPending, isError } = useQuery<CustodyGroup[]>({
    queryKey: ['asset-photos', assetId],
    queryFn: () => apiFetch(`/assets/${assetId}/photos`),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['asset-photos', assetId] });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file);
      body.append('stage', stage);
      const res = await fetch(`${API_BASE}/assets/${assetId}/photos`, {
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
      void refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: async (photoId: string) => {
      setRemovingId(photoId);
      const res = await fetch(`${API_BASE}/assets/${assetId}/photos/${photoId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
      });
      if (!res.ok) {
        const problem = await res.json().catch(() => null);
        throw new Error(problem?.detail ?? problem?.title ?? 'Could not remove that photo');
      }
    },
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: (e: Error) => setError(e.message),
    onSettled: () => setRemovingId(null),
  });

  const groups = data ?? [];
  const current = groups[0];
  // The stage that makes sense right now: an asset out with someone is being
  // photographed on the way out; one that has just come back, on the way in.
  useEffect(() => {
    if (current) setStage(current.open ? 'HANDOVER' : 'RETURN');
  }, [current?.assignmentId, current?.open]);

  /**
   * Only custody events that actually have photographs (v2.34).
   *
   * Every handover used to get a row whether or not anyone photographed it, so
   * an asset with five past holders and no photos rendered five rows of
   * "No photos / No photos". That is a card's worth of screen saying nothing,
   * on the majority of assets - almost none have photos yet, and the ones taken
   * from here on will only ever cover recent handovers. The mobile strip has
   * always filtered this way; the web did not, and should have.
   */
  const withPhotos = groups.filter((g) => g.handover.length + g.returned.length > 0);
  const hasPhotos = withPhotos.length > 0;

  /**
   * Nothing to show, and nothing this person could do about it - so show
   * nothing at all. An employee looking at their own laptop has no business
   * being told about handover records they cannot create.
   *
   * While the query is still running this also renders nothing rather than a
   * skeleton: the common case is an asset with no photos, and flashing a
   * placeholder that resolves to an absent card is worse than a card that
   * simply appears when there is something in it.
   */
  if (isPending || isError) return null;
  if (!hasPhotos && !canCapture) return null;

  /**
   * Every photograph on the asset, in custody order, handover before return.
   *
   * Flattened across custody events on purpose: stepping with the arrow keys is
   * how the comparison actually gets made, and a viewer that stopped at the
   * edge of one handover would force a close-and-reopen at exactly the moment
   * someone is going back and forth between before and after.
   */
  const viewable: LightboxPhoto[] = withPhotos.flatMap((g) => [
    ...g.handover.map((p) => ({ ...p, stageLabel: `At handover · ${g.holder ?? 'unknown holder'}` })),
    ...g.returned.map((p) => ({ ...p, stageLabel: `On return · ${g.holder ?? 'unknown holder'}` })),
  ])
    .filter((p) => urls[p.id])
    .map((p) => ({
      id: p.id,
      url: urls[p.id]!,
      caption: p.caption,
      takenAt: p.takenAt,
      by: p.by,
      stageLabel: p.stageLabel,
    }));

  const viewingIndex = viewing ? viewable.findIndex((p) => p.id === viewing) : -1;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Condition photos</h2>
          <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">
            What it looked like going out, and coming back.
          </p>
        </div>

        {canCapture && current ? (
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              // capture="environment" opens the rear camera straight away on a
              // phone, which is where these photos are actually taken.
              accept="image/jpeg,image/png,image/webp,image/heic"
              capture="environment"
              multiple
              className="sr-only"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = '';
                for (const file of files) upload.mutate(file);
              }}
            />
            <Button
              variant="secondary"
              onClick={() => fileRef.current?.click()}
              loading={upload.isPending}
            >
              <Camera aria-hidden="true" className="size-4" />
              {current.open ? 'Add handover photo' : 'Add return photo'}
            </Button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      {!hasPhotos ? (
        /*
          Nothing photographed yet, but this person can change that - so one
          quiet line, not a card's worth of empty state. Which line depends on
          whether there is a custody event to attach to at all: an asset can
          show a holder while having no handover record, which is how the
          import left them, and telling someone to "assign it first" when the
          panel above says it is already with somebody is how a page loses
          people's trust.
        */
        <p className="mt-3 text-sm text-[var(--color-content-muted)]">
          {conditionPhotosEmptyMessage(Boolean(current), holderName)}
        </p>
      ) : (
        <ul className="mt-4 grid gap-4">
          {withPhotos.map((g) => (
            <li
              key={g.assignmentId}
              className="rounded-[var(--radius-control)] border border-[var(--color-border)] p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{g.holder ?? 'Unknown holder'}</p>
                <p className="text-xs text-[var(--color-content-subtle)]">
                  {new Date(g.assignedAt).toLocaleDateString()}
                  {g.returnedAt ? ` → ${new Date(g.returnedAt).toLocaleDateString()}` : ' → still out'}
                </p>
              </div>

              {/* The recorded condition, in the same line of sight as the
                  pictures of it. */}
              <p className="mt-1 text-xs text-[var(--color-content-muted)]">
                Condition out: <span className="font-medium">{g.conditionOut}</span>
                {g.conditionIn ? (
                  <>
                    {' · '}back: <span className="font-medium">{g.conditionIn}</span>
                  </>
                ) : null}
              </p>

              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <PhotoColumn
                  onReady={onReady}
                  onOpen={setViewing}
                  title="At handover"
                  photos={g.handover}
                  assetId={assetId}
                  // Only while the handover is open: once a return has closed
                  // it, these are the "before" half of a comparison and the
                  // server refuses to delete them anyway.
                  canRemove={canCapture && g.open}
                  onRemove={(id) => remove.mutate(id)}
                  removingId={removingId}
                />
                <PhotoColumn
                  onReady={onReady}
                  onOpen={setViewing}
                  title="On return"
                  photos={g.returned}
                  assetId={assetId}
                  canRemove={false}
                  onRemove={() => {}}
                  removingId={removingId}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {viewingIndex >= 0 ? (
        <PhotoLightbox
          photos={viewable}
          index={viewingIndex}
          onClose={() => setViewing(null)}
          onIndexChange={(next) => setViewing(viewable[next]?.id ?? null)}
        />
      ) : null}
    </Card>
  );
}
