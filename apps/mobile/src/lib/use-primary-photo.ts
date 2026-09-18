import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useSession } from '../providers/session';
import { problemMessage } from './asset-admin';
import { PRIMARY_FAILED_TITLE, primaryChangedAlert, primaryPhotoBody, primaryPhotoPath } from './primary-photo';

/**
 * Choosing an asset's primary picture (v2.66; web: use-primary-photo.ts).
 *
 * One hook, because the choice is offered in three places on the asset screen:
 * the lead box's slideshow, the strip of unit photos under it, and the
 * condition-photo section's viewer - the owner should be able to make a
 * handover photo the primary from wherever he is looking at it.
 *
 * `setPrimary` resolves to whether it was saved, so the caller can shut its
 * viewer on success and leave it open on a refusal. A refusal is an Alert
 * rather than inline text: it has to be readable over a full-screen viewer,
 * which covers anything the screen underneath could show.
 */
export function usePrimaryPhoto(assetId: string, onChanged: () => void) {
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  // A second tap while the first request is in flight must not send a second
  // request; state alone would let one through before the re-render.
  const inFlight = useRef(false);

  const setPrimary = useCallback(
    async (photoId: string | null): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusy(true);
      try {
        await api.request(primaryPhotoPath(assetId), { method: 'PATCH', body: primaryPhotoBody(photoId) });
        // The asset is reloaded: `photo` is the new primary, so the lead box,
        // the header thumbnail and the slide order all follow from it.
        onChanged();
        const done = primaryChangedAlert(photoId);
        Alert.alert(done.title, done.message);
        return true;
      } catch (e) {
        Alert.alert(PRIMARY_FAILED_TITLE, problemMessage(e, 'Try again in a moment.'));
        return false;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [api, assetId, onChanged],
  );

  return { setPrimary, busy };
}
