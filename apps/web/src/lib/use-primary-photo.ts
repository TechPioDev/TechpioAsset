'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';

/**
 * Choosing an asset's primary picture (v2.66) - the one the detail page leads
 * with and the slideshow opens on. One hook, because the choice is offered in
 * two places: the lead box's slideshow and the condition-photos viewer. Any
 * photograph on the asset qualifies; `null` clears the choice and the page
 * goes back to its default (the catalogue picture, else the unit's photos).
 */
export function usePrimaryPhoto(assetId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (photoId: string | null) =>
      apiFetch(`/assets/${assetId}/primary-photo`, { method: 'PATCH', body: { photoId } }),
    onSuccess: (_data, photoId) => {
      toast.success(
        photoId ? 'Primary image set - it now leads this asset' : 'Catalogue picture leads again',
      );
      void queryClient.invalidateQueries({ queryKey: ['asset', assetId] });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not set the primary image'),
  });
  return { setPrimary: mutation.mutate, busy: mutation.isPending };
}
