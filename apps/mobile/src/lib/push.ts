import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { PUSH_CATEGORY_BUTTONS } from '@techpioasset/domain';
import type { ApiClient } from './api-client';

/**
 * Push registration for this handset (v2.56).
 *
 * Android registers its raw FCM token, which the server sends to directly.
 * The Expo push token this used before could never be issued to a standalone
 * build without an FCM key on an Expo account, so no phone ever registered.
 *
 * Two faults in the old flow are fixed here as well:
 *  - It only ran when someone opened the Profile tab, so most people never
 *    registered. It now runs on every sign-in, from the root layout.
 *  - Nothing unregistered at sign-out. The next person to sign in on the same
 *    handset was refused (the token belongs to another account) while the
 *    first person's alerts kept arriving on a phone they had handed back.
 */

export type PushState = 'unsupported' | 'denied' | 'registered' | 'failed';

/** Must match ANDROID_CHANNEL_ID in the API's FCM provider. */
const CHANNEL_ID = 'default';

async function deviceToken(): Promise<string> {
  // iOS is not built; there, the Expo token keeps the old behaviour.
  if (Platform.OS === 'android')
    return (await Notifications.getDevicePushTokenAsync()).data as string;
  return (await Notifications.getExpoPushTokenAsync()).data;
}

export async function registerForPush(api: ApiClient): Promise<PushState> {
  if (Platform.OS === 'web') return 'unsupported';
  try {
    // On Android 13+ the permission prompt only appears once a channel exists.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Notifications',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let { granted } = await Notifications.getPermissionsAsync();
    if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return 'denied';

    await api.request('/mobile/devices', {
      method: 'POST',
      body: { token: await deviceToken(), platform: Platform.OS === 'ios' ? 'ios' : 'android' },
    });
    return 'registered';
  } catch {
    // Firebase missing from the build, no network, or the token held by an
    // account that never signed out on this handset. None of those should
    // interrupt signing in.
    return 'failed';
  }
}

/** Best effort, and quick: signing out must never wait on it or fail because of it. */
export async function unregisterPush(api: ApiClient): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const token = await deviceToken();
    await api.request(`/mobile/devices/${encodeURIComponent(token)}`, { method: 'DELETE' });
  } catch {
    // Nothing to undo, or offline; the server prunes a dead token on its next send.
  }
}

/**
 * Tell the phone what buttons each kind of push shows (v2.78): Approve /
 * Reject on an approval, Confirm receipt on a handover. Stored by the OS, so
 * it holds for pushes that arrive while the app is closed. Every button opens
 * the app - nothing is approved or confirmed without the screen being seen.
 */
export async function registerPushCategories(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    for (const [category, buttons] of Object.entries(PUSH_CATEGORY_BUTTONS)) {
      await Notifications.setNotificationCategoryAsync(
        category,
        buttons.map((b) => ({
          identifier: b.identifier,
          buttonTitle: b.title,
          options: { opensAppToForeground: true },
        })),
      );
    }
  } catch {
    // An older OS without categories shows the notification without buttons.
  }
}
