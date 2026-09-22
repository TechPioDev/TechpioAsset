import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { useSession } from '../providers/session';
import { refreshSyncStatus, sendNow, setSyncUser, useSyncStatus } from '../lib/sync-service';
import { useTheme } from '../theme';

/** How often the runner tries while something is waiting. */
const EVERY_MS = 60_000;

/**
 * Sends what was recorded offline, in the background (Phase 6, v2.82):
 * on sign-in, whenever the app comes back to the foreground, and every
 * minute while anything is waiting. Renders nothing.
 */
export function SyncRunner() {
  const { status, api, user } = useSession();
  const { pending } = useSyncStatus();
  const active = status === 'authenticated';
  const userId = active ? (user?.id ?? null) : null;

  useEffect(() => {
    setSyncUser(userId);
  }, [userId]);

  useEffect(() => {
    if (!active) return;
    void sendNow(api).catch(() => undefined);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void sendNow(api).catch(() => undefined);
    });
    return () => sub.remove();
  }, [active, api]);

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!active || pending === 0) return;
    timer.current = setInterval(() => void sendNow(api).catch(() => undefined), EVERY_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [active, pending, api]);

  return null;
}

/**
 * "2 changes waiting to send" / "1 change needs you" - on Home and on the
 * asset page, so nobody wonders whether the handover they recorded in the
 * basement went through. Renders nothing when there is nothing to say.
 */
export function SyncBanner() {
  const { api } = useSession();
  const router = useRouter();
  const { c, spacing, radius } = useTheme();
  const { pending, attention, sending } = useSyncStatus();

  useEffect(() => {
    void refreshSyncStatus();
  }, []);

  if (pending === 0 && attention === 0) return null;
  const needsYou = attention > 0;
  const tint = needsYou ? c.danger : c.warning;
  const text = needsYou
    ? `${attention} ${attention === 1 ? 'change needs' : 'changes need'} you`
    : sending
      ? 'Sending…'
      : `${pending} ${pending === 1 ? 'change' : 'changes'} waiting to send`;
  const sub = needsYou
    ? 'Someone else changed it first. Review.'
    : 'Recorded with no signal. Sent automatically when you are back online.';

  return (
    <Pressable
      onPress={() => (needsYou ? router.push('/sync') : void sendNow(api).catch(() => undefined))}
      onLongPress={() => router.push('/sync')}
      accessibilityRole="button"
      accessibilityHint={needsYou ? 'Opens the changes that need you' : 'Tries to send now'}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        padding: spacing.md,
        marginBottom: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: tint,
        backgroundColor: c.surface,
      }}
    >
      <Ionicons
        name={needsYou ? 'alert-circle-outline' : 'cloud-upload-outline'}
        size={22}
        color={tint}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }}>{text}</Text>
        <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>{sub}</Text>
      </View>
      <Pressable onPress={() => router.push('/sync')} hitSlop={8} accessibilityRole="link">
        <Text style={{ color: c.brand, fontSize: 13, fontWeight: '700' }}>
          {needsYou ? 'Review' : 'Details'}
        </Text>
      </Pressable>
    </Pressable>
  );
}
