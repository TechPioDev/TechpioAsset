import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View, type ViewStyle } from 'react-native';
import { badgeLabel, UNREAD_POLL_MS } from '../lib/notification-inbox';
import { useSession } from '../providers/session';
import { useTheme } from '../theme';

/**
 * Unread notification count, polled like the web bell (every 60s) - but only
 * while the app is in the foreground and someone is signed in. A backgrounded
 * phone asking the server once a minute spends battery to update a badge
 * nobody can see; coming back to the app refreshes it straight away, as does
 * returning to the screen the badge sits on (so reading the inbox clears it).
 */
export function useUnreadNotificationCount(): { count: number; refresh: () => Promise<void> } {
  const { api, status } = useSession();
  const [count, setCount] = useState(0);
  const signedIn = status === 'authenticated';
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!signedIn || inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await api.request<{ count: number }>('/notifications/unread-count');
      setCount(result?.count ?? 0);
    } catch {
      // A missed poll keeps the last count; the next one tries again.
    } finally {
      inFlight.current = false;
    }
  }, [api, signedIn]);

  useEffect(() => {
    if (!signedIn) {
      setCount(0);
      return;
    }
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void refresh();
      timer = setInterval(() => void refresh(), UNREAD_POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    if (AppState.currentState === 'active' || AppState.currentState == null) start();
    const sub = AppState.addEventListener('change', (next) => (next === 'active' ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [signedIn, refresh]);

  // Coming back to the host screen (e.g. from the inbox) re-reads the count.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return { count, refresh };
}

/** A bell with the unread count that opens the inbox. For a screen header. */
export function NotificationBadge({ style, color }: { style?: ViewStyle; color?: string }) {
  const router = useRouter();
  const { c } = useTheme();
  const { count } = useUnreadNotificationCount();
  const label = badgeLabel(count);

  return (
    <Pressable
      onPress={() => router.push('/notifications' as never)}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      hitSlop={8}
      style={({ pressed }) => [
        { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 },
        style,
      ]}
    >
      <Ionicons name={count > 0 ? 'notifications' : 'notifications-outline'} size={22} color={color ?? c.text} />
      {label ? (
        <View
          style={{
            position: 'absolute',
            top: 4,
            right: 2,
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
            borderRadius: 9,
            backgroundColor: c.danger,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: c.background,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{label}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
