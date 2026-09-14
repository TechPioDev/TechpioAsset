import { useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { ApiError } from '../../lib/api-client';
import { personName } from '../../lib/format';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { Button, Card, Field, SectionTitle, StatusPill } from '../ui';

export interface RequestComment {
  id: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author: {
    email: string;
    profile: { firstName: string | null; lastName: string | null } | null;
  } | null;
}

/**
 * The request's conversation, on the phone (v2.56) - the same thread as the web.
 *
 * Which comments arrive is the server's decision: internal notes are only
 * returned to holders of `requests:approve`. The "Internal note" switch follows
 * the same gate the web uses, so nobody is offered a toggle the server refuses.
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

  const warning = (scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT).warning;

  async function send() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await api.request(`/requests/${requestId}/comments`, {
        method: 'POST',
        body: { body: text, isInternal: canInternal && internal },
      });
      setBody('');
      setInternal(false);
      await onPosted();
    } catch (error) {
      Alert.alert('Could not send', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  }

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
              <Text style={{ color: c.muted, fontSize: 14, marginTop: 4, lineHeight: 20 }}>{m.body}</Text>
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
          onChangeText={setBody}
          multiline
          maxLength={4000}
          accessibilityLabel="Write a message"
        />
        {canInternal ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }}>
            <Text style={{ color: c.muted, fontSize: 13, flex: 1 }}>Internal note (hidden from the requester)</Text>
            <Switch value={internal} onValueChange={setInternal} accessibilityLabel="Internal note" />
          </View>
        ) : null}
        <Button
          label="Send"
          icon="send-outline"
          onPress={() => void send()}
          disabled={body.trim().length === 0}
          loading={sending}
        />
      </Card>
    </>
  );
}
