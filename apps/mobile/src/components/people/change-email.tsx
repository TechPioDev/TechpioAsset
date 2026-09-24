import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { peopleGates } from '../../lib/people-admin';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { Button, Field } from '../ui';
import { errorText } from './sheet';
import { toast } from '../toast';

/**
 * Change the address a person signs in with - the web's ChangeEmail, on the
 * phone.
 *
 * Super Admin alone, matching the server: users:manage is not enough, because
 * the Company Admin holds it too and changing a sign-in address hands the
 * account over. Renders nothing for anyone else.
 */
export function ChangeEmailRow({
  userId,
  current,
  onChanged,
}: {
  userId: string;
  current: string;
  onChanged: () => void;
}) {
  const { api, user } = useSession();
  const { c, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!peopleGates(user).canChangeEmail) return null;

  const trimmed = value.trim().toLowerCase();
  const unchanged = trimmed === current.trim().toLowerCase();

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.request<{ id: string; email: string }>(`/users/${userId}/email`, {
        method: 'PATCH',
        body: { email: trimmed },
      });
      setOpen(false);
      toast.say('Sign-in email changed', `They now sign in with ${result.email}`);
      onChanged();
    } catch (e) {
      // The server names the actual rule - address in use, not an address,
      // a platform operator - which beats anything generic here.
      setError(errorText(e, 'Could not change the email address'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: c.subtle, fontSize: 12 }}>Sign-in email</Text>
          <Text style={{ color: c.text, fontSize: 14, fontWeight: '600', marginTop: 2 }} numberOfLines={1}>
            {current}
          </Text>
        </View>
        {!open ? (
          <Pressable
            onPress={() => {
              setValue(current);
              setError(null);
              setOpen(true);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Change sign-in email"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Ionicons name="create-outline" size={16} color={c.brand} />
            <Text style={{ color: c.brand, fontSize: 13, fontWeight: '700' }}>Change</Text>
          </Pressable>
        ) : null}
      </View>

      {open ? (
        <View style={{ marginTop: spacing.md }}>
          <Field
            label="New sign-in email"
            value={value}
            onChangeText={setValue}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoFocus
          />
          <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17, marginBottom: spacing.md }}>
            They will sign in with this address from now on. Their password does not change, and both the
            old and the new address are told.
          </Text>
          {error ? <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>{error}</Text> : null}
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button label="Change it" onPress={save} loading={busy} disabled={unchanged} style={{ flex: 1 }} />
            <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} style={{ flex: 1 }} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
