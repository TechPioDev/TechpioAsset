'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, controlCls } from '@/components/ui';

/**
 * The Notes tab (v2.61): the asset's free-text notes, edited in place.
 *
 * Goes through the ordinary PATCH /assets/:id with the record's version, so a
 * note typed over somebody else's concurrent edit is refused the same way the
 * edit form's would be. Read-only for anyone without assets:update - the
 * holder still sees the notes, which is the owner's 2026-08-12 decision.
 */
export function AssetNotes({
  assetId,
  notes,
  description,
  version,
  canEdit,
}: {
  assetId: string;
  notes: string | null;
  description: string | null;
  version: number;
  canEdit: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes ?? '');

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/assets/${assetId}`, {
        method: 'PATCH',
        body: { notes: draft.trim() || null, version },
      }),
    onSuccess: async () => {
      toast.success('Notes saved');
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ['asset', assetId] });
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save the notes',
      ),
  });

  return (
    <div className="grid gap-4">
      {description ? (
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Description</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-content-muted)]">
            {description}
          </p>
          {canEdit ? (
            <Link
              href={`/assets/${assetId}/edit`}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand)] hover:underline"
            >
              <Pencil aria-hidden="true" className="size-3" /> Edit on the asset form
            </Link>
          ) : null}
        </Card>
      ) : null}

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">Notes</h2>
            <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">
              Known problems, quirks and anything the next holder should know. Visible to whoever
              holds the device.
            </p>
          </div>
          {canEdit && !editing ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setDraft(notes ?? '');
                setEditing(true);
              }}
            >
              <Pencil aria-hidden="true" className="size-3.5" />{' '}
              {notes ? 'Edit notes' : 'Add notes'}
            </Button>
          ) : null}
        </div>

        {editing ? (
          <form
            className="mt-4 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <textarea
              aria-label="Asset notes"
              rows={8}
              maxLength={4000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className={`${controlCls} h-auto py-2`}
            />
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" loading={save.isPending}>
                Save notes
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <span className="ml-auto text-xs text-[var(--color-content-subtle)]">
                {draft.length} / 4000
              </span>
            </div>
          </form>
        ) : notes ? (
          <p className="mt-4 whitespace-pre-wrap text-sm">{notes}</p>
        ) : (
          <p className="mt-4 text-sm text-[var(--color-content-muted)]">
            No notes recorded for this asset.
          </p>
        )}
      </Card>
    </div>
  );
}
