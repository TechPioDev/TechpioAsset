import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, SectionList, Text, View } from 'react-native';
import { EmptyState, ListSkeleton, PullRefresh } from '../src/components/ui';
import {
  groupByDay,
  markAllReadLocally,
  markReadLocally,
  unreadCount,
  type NotificationRow,
} from '../src/lib/notification-inbox';
import { notificationRoute } from '../src/lib/notification-route';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { toast } from '../src/components/toast';

/**
 * In-app notification inbox (mobile).
 *
 * Before this the phone had push only, so anything swiped away from the
 * system tray was gone. Same list and actions as the web bell - newest first,
 * unread highlighted, "Mark all read" - with one addition: tapping a row marks
 * it read (POST /notifications/:id/read), because on a phone there is no
 * hover-and-glance and the unread styling would otherwise never clear.
 *
 * Tapping follows the notification's link through notificationRoute, the same
 * translation push taps use. A link with no phone screen (an invite, the web's
 * security page) just marks the row read and stays here.
 */

const PAGE_SIZE = 50;

export default function NotificationsScreen() {
  const { api } = useSession();
  const router = useRouter();
  const { c, spacing, radius } = useTheme();

  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.request<NotificationRow[]>(`/notifications?pageSize=${PAGE_SIZE}`)) ?? []);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => void load(), [load]);

  const sections = useMemo(() => groupByDay(rows), [rows]);
  const unread = unreadCount(rows);

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await api.request('/notifications/read-all', { method: 'POST' });
      setRows((prev) => markAllReadLocally(prev, new Date().toISOString()));
    } catch {
      toast.say('Could not mark them read', 'Check your connection and try again.');
    } finally {
      setMarkingAll(false);
    }
  }

  function open(item: NotificationRow) {
    if (!item.readAt) {
      setRows((prev) => markReadLocally(prev, item.id, new Date().toISOString()));
      // Fire and forget: a failed mark-read should not stop you reaching the
      // record, and the next refresh shows the server's truth.
      api.request(`/notifications/${encodeURIComponent(item.id)}/read`, { method: 'POST' }).catch(() => undefined);
    }
    const route = notificationRoute(item.linkPath);
    if (route) router.push(route as never);
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 }}
        refreshControl={<PullRefresh refreshing={loading && loaded} onRefresh={load} />}
        ListHeaderComponent={
          rows.length > 0 ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: spacing.sm,
              }}
            >
              <Text style={{ color: c.muted, fontSize: 13 }}>
                {unread > 0 ? `${unread} unread` : 'All caught up'}
              </Text>
              {unread > 0 ? (
                <Pressable
                  onPress={() => void markAllRead()}
                  disabled={markingAll}
                  accessibilityRole="button"
                  hitSlop={8}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    opacity: markingAll ? 0.5 : pressed ? 0.6 : 1,
                  })}
                >
                  <Ionicons name="checkmark-done-outline" size={16} color={c.brand} />
                  <Text style={{ color: c.brand, fontSize: 13, fontWeight: '700' }}>Mark all read</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <Text
            style={{
              color: c.muted,
              fontSize: 12,
              fontWeight: '700',
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              marginTop: spacing.md,
              marginBottom: spacing.sm,
            }}
          >
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => {
          const isUnread = !item.readAt;
          const route = notificationRoute(item.linkPath);
          return (
            <Pressable
              onPress={() => open(item)}
              accessibilityRole="button"
              accessibilityLabel={`${isUnread ? 'Unread. ' : ''}${item.title}. ${item.body}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                gap: 12,
                padding: 14,
                marginBottom: 8,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: isUnread ? c.brand : c.border,
                backgroundColor: isUnread ? c.brandSoft : c.card,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <View style={{ width: 8, paddingTop: 6 }}>
                {isUnread ? (
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.brand }} />
                ) : null}
              </View>
              <View style={{ flex: 1, minWidth: 0, opacity: isUnread ? 1 : 0.7 }}>
                <Text style={{ color: c.text, fontSize: 14, fontWeight: isUnread ? '700' : '500' }}>
                  {item.title}
                </Text>
                {item.body ? (
                  <Text style={{ color: c.muted, fontSize: 13, marginTop: 3, lineHeight: 18 }}>{item.body}</Text>
                ) : null}
                <Text style={{ color: c.subtle, fontSize: 11, marginTop: 6 }}>
                  {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {/* Spec section 28: a simulated delivery is never shown as a real one. */}
                  {item.simulated ? ' · email simulated' : ''}
                </Text>
              </View>
              {route ? <Ionicons name="chevron-forward" size={18} color={c.subtle} style={{ alignSelf: 'center' }} /> : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          !loaded ? (
            // 0.3.29 - the same placeholder rows as every other list, in place
            // of a lone "Loading…".
            <ListSkeleton />
          ) : failed ? (
            <EmptyState
              icon="cloud-offline-outline"
              title="Could not load notifications"
              message="Check your connection, then pull down to try again."
            />
          ) : (
            <EmptyState
              icon="notifications-off-outline"
              title="Nothing yet"
              message="Approvals, handovers and alerts that concern you will appear here."
            />
          )
        }
      />
    </View>
  );
}
