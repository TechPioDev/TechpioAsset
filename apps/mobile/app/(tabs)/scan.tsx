import { Ionicons } from '@expo/vector-icons';
import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, useColorScheme, View } from 'react-native';
import { NativeOnlyNotice } from '../../src/components/native-only-notice';
import { useSession } from '../../src/providers/session';
import { colors } from '../../src/theme';
import { qrTokenFrom } from '../../src/lib/qr';
import { PICKER_UNAVAILABLE_MESSAGE, pickImageFromLibrary } from '../../src/lib/pick-image';
import {
  LIVE_BARCODE_TYPES,
  photoBarcodeTypes,
  SCAN_MESSAGES,
  tokenFromPhotoResults,
} from '../../src/lib/scan-code';

/**
 * QR / barcode scanner (spec section 15).
 *
 * A scan resolves the code to the authorised asset record via the API's
 * /assets/by-qr endpoint, which enforces the same permission and scope rules as
 * every other read — so a scanned code leaks nothing, and an employee scanning
 * someone else's asset gets a not-found, exactly as the web enforces.
 *
 * v2.27 — what the camera reads is not what that endpoint takes. A printed
 * label carries the address the token lives at, so the scanned string goes
 * through `qrTokenFrom` first. Sending the address itself is what made every
 * web-printed label report "does not match an asset you can access".
 *
 * "Scan from a photo" reads a saved picture of a label (someone sent it on
 * chat, or the label is on a shelf too high to hold a phone to) and then takes
 * the exact same lookup path as the live camera.
 */
export default function ScanScreen() {
  const { api } = useSession();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = colors[scheme];

  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  // Guard so a single physical scan does not fire many lookups while the camera
  // keeps reporting the same code frame after frame.
  const handling = useRef(false);

  // The browser build (react-native-web, for laptop review) has no device
  // camera flow; show a notice rather than a webcam prompt.
  if (Platform.OS === 'web') {
    return (
      <NativeOnlyNotice
        title="Scanning needs the device camera"
        message="QR and barcode scanning uses the phone camera, which isn't available when the app runs in a browser."
      />
    );
  }

  /** Let the live camera try again after a miss, without firing on every frame. */
  function releaseSoon() {
    setTimeout(() => {
      handling.current = false;
    }, 1500);
  }

  /** The one path from a token to an open asset, shared by camera and photo. */
  async function openAssetByToken(token: string): Promise<boolean> {
    try {
      const asset = await api.request<{ id: string }>(`/assets/by-qr/${encodeURIComponent(token)}`);
      router.push(`/asset/${asset.id}`);
      return true;
    } catch {
      setError(SCAN_MESSAGES.notAsset);
      return false;
    }
  }

  async function onScanned(code: string) {
    if (handling.current) return;
    handling.current = true;
    setError(null);
    // The label encodes the address the token lives at, not the token, so
    // what the camera reads is not what the endpoint takes.
    const token = qrTokenFrom(code);
    if (!token) {
      // Only an empty read reaches here; a foreign code is looked up and
      // allowed to miss, which says the same thing more honestly.
      setError(SCAN_MESSAGES.emptyRead);
      releaseSoon();
      return;
    }
    if (!(await openAssetByToken(token))) releaseSoon();
  }

  async function scanFromPhoto() {
    if (handling.current) return;
    handling.current = true;
    setError(null);
    try {
      const picked = await pickImageFromLibrary();
      if (picked.kind === 'cancelled') return;
      if (picked.kind === 'denied') return setError(SCAN_MESSAGES.photoPermission);
      if (picked.kind === 'unavailable') return setError(PICKER_UNAVAILABLE_MESSAGE);

      setReadingPhoto(true);
      let results: { data: string }[];
      try {
        results = await scanFromURLAsync(picked.image.uri, photoBarcodeTypes(Platform.OS));
      } catch {
        return setError(SCAN_MESSAGES.photoUnreadable);
      }
      const found = tokenFromPhotoResults(results, Platform.OS);
      if ('message' in found) return setError(found.message);
      await openAssetByToken(found.token);
    } finally {
      setReadingPhoto(false);
      // Released straight away: a photo is one deliberate read, not a stream.
      handling.current = false;
    }
  }

  const photoButton = (
    <Pressable
      onPress={() => void scanFromPhoto()}
      disabled={readingPhoto}
      accessibilityRole="button"
      accessibilityLabel="Scan from a photo"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        borderRadius: 10,
        padding: 14,
        opacity: readingPhoto ? 0.6 : 1,
      }}
    >
      {readingPhoto ? (
        <ActivityIndicator color={c.text} />
      ) : (
        <Ionicons name="images-outline" size={18} color={c.text} />
      )}
      <Text style={{ color: c.text, fontWeight: '600' }}>
        {readingPhoto ? 'Reading the photo…' : 'Scan from a photo'}
      </Text>
    </Pressable>
  );

  const errorBanner = error ? (
    <Text
      style={{
        color: '#fff',
        backgroundColor: '#ef4444',
        padding: 12,
        borderRadius: 8,
        textAlign: 'center',
        marginBottom: 12,
      }}
    >
      {error}
    </Text>
  ) : null;

  if (!permission) {
    return <View style={{ flex: 1, backgroundColor: c.background }} />;
  }

  if (!permission.granted) {
    // A photo needs no camera, so it stays on offer when the camera is refused.
    return (
      <View
        style={{ flex: 1, backgroundColor: c.background, padding: 24, justifyContent: 'center' }}
      >
        <Text style={{ color: c.text, fontSize: 16, marginBottom: 16 }}>
          Camera access is needed to scan asset codes.
        </Text>
        <Pressable
          onPress={requestPermission}
          style={{ backgroundColor: c.brand, borderRadius: 10, padding: 14, marginBottom: 12 }}
        >
          <Text style={{ color: c.brandText, textAlign: 'center', fontWeight: '600' }}>
            Grant camera access
          </Text>
        </Pressable>
        {errorBanner}
        {photoButton}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: [...LIVE_BARCODE_TYPES] }}
        onBarcodeScanned={({ data }) => void onScanned(data)}
      />
      <View style={{ position: 'absolute', bottom: 24, left: 20, right: 20 }}>
        {errorBanner}
        {photoButton}
      </View>
    </View>
  );
}
