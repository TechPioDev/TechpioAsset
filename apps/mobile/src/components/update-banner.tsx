import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { apkUrl, checkForUpdate, createUpdateSession, updateBannerText } from '../lib/app-update';
import { apiUrl } from '../providers/session';
import { useTheme } from '../theme';

/**
 * "Update available" on Home (0.3.29).
 *
 * This app has no expo-updates: a fix reaches a phone only when somebody
 * installs the new APK, and until now nothing on the phone said there was one.
 * People stayed on builds months old and reported bugs that were long fixed.
 *
 * The check runs when Home gains focus, once per time the app is opened, beside
 * Home's own loading and never in front of it - the banner appears when the
 * answer arrives, or not at all. Every failure is silent (see app-update.ts).
 *
 * Module state, not component state, holds what was found and whether "Later"
 * was pressed: tabs unmount, and a banner that came back every time somebody
 * returned to Home would make "Later" mean "for the next four seconds".
 */
const session = createUpdateSession();

export function UpdateBanner() {
  const { c, spacing, radius } = useTheme();
  const [found, setFound] = useState(session.found);
  const [dismissed, setDismissed] = useState(session.dismissed);

  useFocusEffect(
    useCallback(() => {
      // The published file is an Android APK. An iPhone or the browser build
      // has nothing to do with it.
      if (Platform.OS !== 'android') return;
      if (!session.claimCheck()) return;
      void checkForUpdate({
        apiUrl,
        // The same number More shows as "build NN" - what this APK was built as.
        installedVersionCode: Constants.expoConfig?.android?.versionCode ?? null,
        fetchImpl: (url, init) => fetch(url, init),
      }).then((manifest) => {
        session.found = manifest;
        setFound(manifest);
      });
    }, []),
  );

  const download = apkUrl(apiUrl);
  if (!found || dismissed || !download) return null;

  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: c.brandSoft,
        borderColor: c.brand,
        borderWidth: 1,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginBottom: spacing.lg,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Ionicons name="cloud-download-outline" size={20} color={c.brand} />
        <Text style={{ color: c.text, fontSize: 14, fontWeight: '700', flex: 1 }}>
          {updateBannerText(found)}
        </Text>
      </View>
      <Text style={{ color: c.muted, fontSize: 12, marginTop: 4, lineHeight: 17 }}>
        Update downloads the new app. Open the file when it finishes to install it.
      </Text>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md }}>
        <Pressable
          onPress={() => {
            // This session only, by design: the next time the app is opened the
            // newer build is still newer, and it is worth saying so again.
            session.dismissed = true;
            setDismissed(true);
          }}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Later"
          style={({ pressed }) => ({
            paddingVertical: 10,
            paddingHorizontal: 16,
            borderRadius: radius.md,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: c.muted, fontWeight: '700', fontSize: 14 }}>Later</Text>
        </Pressable>
        <Pressable
          // Handed to the system browser, which downloads the APK and offers to
          // install it. A failure to open is swallowed: there is no useful
          // sentence to show, and the banner is still there to press again.
          onPress={() => void Linking.openURL(download).catch(() => undefined)}
          accessibilityRole="button"
          accessibilityLabel={`Update to version ${found.version}`}
          style={({ pressed }) => ({
            backgroundColor: c.brand,
            paddingVertical: 10,
            paddingHorizontal: 20,
            borderRadius: radius.md,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Text style={{ color: c.brandText, fontWeight: '700', fontSize: 14 }}>Update</Text>
        </Pressable>
      </View>
    </View>
  );
}
