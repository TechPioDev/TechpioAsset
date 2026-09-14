import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Alert } from 'react-native';
import { Button, Card, Screen, SectionTitle, StatusPill } from '../../src/components/ui';
import type { AuthUser } from '@techpioasset/contracts';
import { ChangePasswordCard } from '../../src/components/security/change-password-card';
import { PasswordGate } from '../../src/components/security/password-gate';
import { TwoFactorCard } from '../../src/components/security/two-factor-card';

/**
 * Where you are signed in, and how you got there.
 *
 * "Sign out everywhere else" is offered here now that the server can tell which
 * session is this one: the two calls that need it send the stored refresh token
 * (identifySession), so the caller's own session is excluded rather than caught
 * in the sweep. Before that it would have signed you out of the phone you were
 * holding.
 *
 * Password change and two-factor set-up / turn off live here too now, behind
 * the web page's "Confirm it's you" password gate (src/components/security).
 * The unlock is held in this screen's memory only - leaving the screen locks it
 * again. Sessions and sign-in history stay visible without it, as before.
 */

interface Session {
  id: string;
  device: string | null;
  ipAddress: string | null;
  lastActiveAt: string;
  createdAt: string;
  current: boolean;
}

interface LoginEvent {
  id: string;
  action: string;
  at: string;
  ipAddress: string | null;
  device: string | null;
}

/** User agents are long and mostly noise; the useful part is the platform. */
function shortDevice(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ios/i.test(ua)) return 'iPhone or iPad';
  if (/windows/i.test(ua)) return 'Windows';
  if (/macintosh|mac os/i.test(ua)) return 'Mac';
  if (/linux/i.test(ua)) return 'Linux';
  return ua.slice(0, 40);
}

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

export default function SecuritySettingsScreen() {
  const { api, user } = useSession();
  const { c, spacing } = useTheme();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [history, setHistory] = useState<LoginEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  // The session's user is read once at sign-in, so it goes stale the moment
  // two-factor is switched here. Track the server's answer locally.
  const [mfaEnabled, setMfaEnabled] = useState(Boolean(user?.mfaEnabled));
  useEffect(() => setMfaEnabled(Boolean(user?.mfaEnabled)), [user?.mfaEnabled]);

  const reloadAccount = useCallback(async () => {
    try {
      const me = await api.request<AuthUser>('/auth/me');
      setMfaEnabled(Boolean(me?.mfaEnabled));
    } catch {
      // Keep what is shown; pull to refresh tries again.
    }
  }, [api]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([
        // identifySession: without it the server cannot tell which of these is
        // the phone in your hand, and none would be marked "This device".
        api.request<Session[]>('/auth/sessions', { identifySession: true }).catch(() => []),
        api.request<LoginEvent[]>('/auth/login-history').catch(() => []),
      ]);
      setSessions(s ?? []);
      setHistory((h ?? []).slice(0, 15));
    } finally {
      setLoading(false);
    }
    // Refresh the two-factor status too, in case it was changed on the web.
    await reloadAccount();
  }, [api, reloadAccount]);

  async function revokeOthers() {
    setRevoking(true);
    try {
      const result = await api.request<{ revoked: number }>('/auth/sessions/revoke-others', {
        method: 'POST',
        identifySession: true,
      });
      await load();
      Alert.alert(
        'Done',
        result.revoked === 1
          ? 'One other session was signed out.'
          : `${result.revoked} other sessions were signed out.`,
      );
    } catch {
      Alert.alert('Could not sign out the others', 'Check your connection and try again.');
    } finally {
      setRevoking(false);
    }
  }

  useEffect(() => void load(), [load]);

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <SectionTitle>Account</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        <Row label="Signed in as" value={user?.email ?? '—'} />
        <Row
          label="Two-factor"
          value={mfaEnabled ? 'On' : 'Off'}
          tone={mfaEnabled ? 'good' : 'warn'}
          last
        />
      </Card>

      <SectionTitle>Password and two-factor</SectionTitle>
      {unlocked ? (
        <>
          <TwoFactorCard enabled={mfaEnabled} onChanged={reloadAccount} />
          <ChangePasswordCard />
        </>
      ) : (
        <PasswordGate onConfirmed={() => setUnlocked(true)} />
      )}

      <SectionTitle>{`Signed in on${sessions.length ? ` (${sessions.length})` : ''}`}</SectionTitle>
      {sessions.length === 0 ? (
        <Card style={{ marginBottom: spacing.xl }}>
          <Text style={{ color: c.muted, fontSize: 14 }}>
            {loading ? 'Loading…' : 'No other active sessions.'}
          </Text>
        </Card>
      ) : (
        <Card style={{ padding: 0, marginBottom: spacing.xl }}>
          {sessions.map((s, i) => (
            <View
              key={s.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 16,
                paddingVertical: 13,
                borderBottomWidth: i === sessions.length - 1 ? 0 : 1,
                borderBottomColor: c.border,
              }}
            >
              <Ionicons name="laptop-outline" size={18} color={c.muted} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>
                  {shortDevice(s.device)}
                </Text>
                <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {[s.ipAddress, `active ${when(s.lastActiveAt)}`].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {s.current ? <StatusPill label="This device" bg={c.brandSoft} fg={c.brand} /> : null}
            </View>
          ))}
        </Card>
      )}

      <SectionTitle>Recent sign-ins</SectionTitle>
      {history.length === 0 ? (
        <Card style={{ marginBottom: spacing.xl }}>
          <Text style={{ color: c.muted, fontSize: 14 }}>
            {loading ? 'Loading…' : 'Nothing recorded yet.'}
          </Text>
        </Card>
      ) : (
        <Card style={{ padding: 0, marginBottom: spacing.xl }}>
          {history.map((h, i) => {
            const failed = /FAIL/i.test(h.action);
            return (
              <View
                key={h.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 13,
                  borderBottomWidth: i === history.length - 1 ? 0 : 1,
                  borderBottomColor: c.border,
                }}
              >
                <Ionicons
                  name={failed ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                  size={18}
                  color={failed ? c.danger : c.muted}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: c.text, fontSize: 14 }}>
                    {failed ? 'Failed sign-in' : 'Signed in'}
                  </Text>
                  <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                    {[shortDevice(h.device), h.ipAddress].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={{ color: c.subtle, fontSize: 11 }}>{when(h.at)}</Text>
              </View>
            );
          })}
        </Card>
      )}

      {sessions.length > 1 ? (
        <Button
          label="Sign out of other devices"
          icon="log-out-outline"
          variant="secondary"
          loading={revoking}
          onPress={() => {
            Alert.alert(
              'Sign out of other devices?',
              'Every other phone, tablet and browser signed in as you will be signed out. This device stays signed in.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Sign out others',
                  style: 'destructive',
                  onPress: () => void revokeOthers(),
                },
              ],
            );
          }}
          style={{ marginBottom: spacing.lg }}
        />
      ) : null}
    </Screen>
  );
}

function Row({
  label,
  value,
  tone,
  last,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'warn';
  last?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 13,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.border,
      }}
    >
      <Text style={{ color: c.muted, fontSize: 13 }}>{label}</Text>
      <Text
        style={{
          color: tone === 'warn' ? c.danger : c.text,
          fontSize: 14,
          fontWeight: '600',
        }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}
