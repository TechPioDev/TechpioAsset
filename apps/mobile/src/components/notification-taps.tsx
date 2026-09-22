import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useSession } from '../providers/session';
import { notificationTarget } from '../lib/notification-route';
import { registerForPush, registerPushCategories } from '../lib/push';

// Show a push that arrives while the app is open (v2.57).
//
// Without a handler, expo-notifications hands a foreground notification to JS
// to decide, gets no answer, and drops it - the phone received it and showed
// nothing. With the app in the background the library draws it itself, which
// is why only the open-app case was silent. Set at module load so it is in
// place before the first message, not after this component mounts.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Follows the link in a push notification when it is tapped (v2.55).
 *
 * Nothing did before. The server has always put a link in every push, and the
 * app registered for push, but no code read the link back - so tapping one
 * opened the app on whatever screen it was last left on.
 *
 * Two ways a tap arrives. With the app running, the response listener fires.
 * With the app closed, the tap launches it and the response is waiting to be
 * collected once, which is what getLastNotificationResponseAsync is for. Both
 * are handled, and a response is followed only once, because on some devices
 * a cold-start tap is delivered through both.
 *
 * Renders nothing. Mounted inside the session provider because every screen a
 * notification points at needs a signed-in user: following the link before the
 * session is known would bounce to the login screen and lose the destination.
 */
export function NotificationTaps() {
  const router = useRouter();
  const { status, user, api } = useSession();
  const handled = useRef(new Set<string>());
  const [pending, setPending] = useState<string | null>(null);

  // Register this handset whenever somebody signs in (v2.56). Keyed on the
  // user, so a different person signing in on the same phone registers too.
  const userId = user?.id;
  useEffect(() => {
    if (status !== 'authenticated' || !userId) return;
    void registerForPush(api);
  }, [status, userId, api]);

  // Collect the tap, whether it arrived now or launched the app.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    // v2.78 - the buttons each kind of push shows. Registered on every start,
    // so an updated app replaces what an older one stored.
    void registerPushCategories();

    const take = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const key = response.notification.request.identifier;
      if (handled.current.has(key)) return;
      handled.current.add(key);
      // v2.78 - a button (Approve, Reject, Confirm receipt) leads to the screen
      // that offers it, asked to open it; a plain tap follows the link.
      const route = notificationTarget(
        response.actionIdentifier,
        response.notification.request.content.data as Record<string, unknown> | null,
      );
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
        // Android leaves an alert up after one of its buttons is pressed.
        void Notifications.dismissNotificationAsync(key).catch(() => undefined);
      }
      if (route) setPending(route);
    };

    void Notifications.getLastNotificationResponseAsync()
      .then(take)
      .catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(take);
    return () => subscription.remove();
  }, []);

  // Follow it once there is somebody signed in to see the screen.
  useEffect(() => {
    if (!pending || status !== 'authenticated') return;
    router.push(pending as never);
    setPending(null);
  }, [pending, status, router]);

  return null;
}
