import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Linking, Platform, Pressable, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { formatFileSize } from '@techpioasset/domain';
import { ApiError } from '../../lib/api-client';
import {
  MAX_COMMENT_IMAGES,
  addPendingPhoto,
  canSendMessage,
  commentPayload,
  failedMessage,
  photoCaption,
  removePendingPhoto,
  sentMessage,
  withPhotoSize,
  type PendingPhoto,
} from '../../lib/comment-images';
import { personName } from '../../lib/format';
import { PICKER_UNAVAILABLE_MESSAGE, pickImageFromCamera, pickImageFromLibrary, type PickOutcome } from '../../lib/pick-image';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { AuthImage } from '../auth-image';
import { Button, Card, Field, SectionTitle, StatusPill } from '../ui';

export interface CommentAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
}

export interface RequestComment {
  id: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author: {
    email: string;
    profile: { firstName: string | null; lastName: string | null } | null;
  } | null;
  /** v2.60 - pictures sent inline with the message. Absent from older servers. */
  attachments?: CommentAttachment[];
}

const THUMB = 120;

/**
 * The request's conversation, on the phone (v2.56) - the same thread as the web.
 *
 * Which comments arrive is the server's decision: internal notes are only
 * returned to holders of `requests:approve`. The "Internal note" switch follows
 * the same gate the web uses, so nobody is offered a toggle the server refuses.
 *
 * v2.60: pictures go with the message. They are queued with their size, sent
 * in the same call as the text (one multipart request, so the message is
 * either sent whole or not at all), and shown inline in the thread. Sending
 * reports back in a banner under the composer - success clears the draft,
 * failure keeps every word and picture.
 */
