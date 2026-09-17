import { useState } from 'react';
import { Alert, Linking, Switch, Text, View } from 'react-native';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { ApiError } from '../../lib/api-client';
import { PHOTO_MARKER_HINT, canSendMessage, commentPayload, failedMessage, sentMessage } from '../../lib/comment-images';
import { personName } from '../../lib/format';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { Button, Card, Field, SectionTitle, StatusPill } from '../ui';
import {
  FlashBanner,
  MessageBodyView,
  PhotoMarkerStrip,
  PhotoPickButtons,
  useFlash,
  usePhotoMarkers,
  type CommentAttachment,
} from './photo-markers';

export type { CommentAttachment } from './photo-markers';

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

/**
 * The request's conversation, on the phone (v2.56) - the same thread as the web.
 *
 * Which comments arrive is the server's decision: internal notes are only
 * returned to holders of `requests:approve`. The "Internal note" switch follows
 * the same gate the web uses, so nobody is offered a toggle the server refuses.
 *
 * v2.60: pictures go with the message, in one multipart call, so the message
 * is either sent whole or not at all. v2.61: they go in the text where the
 * cursor is - a TextInput cannot hold a picture, so each is a `[photo N]`
 * marker with the picture in the strip below, and the thread shows it in
 * place once sent. A banner under the composer reports back; success clears
 * the draft, failure keeps every word and picture.
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
  const { c, scheme, spacing } = useTheme();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const { flash, showFlash, clearFlash } = useFlash();
  const pictures = usePhotoMarkers({ text: body, setText: setBody, showFlash });
  const { photos } = pictures;

  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  const warning = palette.warning;

  async function send() {
    if (!canSendMessage(body, photos) || sending) return;
    const isInternal = canInternal && internal;
    setSending(true);
    clearFlash();
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
      pictures.clear();
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
          comments.map((m) => (
            <View
              key={m.id}
              style={{ paddingBottom: spacing.md, marginBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: c.border }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>{personName(m.author)}</Text>
                {m.isInternal ? <StatusPill label="Internal" bg={warning.bg} fg={warning.fg} /> : null}
                <Text style={{ color: c.subtle, fontSize: 12 }}>{new Date(m.createdAt).toLocaleString()}</Text>
              </View>
              <MessageBodyView
                requestId={requestId}
                body={m.body}
                attachments={m.attachments ?? []}
                onOpen={(att) => void openImage(att)}
              />
            </View>
          ))
        )}

        <Field
          placeholder={
            isOwnRequest
              ? 'Ask a question about this request — e.g. how long will this take?'
              : 'Reply to the requester — they are notified of your message.'
          }
          value={body}
          onChangeText={pictures.onChangeText}
          onSelectionChange={pictures.onSelectionChange}
          multiline
          maxLength={4000}
          accessibilityLabel="Write a message"
        />

        <PhotoMarkerStrip photos={photos} onRemove={pictures.remove} disabled={sending} />

        <PhotoPickButtons
          onLibrary={pictures.addFromLibrary}
          onCamera={pictures.addFromCamera}
          disabled={sending}
          count={photos.length}
        />
        <Text style={{ color: c.subtle, fontSize: 12, marginTop: -4, marginBottom: spacing.md }}>{PHOTO_MARKER_HINT}</Text>

        {canInternal ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }}>
            <Text style={{ color: c.muted, fontSize: 13, flex: 1 }}>Internal note (hidden from the requester)</Text>
            <Switch value={internal} onValueChange={setInternal} accessibilityLabel="Internal note" />
          </View>
        ) : null}

        <FlashBanner flash={flash} />

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
