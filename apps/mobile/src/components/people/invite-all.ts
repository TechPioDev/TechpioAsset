import { useState } from 'react';
import { Alert } from 'react-native';
import { inviteAllMessage } from '../../lib/people-admin';
import { useSession } from '../../providers/session';
import { errorText } from './sheet';

/**
 * "Invite all pending" - the post-import onboarding move. Confirmed first,
 * because every link people already hold stops working.
 */
export function useInviteAllPending(onDone: () => void) {
  const { api } = useSession();
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      const r = await api.request<{ pending: number; sent: number; failed: string[] }>(
        '/users/invite-all-pending',
        { method: 'POST', body: {} },
      );
      const { ok, message } = inviteAllMessage(r);
      Alert.alert(ok ? 'Invitations' : 'Some invitations failed', message);
      onDone();
    } catch (e) {
      Alert.alert('Could not send invitations', errorText(e, 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const run = () =>
    Alert.alert(
      'Send invitations to everyone pending?',
      'Every account still in the Invited state gets the invitation email with a fresh link. Links they already received stop working - only the newest link counts.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send to all', onPress: () => void send() },
      ],
    );

  return { run, busy };
}
