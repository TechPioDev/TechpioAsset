import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { PERMISSIONS } from '@techpioasset/domain';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Button, Card, EmptyState, StatusPill } from '../src/components/ui';
import { useInviteAllPending } from '../src/components/people/invite-all';
import { errorText, InviteLink } from '../src/components/people/sheet';

/**
 * Pending invitations - the web's invitations board.
 *
 * Every account still Invited, when it was invited, whether its link is still
 * alive and how many reminders went out. Resending issues a fresh 7-day link
 * (the old one dies) and shows it for direct hand-over.
 */

interface InvitationRow {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
  invitedAt: string;
  expiresAt: string | null;
  reminders: number;
  status: 'PENDING' | 'EXPIRED';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function PeopleInvitationsScreen() {
  const { api, user } = useSession();
  const { c, spacing } = useTheme();
  const allowed = Boolean(user?.permissions.includes(PERMISSIONS.USERS_MANAGE));

  const [rows, setRows] = useState<InvitationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!allowed) return setLoading(false);
    setLoading(true);
    setError(null);
    try {
      setRows((await api.request<InvitationRow[]>('/users/invitations')) ?? []);
    } catch {
      setError('Could not load invitations.');
    } finally {
      setLoading(false);
    }
  }, [api, allowed]);

  useEffect(() => void load(), [load]);

  const inviteAll = useInviteAllPending(() => {
    // Every earlier link just died, so the ones shown here are stale.
    setLinks({});
    void load();
  });

  async function resend(id: string) {
    setResending(id);
    setRowError((e) => ({ ...e, [id]: '' }));
    try {
      const result = await api.request<{ email: string; inviteUrl: string }>(`/users/${id}/resend-invite`, {
        method: 'POST',
        body: {},
      });
      setLinks((l) => ({ ...l, [id]: result.inviteUrl }));
      void load();
    } catch (e) {
      setRowError((x) => ({ ...x, [id]: errorText(e, 'Could not resend the invitation.') }));
    } finally {
      setResending(null);
    }
  }

  if (!allowed) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <EmptyState
          icon="lock-closed-outline"
          title="No access"
          message="Managing invitations needs user management permission."
        />
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.background }}
      data={rows}
      keyExtractor={(r) => r.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 }}
      ListHeaderComponent={
        <View style={{ marginBottom: spacing.md }}>
          <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19, marginBottom: spacing.md }}>
            Accounts that have been invited but not yet activated. Reminders go out automatically on days
            1, 3 and 6 (configurable in the web app under Settings → Notifications), each with a fresh
            link; after the last link expires the person is told to ask for a new invitation.
          </Text>
          <Button
            label="Invite all pending"
            icon="send-outline"
            variant="secondary"
            onPress={inviteAll.run}
            loading={inviteAll.busy}
          />
          {error ? <Text style={{ color: c.danger, fontSize: 13, marginTop: spacing.md }}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={
        loading || error ? null : (
          <EmptyState
            icon="mail-open-outline"
            title="No pending invitations"
            message="Everyone who was invited has activated their account."
          />
        )
      }
      renderItem={({ item }) => (
        <Card style={{ marginBottom: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                {item.name ?? item.email}
              </Text>
              {item.name ? (
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {item.email}
                </Text>
              ) : null}
            </View>
            <StatusPill
              label={item.status === 'PENDING' ? 'Pending' : 'Expired'}
              bg={item.status === 'PENDING' ? c.brandSoft : c.surface}
              fg={item.status === 'PENDING' ? c.brand : c.muted}
            />
          </View>
          <Text style={{ color: c.muted, fontSize: 12, marginTop: spacing.sm, lineHeight: 18 }}>
            {`Role: ${item.roles.join(', ') || '—'}\nInvited ${formatDate(item.invitedAt)} · Link expires ${formatDate(item.expiresAt)} · Reminders ${item.reminders}`}
          </Text>
          <Button
            label="Resend invitation"
            icon={item.status === 'EXPIRED' ? 'send-outline' : 'refresh-outline'}
            variant="secondary"
            loading={resending === item.id}
            disabled={resending !== null && resending !== item.id}
            onPress={() => void resend(item.id)}
            style={{ marginTop: spacing.md }}
          />
          {rowError[item.id] ? (
            <Text style={{ color: c.danger, fontSize: 13, marginTop: spacing.sm }}>{rowError[item.id]}</Text>
          ) : null}
          {links[item.id] ? <InviteLink url={links[item.id]!} /> : null}
        </Card>
      )}
    />
  );
}
