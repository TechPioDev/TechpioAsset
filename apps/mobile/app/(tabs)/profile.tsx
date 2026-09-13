import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { registerForPush, type PushState } from '../../src/lib/push';
import { Avatar, Button, Card, Screen, SectionTitle } from '../../src/components/ui';
import type { IconName } from '../../src/components/ui';

/** Profile: identity, push registration, and sign-out. */
export default function ProfileScreen() {
  const { user, api, logout } = useSession();
  const router = useRouter();
  const { c, spacing } = useTheme();
  const [pushState, setPushState] = useState<PushState | 'idle'>('idle');

  // Registration itself happens at sign-in; this repeats it (it is idempotent)
  // so the row shows the real answer rather than a guess.
  useEffect(() => {
    void registerForPush(api).then(setPushState);
  }, [api]);

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  if (!user) return null;

  const pushLabel = {
    idle: 'Setting up…',
    registered: 'On',
    denied: 'Blocked in settings',
    failed: 'Not available',
    unsupported: 'Not on this device',
  }[pushState];

  return (
    <Screen scroll>
      <View style={{ alignItems: 'center', marginBottom: spacing.xl }}>
        <Avatar name={user.displayName ?? user.email} size={72} />
        <Text style={{ color: c.text, fontSize: 20, fontWeight: '800', marginTop: spacing.md }}>
          {user.displayName ?? user.email}
        </Text>
        <Text style={{ color: c.muted, marginTop: 2 }}>{user.email}</Text>
      </View>

      <SectionTitle>Details</SectionTitle>
      <Card style={{ marginBottom: spacing.xl, padding: 0 }}>
        <InfoRow icon="ribbon-outline" label="Role" value={user.roleNames.join(', ') || '—'} />
        {user.departmentName ? (
          <InfoRow icon="business-outline" label="Department" value={user.departmentName} last={!user.officeName} />
        ) : null}
        {user.officeName ? <InfoRow icon="location-outline" label="Office" value={user.officeName} last /> : null}
      </Card>

      <SectionTitle>Notifications</SectionTitle>
      <Card style={{ marginBottom: spacing.xl, padding: 0 }}>
        <InfoRow
          icon="notifications-outline"
          label="Push notifications"
          value={pushLabel}
          last
          valueColor={pushState === 'registered' ? c.success : pushState === 'denied' ? c.danger : c.muted}
        />
      </Card>

      <Button label="Sign out" icon="log-out-outline" variant="danger" onPress={onLogout} />
    </Screen>
  );
}

function InfoRow({
  icon,
  label,
  value,
  valueColor,
  last = false,
}: {
  icon: IconName;
  label: string;
  value: string;
  valueColor?: string;
  last?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.border,
      }}
    >
      <Ionicons name={icon} size={18} color={c.subtle} />
      <Text style={{ color: c.muted, fontSize: 14, flex: 1 }}>{label}</Text>
      <Text style={{ color: valueColor ?? c.text, fontSize: 14, fontWeight: '600', maxWidth: '55%', textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}
