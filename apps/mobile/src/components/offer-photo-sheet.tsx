import { useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  PRODUCT_DOCUMENT_LABELS,
  PRODUCT_DOCUMENT_RULES,
  PRODUCT_IMAGE_RULES,
  type ProductDocumentKind,
} from '@techpioasset/domain';
import { useSession } from '../providers/session';
import { useTheme } from '../theme';
import { Button } from './ui';

/**
 * Photographing the thing you are selling (v2.45).
 *
 * The one part of the catalogue a phone does better than a desk. A supplier's
 * rep is standing next to the product; on the web they would have to find a
 * photograph, email it to themselves and upload it. Here they point the camera
 * at it.
 *
 * It also unblocks the rest: an offer cannot go for review without a picture,
 * so a vendor working only from a phone could previously write a draft and
 * never publish it.
 *
 * v2.55: the same camera files a document when given one. A compliance
 * certificate is very often a sheet of paper in a drawer, and photographing it
 * is how a phone gets it into the system without a file-picking module that
 * would mean a new app build for everyone. With no `document` prop the sheet
 * behaves exactly as it always has.
 */
export function OfferPhotoSheet({
  visible,
  productId,
  imageCount,
  onClose,
  onUploaded,
  document,
}: {
  visible: boolean;
  productId: string;
  /** For a document, how many documents the offer already has. */
  imageCount: number;
  onClose: () => void;
  onUploaded: () => void;
  /** When set, the picture is filed as a document of this kind instead of an offer image. */
  document?: { kind: ProductDocumentKind };
}) {
  const { api } = useSession();
  const { c, radius, spacing } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const limit = document ? PRODUCT_DOCUMENT_RULES.max : PRODUCT_IMAGE_RULES.max;
  const full = imageCount >= limit;

  function close() {
    setPending(null);
    setError(null);
    onClose();
  }

  async function shoot() {
    setError(null);
    try {
      // Not full resolution. The server refuses anything over 500 KB, and a
      // 12 MP original of a laptop lid sells it no better than a 2 MP one.
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.6 });
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
      // React Native's FormData takes a { uri, name, type } descriptor.
      form.append('file', {
        uri: pending,
        name: `${document ? 'document' : 'offer'}-${Date.now()}.jpg`,
        type: 'image/jpeg',
      } as unknown as Blob);
      if (document) form.append('kind', document.kind);
      await api.request(
        `/vendor-products/${productId}/${document ? 'documents' : 'images'}`,
        { formData: form },
      );
      setPending(null);
      onUploaded();
      close();
    } catch (caught) {
      // The server's own words: it names the actual limit when a picture is too
      // large, or says the offer already has three.
      setError(caught instanceof Error ? caught.message : 'That picture could not be saved.');
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
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            padding: spacing.lg,
            gap: spacing.md,
          }}
        >
          <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>
            {document ? `Photograph a ${PRODUCT_DOCUMENT_LABELS[document.kind].toLowerCase()}` : 'Add a picture'}
          </Text>
          <Text style={{ color: c.muted, fontSize: 13 }}>
            {document
              ? full
                ? `This offer already has ${PRODUCT_DOCUMENT_RULES.max} documents. Remove one first.`
                : 'Lay the page flat in good light. A PDF can be added from the web app; here the camera files a picture of it.'
              : full
                ? `This offer already has ${PRODUCT_IMAGE_RULES.max} pictures. Remove one first.`
                : `Up to ${PRODUCT_IMAGE_RULES.max} per offer, ${PRODUCT_IMAGE_RULES.maxBytes / 1024} KB each. An offer needs at least one before it can go for review.`}
          </Text>

          {full ? null : !permission?.granted ? (
            <Button
              label="Allow the camera"
              icon="camera-outline"
              onPress={() => void requestPermission()}
            />
          ) : pending ? (
            <>
              <View
                style={{
                  height: 240,
                  borderRadius: radius.md,
                  overflow: 'hidden',
                  backgroundColor: c.surface,
                }}
              >
                <Image source={{ uri: pending }} style={{ flex: 1 }} resizeMode="cover" />
              </View>
              <Button label="Use this picture" loading={busy} icon="cloud-upload-outline" onPress={() => void upload()} />
              <Button label="Take another" variant="secondary" onPress={() => setPending(null)} />
            </>
          ) : (
            <>
              <View style={{ height: 240, borderRadius: radius.md, overflow: 'hidden' }}>
                <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
              </View>
              <Button label="Take the picture" icon="camera-outline" onPress={() => void shoot()} />
            </>
          )}

          {error ? <Text style={{ color: c.danger, fontSize: 13 }}>{error}</Text> : null}
          {busy ? <ActivityIndicator color={c.brand} /> : null}

          <Pressable onPress={close} accessibilityRole="button" style={{ paddingVertical: 10 }}>
            <Text style={{ color: c.muted, fontSize: 15, textAlign: 'center' }}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
