import { useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatFileSize } from '@techpioasset/domain';
import { ApiError } from '../../lib/api-client';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { Button, Card, SectionTitle } from '../ui';
import { RequestPhotoSheet } from './request-photo-sheet';

export interface RequestAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  caption: string | null;
  createdAt: string;
  uploadedById: string | null;
}

/**
 * A request's attachments, on the phone (v2.56).
 *
 * Opening goes through a two-minute signed link handed to the system browser -
 * the phone cannot attach a sign-in header to a URL, exactly the reason vendor
 * product documents work this way. Adding is by camera. Removing is offered on
 * the same rule as the web: only on a file you added yourself.
 */
export function RequestAttachments({
  requestId,
  attachments,
  onChanged,
}: {
  requestId: string;
  attachments: RequestAttachment[];
  onChanged: () => void | Promise<void>;
}) {
  const { api, user } = useSession();
  const { c, spacing } = useTheme();
  const [opening, setOpening] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  async function open(att: RequestAttachment) {
    setOpening(att.id);
    try {
      const link = await api.request<{ path: string }>(
        `/requests/${requestId}/attachments/${att.id}/link`,
        { method: 'POST' },
      );
      await Linking.openURL(api.absoluteUrl(link.path));
    } catch (error) {
      Alert.alert('Could not open the file', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setOpening(null);
    }
  }

  function remove(att: RequestAttachment) {
    Alert.alert('Remove this attachment?', att.originalName, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void api
            .request(`/requests/${requestId}/attachments/${att.id}`, { method: 'DELETE' })
            .then(onChanged)
            .catch((error) =>
              Alert.alert('Could not remove', error instanceof ApiError ? error.message : 'Please try again.'),
            ),
      },
    ]);
  }

  return (
    <>
      <SectionTitle>Attachments</SectionTitle>
      <Card style={{ marginBottom: spacing.xl }}>
        {attachments.length === 0 ? (
          <Text style={{ color: c.subtle, fontSize: 13, marginBottom: spacing.md }}>
            No files attached. Add a photo of the issue or a spec sheet.
          </Text>
        ) : (
          attachments.map((att) => (
            <View
              key={att.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: c.border,
              }}
            >
              <Pressable
                onPress={() => void open(att)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${att.originalName}`}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <Ionicons
                  name={att.mimeType.startsWith('image/') ? 'image-outline' : 'document-text-outline'}
                  size={20}
                  color={c.brand}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: '600' }} numberOfLines={1}>
                    {att.originalName}
                  </Text>
                  <Text style={{ color: c.subtle, fontSize: 12 }}>
                    {opening === att.id ? 'Opening…' : formatFileSize(att.sizeBytes)}
                  </Text>
                </View>
              </Pressable>
              {att.uploadedById && att.uploadedById === user?.id ? (
                <Pressable
                  onPress={() => remove(att)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${att.originalName}`}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={18} color={c.danger} />
                </Pressable>
              ) : null}
            </View>
          ))
        )}
        <Button
          label="Attach a photo"
          icon="camera-outline"
          variant="secondary"
          onPress={() => setCapturing(true)}
          style={{ marginTop: spacing.md }}
        />
      </Card>

      {capturing ? (
        <RequestPhotoSheet
          visible
          requestId={requestId}
          onClose={() => setCapturing(false)}
          onUploaded={() => void onChanged()}
        />
      ) : null}
    </>
  );
}
