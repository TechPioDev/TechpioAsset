import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { postCredential } from '../../lib/account-security';
import { ApiError } from '../../lib/api-client';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { Button, Card, IconBadge } from '../ui';
import { PasswordField } from './password-field';

/**
 * "Confirm it's you" - the web security page's re-authentication gate
 * (POST /auth/confirm-password). A signed-in phone is not proof the owner is
 * holding it. The unlock lives in the parent's memory only: leaving the screen
 * asks again, and the password is cleared from state as soon as it is checked.
 */
export function PasswordGate({ onConfirmed }: { onConfirmed: () => void }) {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(false);

  async function submit() {
    if (!password || checking) return;
    setChecking(true);
    try {
      await postCredential(api, '/auth/confirm-password', { password });
      setPassword('');
      onConfirmed();
    } catch (error) {
      setPassword('');
      const rateLimited = error instanceof ApiError && error.status === 429;
      Alert.alert(
        rateLimited ? 'Too many attempts' : 'That password is not correct',
        rateLimited ? 'Wait a minute, then try again.' : undefined,
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card style={{ marginBottom: spacing.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.md }}>
        <IconBadge icon="lock-closed-outline" />
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>Confirm it&apos;s you</Text>
          <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }}>
            Password and two-factor settings are locked behind your password.
          </Text>
        </View>
      </View>
      <PasswordField
        label="Your password"
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      <Button label="Continue" loading={checking} disabled={!password} onPress={() => void submit()} />
    </Card>
  );
}
