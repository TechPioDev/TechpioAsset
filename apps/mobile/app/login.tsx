import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { takeDestination } from '../src/lib/pending-route';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Button, Card, Field } from '../src/components/ui';

/**
 * Sign in (v2.24 - matched to the web redesign).
 *
 * Same shape as pioassets.com/login: wordmark inside the card, "Welcome back",
 * a work-email field, and the forgotten-password link beside the password
 * label. The showcase panel that sits next to the web form is deliberately not
 * here - the web hides it below lg for the same reason, that on a phone the
 * form is the whole job.
 *
 * There is no "keep me signed in" either, and that is not an omission. On the
 * web it decides whether the refresh cookie survives the browser closing. Here
 * the refresh token lives in the device keystore behind a biometric unlock,
 * which is the stronger version of the same promise - a checkbox offering to
 * make it weaker would be a worse app, not a more consistent one.
 */
export default function LoginScreen() {
  const router = useRouter();
  const { login, unlockWithBiometrics, status } = useSession();
  const { c, spacing, scheme } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // v2.81 - back to where a shortcut or link was going, if the lock stopped it.
    if (status === 'authenticated') router.replace((takeDestination() ?? '/(tabs)') as never);
  }, [status, router]);

  async function onSubmit() {
    setError(null);
    setBusy(true);
    try {
      const result = await login(email.trim(), password, needsMfa ? mfaCode : undefined);
      if (result === 'mfa-required') setNeedsMfa(true);
    } catch {
      setError('Email or password is incorrect.');
    } finally {
      setBusy(false);
    }
  }

  async function onBiometric() {
    setBusy(true);
    const ok = await unlockWithBiometrics();
    setBusy(false);
    if (!ok) setError('Could not unlock. Sign in with your password.');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', padding: spacing.xl }}
      >
        <Card level={2} style={{ padding: 22 }}>
          <View style={{ alignItems: 'center', marginBottom: spacing.xl }}>
            {/* The wordmark is the brand here - the navy in it disappears on a
                dark background, so the dark rendering is a separate file, not a
                tint. */}
            <Image
              source={
                scheme === 'dark'
                  ? require('../assets/wordmark-dark.png')
                  : require('../assets/wordmark.png')
              }
              style={{ width: 200, height: 37 }}
              resizeMode="contain"
              accessibilityLabel="PioAssets"
            />
            <Text
              style={{
                color: c.text,
                fontSize: 20,
                fontWeight: '700',
                marginTop: spacing.lg,
              }}
            >
              {needsMfa ? 'One more step' : 'Welcome back'}
            </Text>
            <Text style={{ color: c.muted, fontSize: 13, marginTop: 4, textAlign: 'center' }}>
              {needsMfa
                ? 'Confirm the code from your authenticator app.'
                : 'Sign in to your PioAssets account to continue.'}
            </Text>
          </View>

          {status === 'locked' ? (
            <Button
              label="Unlock with biometrics"
              icon="finger-print"
              onPress={onBiometric}
              loading={busy}
              style={{ marginBottom: spacing.md }}
            />
          ) : null}

          {!needsMfa ? (
            <>
              <Field
                label="Work email"
                placeholder="you@company.com"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
              />
              <Field
                label="Password"
                labelRight={
                  <Link href="/forgot-password" asChild>
                    <Pressable hitSlop={8}>
                      <Text style={{ color: c.brand, fontSize: 13, fontWeight: '600' }}>
                        Forgot password?
                      </Text>
                    </Pressable>
                  </Link>
                }
                placeholder="••••••••"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </>
          ) : (
            <Field
              label="Authentication code"
              placeholder="6-digit code"
              keyboardType="number-pad"
              maxLength={6}
              value={mfaCode}
              onChangeText={setMfaCode}
            />
          )}

          {error ? (
            <Text style={{ color: c.danger, marginBottom: spacing.md, fontSize: 13 }}>{error}</Text>
          ) : null}

          <Button label={needsMfa ? 'Verify' : 'Sign in'} onPress={onSubmit} loading={busy} />
        </Card>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            marginTop: spacing.xl,
          }}
        >
          <Ionicons name="shield-checkmark-outline" size={14} color={c.subtle} />
          <Text style={{ color: c.subtle, fontSize: 12 }}>
            Sessions expire automatically and every action is audited.
          </Text>
        </View>

        <Link href="/help" asChild>
          <Pressable style={{ marginTop: spacing.md, alignSelf: 'center' }} hitSlop={8}>
            <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600' }}>Need help?</Text>
          </Pressable>
        </Link>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
