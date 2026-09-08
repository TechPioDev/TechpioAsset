import { useEffect, useState } from 'react';
import { Image, Platform, type ImageStyle, type StyleProp } from 'react-native';
import { useTheme } from '../theme';

/**
 * A picture that lives behind the session's bearer token (v2.45).
 *
 * Native <Image> honours `source.headers`; react-native-web ignores them and
 * silently renders nothing at all - no element, not even a failed request - so
 * on the browser build these appear as empty boxes. The browser build is how
 * this app gets reviewed on a laptop, so there it fetches the bytes and hands
 * over an object URL, exactly as the web app does. Native keeps the cheaper
 * path.
 *
 * Lifted out of the condition-photo strip when the catalogue needed the same
 * thing: one copy of that quirk is enough.
 */
export function AuthImage({
  uri,
  headers,
  style,
  accessibilityLabel,
}: {
  uri: string;
  headers: Record<string, string>;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel: string;
}) {
  const { c } = useTheme();
  const [webUri, setWebUri] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let alive = true;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const res = await fetch(uri, { headers });
        if (!res.ok) return;
        const blob = await res.blob();
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setWebUri(objectUrl);
      } catch {
        // Left blank rather than shown broken; the caller's caption still says
        // what it was meant to be.
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uri, headers]);

  const source = Platform.OS === 'web' ? (webUri ? { uri: webUri } : null) : { uri, headers };

  return (
    <Image
      source={source ?? undefined}
      style={[{ backgroundColor: c.border }, style]}
      resizeMode="cover"
      accessibilityLabel={accessibilityLabel}
    />
  );
}
