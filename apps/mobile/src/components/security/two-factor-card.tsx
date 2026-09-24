import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import {
  formatSecret,
  isCompleteCode,
  parseOtpauthUrl,
  postCredential,
  problemMessage,
  sanitizeCode,
} from '../../lib/account-security';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { Button, Card } from '../ui';
import { CodeField, PasswordField } from './password-field';
import { toast } from '../toast';
import { confirm } from '../confirm';

/**
 * Two-factor authentication: set up, turn on, turn off - the web security
 * page's flow, against the same endpoints.
 *
 * Set up: POST /auth/mfa/enrol returns a secret and an otpauth URI. The web
 * draws a QR; a phone is usually the device the authenticator lives on, so
 * this offers "Open in authenticator app" (the otpauth link, handed to the OS)
 * and the key as selectable text to type in. Turning it on needs a current
 * code (POST /auth/mfa/confirm). Turning it off needs the password AND a code
 * (POST /auth/mfa/disable). There are no recovery codes: the web has none.
 *
 * The secret lives only in this component's state between "set up" and
 * "turn on"/"cancel", and is dropped when the screen closes. It is never
 * logged, stored or sent anywhere else.
 */
export function TwoFactorCard({
  enabled,
  onChanged,
}: {
  enabled: boolean;
  /** Re-reads the account after a change, so the status shown is the server's. */
  onChanged: () => Promise<void>;
}) {
  const { api } = useSession();
  const { c, spacing, radius } = useTheme();

  const [enrolment, setEnrolment] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirmCode, setConfirmCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disabling, setDisabling] = useState(false);

  // Once it is on (from here or elsewhere) there is nothing left to enrol.
  useEffect(() => {
    if (enabled) {
      setEnrolment(null);
      setConfirmCode('');
    } else {
      setDisablePassword('');
      setDisableCode('');
    }
  }, [enabled]);

  async function start() {
    setStarting(true);
    try {
      const result = await api.request<{ secret: string; otpauthUrl: string }>('/auth/mfa/enrol', {
        method: 'POST',
      });
      setEnrolment(result);
    } catch (error) {
      toast.say('Could not start enrolment', problemMessage(error, 'Could not start enrolment'));
    } finally {
      setStarting(false);
    }
  }

  function cancel() {
    setEnrolment(null);
    setConfirmCode('');
  }

  async function openInAuthenticator() {
    const url = enrolment?.otpauthUrl;
    // Only ever hand the OS a TOTP link - never whatever string came back.
    if (!url || !parseOtpauthUrl(url)) {
      toast.say('Enter the key manually', 'Add the setup key below to your authenticator app.');
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      toast.say(
        'No authenticator app found',
        'Install an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…), or add the setup key below to one by hand.',
      );
    }
  }

  async function turnOn() {
    if (!isCompleteCode(confirmCode)) return;
    setConfirming(true);
    try {
      await postCredential(api, '/auth/mfa/confirm', { code: confirmCode });
      setEnrolment(null);
      setConfirmCode('');
      await onChanged();
      toast.say('Two-factor authentication is on');
    } catch (error) {
      setConfirmCode('');
      toast.say('That code did not match', problemMessage(error, 'That code did not match'));
    } finally {
      setConfirming(false);
    }
  }

  async function turnOff() {
    if (!disablePassword || !isCompleteCode(disableCode)) return;
    setDisabling(true);
    try {
      await postCredential(api, '/auth/mfa/disable', { password: disablePassword, code: disableCode });
      setDisablePassword('');
      setDisableCode('');
      await onChanged();
      toast.say('Two-factor authentication is off');
    } catch (error) {
      setDisableCode('');
      toast.say('Could not disable', problemMessage(error, 'Could not disable'));
    } finally {
      setDisabling(false);
    }
  }

  const details = enrolment ? parseOtpauthUrl(enrolment.otpauthUrl) : null;

  return (
    <Card style={{ marginBottom: spacing.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons
          name={enabled ? 'shield-checkmark-outline' : 'shield-outline'}
          size={18}
          color={enabled ? c.success : c.warning}
        />
        <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>Two-factor authentication</Text>
      </View>
      <Text style={{ color: c.subtle, fontSize: 12, marginTop: 4, lineHeight: 17 }}>
        {enabled
          ? 'Enabled. Signing in asks for a 6-digit code from your authenticator app.'
          : 'Off. Anyone with your password can sign in as you.'}
      </Text>

      {!enabled && !enrolment ? (
        <Button
          label="Set up two-factor authentication"
          icon="shield-checkmark-outline"
          loading={starting}
          onPress={() => void start()}
          style={{ marginTop: spacing.md }}
        />
      ) : null}

      {!enabled && enrolment ? (
        <View style={{ marginTop: spacing.md }}>
          <Text style={{ color: c.text, fontSize: 14, lineHeight: 20, marginBottom: spacing.md }}>
            Add this account to your authenticator app (Google Authenticator, 1Password, Authy…), then enter the
            6-digit code it shows.
          </Text>

          <Button
            label="Open in authenticator app"
            icon="open-outline"
            variant="secondary"
            onPress={() => void openInAuthenticator()}
            style={{ marginBottom: spacing.md }}
          />

          <Text style={{ color: c.subtle, fontSize: 12, marginBottom: 6 }}>
            Authenticator on another device, or the button did nothing? Enter this setup key manually
            {details?.account ? ` for ${details.account}` : ''} (press and hold to copy):
          </Text>
          <View
            style={{
              backgroundColor: c.surface,
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: radius.md,
              paddingHorizontal: 12,
              paddingVertical: 10,
              marginBottom: spacing.md,
            }}
          >
            <Text
              selectable
              style={{ color: c.text, fontSize: 16, fontWeight: '600', letterSpacing: 1.5, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) }}
            >
              {formatSecret(enrolment.secret)}
            </Text>
          </View>
          <Text style={{ color: c.subtle, fontSize: 12, marginBottom: spacing.md }}>
            Time-based (TOTP), 6 digits. Keep this key private - anyone with it can generate your codes.
          </Text>

          <CodeField value={confirmCode} onChangeText={(v) => setConfirmCode(sanitizeCode(v))} />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button
              label="Turn on"
              loading={confirming}
              disabled={!isCompleteCode(confirmCode)}
              onPress={() => void turnOn()}
              style={{ flex: 1 }}
            />
            <Button label="Cancel" variant="secondary" onPress={cancel} style={{ flex: 1 }} />
          </View>
        </View>
      ) : null}

      {enabled ? (
        <View style={{ marginTop: spacing.md }}>
          <Text style={{ color: c.subtle, fontSize: 12, lineHeight: 17, marginBottom: spacing.md }}>
            Turning it off needs your password and a current code — so a phone left unlocked is not enough to remove
            it.
          </Text>
          <PasswordField
            label="Current password"
            value={disablePassword}
            onChangeText={setDisablePassword}
            placeholder="Password"
          />
          <CodeField value={disableCode} onChangeText={(v) => setDisableCode(sanitizeCode(v))} />
          <Button
            label="Turn off"
            variant="danger"
            loading={disabling}
            disabled={!disablePassword || !isCompleteCode(disableCode)}
            onPress={() =>
              void (async () => {
                const ok = await confirm({
                  title: 'Turn off two-factor authentication?',
                  message: 'Anyone with your password will be able to sign in as you.',
                  confirmLabel: 'Turn off',
                  destructive: true,
                });
                if (ok) await turnOff();
              })()
            }
          />
        </View>
      ) : null}
    </Card>
  );
}
