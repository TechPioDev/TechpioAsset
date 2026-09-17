import { useEffect, useRef, useState } from 'react';
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
  resizeMode = 'cover',
  onError,
}: {
  uri: string;
  headers: Record<string, string>;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel: string;
  /** Product pictures are shown whole (`contain`); photos fill their frame. */
  resizeMode?: 'cover' | 'contain';
  /**
   * Told once when the bytes cannot be shown (permission, a deleted file), so a
   * caller with something better than a blank box - the asset card's
   * illustration - can fall back to it. Optional: most callers keep the blank.
   */
  onError?: () => void;
}) {
  const { c } = useTheme();
  const [webUri, setWebUri] = useState<string | null>(null);
  // Held in a ref: the callback's identity is not an input, and re-fetching
  // whenever a parent re-renders would re-download the same picture.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let alive = true;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const res = await fetch(uri, { headers });
        if (!res.ok) {
          if (alive) onErrorRef.current?.();
          return;
        }
        const blob = await res.blob();
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setWebUri(objectUrl);
      } catch {
        // Left blank rather than shown broken; the caller's caption still says
        // what it was meant to be.
        if (alive) onErrorRef.current?.();
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
      resizeMode={resizeMode}
      accessibilityLabel={accessibilityLabel}
      onError={onError ? () => onError() : undefined}
    />
  );
}
