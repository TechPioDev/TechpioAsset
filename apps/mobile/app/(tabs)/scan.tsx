import { Ionicons } from '@expo/vector-icons';
import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { NativeOnlyNotice } from '../../src/components/native-only-notice';
import { SavedScansSheet } from '../../src/components/saved-scans-sheet';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import {
  isNetworkFailure,
  lookupFailureMessage,
  OFFLINE_SCAN_MESSAGES,
  SavedScans,
  withLookupTimeout,
  type SavedScan,
} from '../../src/lib/offline-scans';
import { qrTokenFrom } from '../../src/lib/qr';
import { PICKER_UNAVAILABLE_MESSAGE, pickImageFromLibrary } from '../../src/lib/pick-image';
import {
  LIVE_BARCODE_TYPES,
  photoBarcodeTypes,
  SCAN_MESSAGES,
  tokenFromPhotoResults,
} from '../../src/lib/scan-code';
import { SqliteStore } from '../../src/lib/sqlite-store';

// 0.3.29 - codes read with no connection. SQLite, like the stocktake queue and
// for the same reason: a code scanned in the basement on Friday has to be
// there on Monday, through an app kill and a restart.
const savedScans = new SavedScans(new SqliteStore());

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
 *
 * 0.3.29 - scanning with no signal. The lookup used to fail the same way
 * whether the server said "no such asset" or was never reached, and both read
 * as "that code does not match an asset you can access" - untrue in a store
 * room with no coverage, where nobody had been asked. A lookup that cannot
 * reach the server now saves the code instead, says so, and lets the person
 * carry on scanning; "Saved scans" opens them once there is a connection. A
 * lookup the server answered - 404, 403, anything - is never saved: a
 * connection would not change that answer. See src/lib/offline-scans.ts.
 */
export default function ScanScreen() {
  const { api } = useSession();
  const router = useRouter();
  // 0.3.29 - useTheme rather than the device scheme, so this screen follows
  // Settings > Appearance like the rest of the app (and like the sheet it opens).
  const { c } = useTheme();

  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  // Not an error, so not shown as one: the scan worked, the network did not.
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedScan[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [readingPhoto, setReadingPhoto] = useState(false);
  // Guard so a single physical scan does not fire many lookups while the camera
  // keeps reporting the same code frame after frame.
  const handling = useRef(false);

  // Re-read on focus, not once: opening a saved scan leaves this screen for the
  // asset, and coming back must show the list without the one just opened.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void savedScans
        .list()
        .then((list) => {
          if (live) setSaved(list);
        })
        .catch(() => undefined);
      return () => {
        live = false;
      };
    }, []),
  );

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

  /** The lookup itself, shared by a fresh scan and a saved one being retried. */
  function lookUp(token: string): Promise<{ id: string }> {
    return withLookupTimeout(
      api.request<{ id: string }>(`/assets/by-qr/${encodeURIComponent(token)}`),
    );
  }

  /** The one path from a token to an open asset, shared by camera and photo. */
  async function openAssetByToken(token: string): Promise<boolean> {
    try {
      const asset = await lookUp(token);
      setSavedNotice(null);
      router.push(`/asset/${asset.id}`);
      return true;
    } catch (failure) {
      if (!isNetworkFailure(failure)) {
        // The server answered. Whatever it said, a connection will not change it.
        setSavedNotice(null);
        setError(lookupFailureMessage(failure));
        return false;
      }
      try {
        setSaved(await savedScans.add(token));
        setSavedNotice(OFFLINE_SCAN_MESSAGES.saved);
      } catch {
        // Never claim a save that did not happen.
        setError(
          'No connection, and the code could not be saved on this phone. Scan it again when you are back online.',
        );
      }
      return false;
    }
  }

  /**
   * A saved scan, tried again. Answers with why it did not open, for the sheet
   * to show under that row; null when it did. Only a success removes the row -
   * "still offline" obviously keeps it, and so does a refusal, because the
   * person should read the reason before the code disappears. They can remove
   * it themselves once they have.
   */
  async function openSavedScan(token: string): Promise<string | null> {
    try {
      const asset = await lookUp(token);
      setSaved(await savedScans.remove(token).catch(() => saved));
      setSavedOpen(false);
      setSavedNotice(null);
      router.push(`/asset/${asset.id}`);
      return null;
    } catch (failure) {
      return lookupFailureMessage(failure);
    }
  }

  async function onScanned(code: string) {
    if (handling.current) return;
    handling.current = true;
    setError(null);
    // The saved notice is not cleared here. With no signal the camera re-reads
    // the label in view every second or so and saves it again (one entry, by
    // de-duplication); clearing first would make the notice blink each time.
    // The label encodes the address the token lives at, not the token, so
    // what the camera reads is not what the endpoint takes.
    const token = qrTokenFrom(code);
    if (!token) {
      // Only an empty read reaches here; a foreign code is looked up and
      // allowed to miss, which says the same thing more honestly.
      setSavedNotice(null);
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
    setSavedNotice(null);
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

  // Only when there is something in it. The camera view is kept clear for
  // scanning, and the message that sends somebody here only appears once a
  // code has been saved - so the button is always there when it is asked for.
  const savedButton =
    saved.length > 0 ? (
      <Pressable
        onPress={() => setSavedOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Saved scans, ${saved.length}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          borderWidth: 1,
          borderColor: c.brand,
          backgroundColor: c.brandSoft,
          borderRadius: 10,
          padding: 14,
          marginBottom: 12,
        }}
      >
        <Ionicons name="cloud-offline-outline" size={18} color={c.brand} />
        <Text style={{ color: c.brand, fontWeight: '700' }}>Saved scans ({saved.length})</Text>
      </Pressable>
    ) : null;

  const savedSheet = (
    <SavedScansSheet
      visible={savedOpen}
      scans={saved}
      onClose={() => setSavedOpen(false)}
      onOpen={openSavedScan}
      onRemove={(token) =>
        void savedScans
          .remove(token)
          .then(setSaved)
          .catch(() => undefined)
      }
      onClearAll={() =>
        void savedScans
          .clear()
          .then((list) => {
            setSaved(list);
            setSavedOpen(false);
            setSavedNotice(null);
          })
          .catch(() => undefined)
      }
    />
  );

  // Amber, not the error's red: the scan was read and kept. Dark text on amber
  // in both themes, because white on it is not readable.
  const savedBanner = savedNotice ? (
    <Text
      style={{
        color: '#451a03',
        backgroundColor: '#fbbf24',
        padding: 12,
        borderRadius: 8,
        textAlign: 'center',
        marginBottom: 12,
        fontWeight: '600',
      }}
    >
      {savedNotice}
    </Text>
  ) : null;

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
        {savedBanner}
        {savedButton}
        {photoButton}
        {savedSheet}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: [...LIVE_BARCODE_TYPES] }}
        // Off while Saved scans is open: the camera is still live underneath,
        // and a label in view would start lookups - or open an asset - behind
        // the sheet somebody is reading.
        onBarcodeScanned={savedOpen ? undefined : ({ data }) => void onScanned(data)}
      />
      <View style={{ position: 'absolute', bottom: 24, left: 20, right: 20 }}>
        {errorBanner}
        {savedBanner}
        {savedButton}
        {photoButton}
      </View>
      {savedSheet}
    </View>
  );
}
