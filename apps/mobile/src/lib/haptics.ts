import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Touch feedback (U1).
 *
 * The app had none. Every button, every confirmed handover, every failed scan
 * was silent to the hand, which is most of why it read as a web page in a box
 * rather than an app. Four levels, named for the moment rather than the
 * waveform, so a call site says what happened and not how it buzzes.
 *
 * Every call is fire-and-forget and swallows its error. Haptics are missing on
 * web, absent on some Android hardware, and switched off by the person on
 * others - none of which is a reason for a handover to fail, so a rejected
 * promise here must never reach the caller.
 */

const off = Platform.OS === 'web';

/** A control was pressed. The lightest one; use it freely. */
export function tapped() {
  if (off) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

/** Something was committed: a handover recorded, an approval sent. */
export function committed() {
  if (off) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

/** It did not go through, or it needs looking at before it can. */
export function refused() {
  if (off) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
}

/**
 * A scan landed on something. Heavier than a tap because the phone is usually
 * at arm's length pointed at a label, where the screen is not being watched.
 */
export function scanned() {
  if (off) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
}
