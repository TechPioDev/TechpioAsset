import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useSession } from '../providers/session';
import { notificationRoute } from '../lib/notification-route';
import { registerForPush } from '../lib/push';

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

    const take = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const key = response.notification.request.identifier;
      if (handled.current.has(key)) return;
      handled.current.add(key);
      const route = notificationRoute(response.notification.request.content.data?.linkPath);
      if (route) setPending(route);
    };

    void Notifications.getLastNotificationResponseAsync().then(take).catch(() => undefined);
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
