import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { Button } from '../ui';

/**
 * Photograph something and attach it to a request (v2.56).
 *
 * Built on expo-camera, the module condition-photo-sheet.tsx already uses -
 * no new native module, so no new app build. Posts to the same
 * `POST /requests/:id/attachments` the web "Add file" control uses, where the
 * bytes are validated by signature.
 */
export function RequestPhotoSheet({
  visible,
  requestId,
  onClose,
  onUploaded,
}: {
  visible: boolean;
  requestId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const { api } = useSession();
  const { c, spacing, radius } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setPending(null);
    setSaved(0);
    setError(null);
    onClose();
  }

  async function shoot() {
    setError(null);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
      if (photo?.uri) setPending(photo.uri);
    } catch {
      setError('The camera could not take that picture. Try again.');
    }
  }

  async function upload() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', {
        uri: pending,
        name: `request-photo-${Date.now()}.jpg`,
        type: 'image/jpeg',
      } as unknown as Blob);
      await api.request(`/requests/${requestId}/attachments`, { formData: form });
      setPending(null);
      setSaved((n) => n + 1);
      onUploaded();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That photo could not be attached.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: 'rgba(2,6,23,0.45)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: c.background,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            maxHeight: '92%',
            paddingBottom: spacing.xl,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: spacing.lg,
              borderBottomWidth: 1,
              borderBottomColor: c.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>Attach a photo</Text>
              <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>
                {saved > 0 ? `${saved} attached` : 'A photo of the issue, a label or a quote'}
              </Text>
            </View>
            <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={c.muted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
            {error ? (
              <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>{error}</Text>
            ) : null}

            {Platform.OS === 'web' ? (
              <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
                <Ionicons name="phone-portrait-outline" size={34} color={c.muted} />
                <Text style={{ color: c.muted, fontSize: 13, textAlign: 'center', marginTop: spacing.md }}>
                  Taking a photo uses the phone camera, which a browser build does not have. Use the app
                  on a device, or add files from the request page in the web app.
                </Text>
              </View>
            ) : !permission?.granted ? (
              <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
                <Ionicons name="camera-outline" size={34} color={c.muted} />
                <Text
                  style={{ color: c.muted, fontSize: 13, textAlign: 'center', marginTop: spacing.md, marginBottom: spacing.lg }}
                >
                  The camera is needed to photograph something for this request.
                </Text>
                <Button label="Allow camera" onPress={requestPermission} />
              </View>
            ) : pending ? (
              <>
                <Image
                  source={{ uri: pending }}
                  style={{ width: '100%', height: 320, borderRadius: radius.md, backgroundColor: c.border }}
                  resizeMode="cover"
                />
                <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
                  <View style={{ flex: 1 }}>
                    <Button label="Retake" variant="secondary" onPress={() => setPending(null)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label={busy ? 'Attaching…' : 'Attach photo'} onPress={upload} disabled={busy} />
                  </View>
                </View>
              </>
            ) : (
              <>
                <CameraView
                  ref={cameraRef}
                  style={{ width: '100%', height: 320, borderRadius: radius.md, overflow: 'hidden' }}
                />
                <View style={{ marginTop: spacing.lg }}>
                  <Button label="Take photo" onPress={shoot} />
                </View>
              </>
            )}

            {busy ? <ActivityIndicator color={c.brand} style={{ marginTop: spacing.md }} /> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
