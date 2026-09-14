import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { NativeOnlyNotice } from '../../src/components/native-only-notice';
import { useSession } from '../../src/providers/session';
import { colors } from '../../src/theme';
import {
  PICKER_UNAVAILABLE_MESSAGE,
  pickImageFromLibrary,
  uploadInvoiceImage,
  type InvoiceUploadResult as UploadResult,
  type PickedImage,
} from '../../src/lib/pick-image';

/**
 * Capture a bill with the camera and upload it (spec section 9).
 *
 * The phone camera is the natural place to capture a paper invoice. The photo is
 * uploaded to POST /invoices/upload, which validates it by signature, stores it
 * privately, and runs extraction only if AI is enabled for the company —
 * deterministic verification always follows. This screen only shows what the
 * server reports back; it never claims an extraction ran when it did not.
 */
export default function CaptureBillScreen() {
  const { api } = useSession();
  const scheme = useColorScheme() ?? 'light';
  const c = colors[scheme];

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const photoUri = photo?.uri ?? null;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Capturing and uploading a photo is a device flow; the browser build (for
  // laptop review) has no camera, so show a notice rather than a webcam prompt.
  if (Platform.OS === 'web') {
    return (
      <NativeOnlyNotice
        title="Capturing a bill needs a device"
        message="Photographing an invoice uses the phone camera, which isn't available when the app runs in a browser. Upload bills from the web app on a laptop instead."
      />
    );
  }

  async function capture() {
    const shot = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
    if (shot?.uri) {
      setPhoto({ uri: shot.uri, name: `bill-${Date.now()}.jpg`, type: 'image/jpeg' });
      setResult(null);
      setError(null);
    }
  }

  // A bill that arrived on chat or email is already a photo; retaking it off a
  // screen only loses sharpness. It lands on the same preview and upload.
  async function chooseFromGallery() {
    setError(null);
    const picked = await pickImageFromLibrary();
    if (picked.kind === 'picked') {
      setPhoto(picked.image);
      setResult(null);
    } else if (picked.kind === 'denied') {
      setError('Photo access is off for PioAssets. Allow it in Settings to choose a saved bill.');
    } else if (picked.kind === 'unavailable') {
      setError(PICKER_UNAVAILABLE_MESSAGE);
    }
  }

  async function upload() {
    if (!photo) return;
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadInvoiceImage(api, photo);
      setResult(uploaded);
      setPhoto(null);
    } catch {
      setError('Upload failed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPhoto(null);
    setResult(null);
    setError(null);
  }

  // Result screen — what the server actually did with the bill.
  if (result) {
    const { invoice, extraction } = result;
    const extractionLine = !extraction.ran
      ? 'Saved for manual entry — AI extraction is off for your company.'
      : extraction.simulated
        ? 'A simulated extraction ran (demo mode). Review the draft on the web app.'
        : 'Fields were extracted from the photo. Review and confirm on the web app.';
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: c.background }}
        contentContainerStyle={{ padding: 24 }}
      >
        <View
          style={{
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface,
            borderRadius: 12,
            padding: 18,
          }}
        >
          <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>Bill uploaded</Text>
          <Text style={{ color: c.muted, marginTop: 6 }}>Draft {invoice.invoiceNumber}</Text>
          <Text style={{ color: c.text, marginTop: 12, lineHeight: 20 }}>{extractionLine}</Text>
        </View>
        <Pressable
          onPress={reset}
          style={{ marginTop: 20, backgroundColor: c.brand, borderRadius: 10, padding: 14 }}
        >
          <Text style={{ color: c.brandText, textAlign: 'center', fontWeight: '600' }}>
            Capture another
          </Text>
        </Pressable>
      </ScrollView>
    );
  }

  // Preview + confirm screen.
  if (photoUri) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <Image source={{ uri: photoUri }} style={{ flex: 1 }} resizeMode="contain" />
        {error ? (
          <Text
            style={{
              color: '#fff',
              backgroundColor: '#ef4444',
              padding: 12,
              textAlign: 'center',
            }}
          >
            {error}
          </Text>
        ) : null}
        <View
          style={{
            flexDirection: 'row',
            gap: 12,
            padding: 16,
            backgroundColor: c.surface,
            borderTopWidth: 1,
            borderTopColor: c.border,
          }}
        >
          <Pressable
            onPress={reset}
            disabled={busy}
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: 10,
              padding: 14,
            }}
          >
            <Text style={{ color: c.text, textAlign: 'center', fontWeight: '600' }}>Retake</Text>
          </Pressable>
          <Pressable
            onPress={upload}
            disabled={busy}
            style={{ flex: 1, backgroundColor: c.brand, borderRadius: 10, padding: 14 }}
          >
            {busy ? (
              <ActivityIndicator color={c.brandText} />
            ) : (
              <Text style={{ color: c.brandText, textAlign: 'center', fontWeight: '600' }}>
                Upload
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  // Preview and result need no camera, so a picked photo gets past this gate.
  if (!permission?.granted) {
    return (
      <View
        style={{ flex: 1, backgroundColor: c.background, padding: 24, justifyContent: 'center' }}
      >
        <Text style={{ color: c.text, fontSize: 16, marginBottom: 16 }}>
          Camera access is needed to photograph a bill.
        </Text>
        {error ? <Text style={{ color: c.danger, marginBottom: 12 }}>{error}</Text> : null}
        <Pressable
          onPress={requestPermission}
          style={{ backgroundColor: c.brand, borderRadius: 10, padding: 14 }}
        >
          <Text style={{ color: c.brandText, textAlign: 'center', fontWeight: '600' }}>
            Grant camera access
          </Text>
        </Pressable>
        <Pressable
          onPress={() => void chooseFromGallery()}
          style={{
            marginTop: 12,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: 10,
            padding: 14,
          }}
        >
          <Text style={{ color: c.text, textAlign: 'center', fontWeight: '600' }}>
            Choose from gallery
          </Text>
        </Pressable>
      </View>
    );
  }

  // Camera screen with a shutter button.
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView ref={cameraRef} style={{ flex: 1 }} />
      <View style={{ padding: 20, backgroundColor: c.surface, alignItems: 'center' }}>
        <Text style={{ color: c.muted, fontSize: 12, marginBottom: 12 }}>
          Frame the whole bill, then tap to capture.
        </Text>
        {error ? (
          <Text style={{ color: c.danger, fontSize: 12, marginBottom: 8 }}>{error}</Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' }}>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={capture}
            style={{
              width: 68,
              height: 68,
              borderRadius: 999,
              backgroundColor: c.brand,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 54,
                height: 54,
                borderRadius: 999,
                borderWidth: 3,
                borderColor: c.brandText,
              }}
            />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Pressable
              onPress={() => void chooseFromGallery()}
              accessibilityRole="button"
              accessibilityLabel="Choose from gallery"
              hitSlop={8}
              style={{ alignItems: 'center', gap: 2 }}
            >
              <Ionicons name="images-outline" size={24} color={c.text} />
              <Text style={{ color: c.muted, fontSize: 11 }}>Gallery</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