export function RequestConversation({
  requestId,
  comments,
  canInternal,
  isOwnRequest,
  onPosted,
}: {
  requestId: string;
  comments: RequestComment[];
  /** `requests:approve` - the web's gate for writing (and reading) internal notes. */
  canInternal: boolean;
  /** Requester or beneficiary - changes only the placeholder wording, as on the web. */
  isOwnRequest: boolean;
  onPosted: () => void | Promise<void>;
}) {
  const { api } = useSession();
  const { c, scheme, spacing, radius } = useTheme();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  const warning = palette.warning;

  // The banner is the app's answer to a toast: it auto-hides, errors linger
  // longer so they can be read, and it never blocks the thread behind it.
  const showFlash = useCallback((tone: 'success' | 'error', text: string) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash({ tone, text });
    flashTimer.current = setTimeout(() => setFlash(null), tone === 'error' ? 8000 : 4000);
  }, []);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  async function queue(outcome: PickOutcome) {
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'denied') return showFlash('error', 'Permission was refused, so no picture was added.');
    if (outcome.kind === 'unavailable') return showFlash('error', PICKER_UNAVAILABLE_MESSAGE);
    const { next, rejected } = addPendingPhoto(photos, { ...outcome.image, sizeBytes: null });
    if (rejected) return showFlash('error', rejected);
    setPhotos(next);
    // The picker rarely reports a size, and the owner wants one on every
    // picture: read the file's bytes once, off the render path.
    const added = next[next.length - 1]!;
    try {
      const blob = await fetch(added.uri).then((r) => r.blob());
      setPhotos((current) => withPhotoSize(current, added.key, blob.size));
    } catch {
      // Left unmeasured; the caption then shows the name alone.
    }
  }

  async function send() {
    if (!canSendMessage(body, photos) || sending) return;
    const isInternal = canInternal && internal;
    setSending(true);
    setFlash(null);
    try {
      const payload = commentPayload(body, isInternal, photos);
      if (payload.kind === 'json') {
        await api.request(`/requests/${requestId}/comments`, { method: 'POST', body: payload.body });
      } else {
        const form = new FormData();
        for (const [name, value] of payload.fields) form.append(name, value);
        // React Native's FormData accepts a { uri, name, type } file descriptor.
        for (const file of payload.files) {
          form.append(file.field, { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
        }
        await api.request(`/requests/${requestId}/comments`, { formData: form });
      }
      const sent = sentMessage(isInternal, photos.length);
      setBody('');
      setInternal(false);
      setPhotos([]);
      showFlash('success', sent);
      await onPosted();
    } catch (error) {
      // Everything typed and every picture stays exactly where it was.
      showFlash('error', failedMessage(isInternal, error instanceof ApiError ? error.message : null));
    } finally {
      setSending(false);
    }
  }

  async function openImage(att: CommentAttachment) {
    try {
      const link = await api.request<{ path: string }>(
        `/requests/${requestId}/attachments/${att.id}/link`,
        { method: 'POST' },
      );
      await Linking.openURL(api.absoluteUrl(link.path));
    } catch (error) {
      Alert.alert('Could not open the image', error instanceof ApiError ? error.message : 'Please try again.');
    }
  }

  const sendLabel = sending ? (photos.length > 0 ? 'Uploading…' : 'Sending…') : 'Send';

  return (
    <>
      <SectionTitle>Conversation</SectionTitle>
      <Card style={{ marginBottom: spacing.xl }}>
        {comments.length === 0 ? (
          <Text style={{ color: c.subtle, fontSize: 13, marginBottom: spacing.md }}>
            No messages yet. Questions about this request — timelines, status, details — belong here;
            the right people are notified when you write.
          </Text>
        ) : (
          comments.map((m) => {
            const images = (m.attachments ?? []).filter((a) => a.isImage);
            return (
              <View
                key={m.id}
                style={{ paddingBottom: spacing.md, marginBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: c.border }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>{personName(m.author)}</Text>
                  {m.isInternal ? <StatusPill label="Internal" bg={warning.bg} fg={warning.fg} /> : null}
                  <Text style={{ color: c.subtle, fontSize: 12 }}>{new Date(m.createdAt).toLocaleString()}</Text>
                </View>
                {m.body ? (
                  <Text style={{ color: c.muted, fontSize: 14, marginTop: 4, lineHeight: 20 }}>{m.body}</Text>
                ) : null}
                {images.length > 0 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                    {images.map((att) => (
                      <Pressable
                        key={att.id}
                        onPress={() => void openImage(att)}
                        accessibilityRole="imagebutton"
                        accessibilityLabel={`Open ${att.originalName}`}
                        style={{ width: THUMB }}
                      >
                        <AuthImage
                          {...api.imageSource(`/requests/${requestId}/attachments/${att.id}`)}
                          style={{ width: THUMB, height: THUMB, borderRadius: radius.md }}
                          accessibilityLabel={att.originalName}
                        />
                        <Text style={{ color: c.subtle, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                          {att.originalName} · {formatFileSize(att.sizeBytes)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })
        )}

        <Field
          placeholder={
            isOwnRequest
              ? 'Ask a question about this request — e.g. how long will this take?'
              : 'Reply to the requester — they are notified of your message.'
          }
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={4000}
          accessibilityLabel="Write a message"
        />

        {photos.length > 0 ? (
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}
            accessibilityLabel="Images to send"
          >
            {photos.map((photo) => (
              <View key={photo.key} style={{ width: 96 }}>
                <Image
                  source={{ uri: photo.uri }}
                  style={{ width: 96, height: 72, borderRadius: radius.md, backgroundColor: c.border }}
                  resizeMode="cover"
                  accessibilityLabel={photo.name}
                />
                <Text style={{ color: c.subtle, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                  {photoCaption(photo)}
                </Text>
                <Pressable
                  onPress={() => setPhotos((current) => removePendingPhoto(current, photo.key))}
                  disabled={sending}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${photo.name}`}
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: c.surface,
                    borderWidth: 1,
                    borderColor: c.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="close" size={14} color={c.danger} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
          <Button
            label="Photo"
            icon="image-outline"
            variant="secondary"
            onPress={() => void pickImageFromLibrary().then(queue)}
            disabled={sending || photos.length >= MAX_COMMENT_IMAGES}
            style={{ flex: 1 }}
          />
          {Platform.OS === 'web' ? null : (
            <Button
              label="Camera"
              icon="camera-outline"
              variant="secondary"
              onPress={() => void pickImageFromCamera().then(queue)}
              disabled={sending || photos.length >= MAX_COMMENT_IMAGES}
              style={{ flex: 1 }}
            />
          )}
        </View>

        {canInternal ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }}>
            <Text style={{ color: c.muted, fontSize: 13, flex: 1 }}>Internal note (hidden from the requester)</Text>
            <Switch value={internal} onValueChange={setInternal} accessibilityLabel="Internal note" />
          </View>
        ) : null}

        {flash ? (
          <View
            accessibilityLiveRegion="polite"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: flash.tone === 'success' ? palette.success.bg : palette.critical.bg,
              borderColor: flash.tone === 'success' ? palette.success.border : palette.critical.border,
              borderWidth: 1,
              borderRadius: radius.md,
              padding: 10,
              marginBottom: spacing.md,
            }}
          >
            <Ionicons
              name={flash.tone === 'success' ? 'checkmark-circle' : 'alert-circle'}
              size={18}
              color={flash.tone === 'success' ? palette.success.fg : palette.critical.fg}
            />
            <Text
              style={{ color: flash.tone === 'success' ? palette.success.fg : palette.critical.fg, fontSize: 13, flex: 1 }}
            >
              {flash.text}
            </Text>
          </View>
        ) : null}

        <Button
          label={sendLabel}
          icon="send-outline"
          onPress={() => void send()}
          disabled={!canSendMessage(body, photos)}
          loading={sending}
        />
      </Card>
    </>
  );
}
