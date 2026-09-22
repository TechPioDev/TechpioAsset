import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { notesToShow } from '../src/lib/whats-new';
import { useTheme } from '../src/theme';
import { Button, Card, Screen } from '../src/components/ui';

/** "What's new" (Phase 5, v2.81): what changed since the version this phone last saw. */
export default function WhatsNewScreen() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const router = useRouter();
  const { c, spacing } = useTheme();
  const current = Constants.expoConfig?.version ?? '';
  const releases = notesToShow(current, from ? from : null);

  const done = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  return (
    <Screen scroll>
      <Text style={{ color: c.muted, fontSize: 13, marginBottom: spacing.lg }}>
        PioAssets {current} — here is what you can do now.
      </Text>
      {releases.map((release) => (
        <View key={release.version} style={{ marginBottom: spacing.lg }}>
          {releases.length > 1 ? (
            <Text
              style={{ color: c.subtle, fontSize: 12, fontWeight: '700', marginBottom: spacing.sm }}
            >
              VERSION {release.version}
            </Text>
          ) : null}
          {release.items.map((item) => (
            <Card
              key={item.title}
              style={{ marginBottom: spacing.md, flexDirection: 'row', gap: spacing.md }}
            >
              <Ionicons name={item.icon as never} size={24} color={c.brand} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }}>{item.title}</Text>
                <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>{item.body}</Text>
              </View>
            </Card>
          ))}
        </View>
      ))}
      {releases.length === 0 ? (
        <Text style={{ color: c.muted, fontSize: 14, marginBottom: spacing.lg }}>
          You are up to date.
        </Text>
      ) : null}
      <Button label="Got it" onPress={done} />
    </Screen>
  );
}
