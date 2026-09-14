import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import {
  canSubmitPasswordChange,
  PASSWORD_RULES_HINT,
  PASSWORDS_DO_NOT_MATCH,
  passwordMismatch,
  postCredential,
  problemMessage,
} from '../../lib/account-security';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { Button, Card } from '../ui';
import { PasswordField } from './password-field';

/**
 * Change password - POST /auth/change-password { currentPassword, newPassword },
 * with the web page's rules text, mismatch message and error wording. Strength
 * rules are enforced by the API (the shared passwordSchema) and its first field
 * error is shown, exactly as the web does.
 *
 * One difference the phone has to be honest about: the server signs out EVERY
 * session on a password change, this phone included. The web finds out on its
 * next token refresh; here that would be a surprise sign-out minutes later, and
 * the stored biometric unlock would silently stop working. So after a change
 * the phone says so and signs out now.
 */
export function ChangePasswordCard() {
  const { api, logout } = useSession();
  const { c, spacing } = useTheme();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!canSubmitPasswordChange(current, next, again) || saving) return;
    setSaving(true);
    try {
      await postCredential(api, '/auth/change-password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setAgain('');
      Alert.alert(
        'Password changed',
        'For your security every device has been signed out, including this one. Sign in again with your new password.',
        [{ text: 'OK', onPress: () => void logout() }],
        { cancelable: false },
      );
    } catch (error) {
      Alert.alert('Could not change password', problemMessage(error, 'Could not change password'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={{ marginBottom: spacing.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md }}>
        <Ionicons name="key-outline" size={18} color={c.brand} />
        <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>Change password</Text>
      </View>
      <PasswordField label="Current password" value={current} onChangeText={setCurrent} placeholder="Current password" />
      <PasswordField label="New password" newPassword value={next} onChangeText={setNext} placeholder="New password" />
      <PasswordField
        label="Repeat new password"
        newPassword
        value={again}
        onChangeText={setAgain}
        placeholder="New password again"
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      <Text style={{ color: c.subtle, fontSize: 12, lineHeight: 17, marginBottom: spacing.sm }}>
        {PASSWORD_RULES_HINT}
      </Text>
      {passwordMismatch(next, again) ? (
        <Text style={{ color: c.danger, fontSize: 12, marginBottom: spacing.sm }}>{PASSWORDS_DO_NOT_MATCH}</Text>
      ) : null}
      <Text style={{ color: c.subtle, fontSize: 12, lineHeight: 17, marginBottom: spacing.md }}>
        Changing it signs you out on every device, including this phone.
      </Text>
      <Button
        label="Change password"
        loading={saving}
        disabled={!canSubmitPasswordChange(current, next, again)}
        onPress={() => void submit()}
      />
    </Card>
  );
}
