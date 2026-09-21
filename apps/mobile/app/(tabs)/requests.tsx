import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { ApiError } from '../../src/lib/api-client';
import {
  REQUEST_STATUS_TOKENS,
  TONE_PALETTE_DARK,
  TONE_PALETTE_LIGHT,
} from '@techpioasset/ui-tokens';
import type { RequestStatus } from '@techpioasset/domain';
import {
  DRAFT_IMAGES_FAILED_MESSAGE,
  PHOTO_MARKER_HINT,
  commentPayload,
  submittedMessage,
  wordsWithoutMarkers,
} from '../../src/lib/comment-images';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import {
  Button,
  Card,
  Chevron,
  EmptyState,
  Field,
  IconBadge,
  ListSkeleton,
  PullRefresh,
  SectionTitle,
  StatusPill,
} from '../../src/components/ui';
import {
  FlashBanner,
  PhotoMarkerStrip,
  PhotoPickButtons,
  useFlash,
  usePhotoMarkers,
} from '../../src/components/requests/photo-markers';

interface RequestRow {
  id: string;
  requestNumber: string;
  status: RequestStatus;
  /** The step it is actually on; the status alone is coarser. */
  currentStep: { name: string; kind: string } | null;
  businessReason: string;
}

/** Employee requests: raise a new one and track your own. */
export default function RequestsScreen() {
  const { api } = useSession();
  const router = useRouter();
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [item, setItem] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // v2.22 - the company can restrict who raises requests, and an individual can
  // be excepted either way. Ask before offering the form: filling one in and
  // being refused at the end is a worse way to find out.
  const [raiseBlockedReason, setRaiseBlockedReason] = useState<string | null>(null);
  // v2.61 - pictures of the fault or the item, inline in the reason as
  // `[photo N]` markers. They become the conversation's first message.
  const { flash, showFlash, clearFlash } = useFlash();
  const pictures = usePhotoMarkers({ text: reason, setText: setReason, showFlash });
  const { photos } = pictures;

  const loadPolicy = useCallback(async () => {
    try {
      const decision = await api.request<{ allowed: boolean; reason?: string }>(
        '/requests/can-create',
      );
      setRaiseBlockedReason(decision.allowed ? null : (decision.reason ?? 'You cannot raise requests.'));
    } catch {
      // If the check itself fails, leave the form up: the server still enforces
      // the rule, so the worst case is the old behaviour, not a false block.
      setRaiseBlockedReason(null);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.request<RequestRow[]>('/requests?pageSize=50');
      setRows(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
    void loadPolicy();
  }, [load, loadPolicy]);

  async function submit() {
    // Validate with a clear message instead of a silently disabled button.
    // What is stored as the reason is the words alone - it is quoted in lists
    // and emails, which cannot show a picture; the words with the pictures in
    // place go up as the conversation's first message.
    const words = wordsWithoutMarkers(reason);
    if (item.trim().length === 0) {
      setFormError('Enter what you need.');
      return;
    }
    if (words.length < 10) {
      setFormError(`Add a business reason of at least 10 characters (${words.length}/10).`);
      return;
    }
    setFormError(null);
    clearFlash();
    setSubmitting(true);
    let createdId: string | null = null;
    try {
      const created = await api.request<{ id: string; requestNumber?: string }>('/requests', {
        method: 'POST',
        body: {
          type: 'ADDITIONAL_EQUIPMENT',
          businessReason: words,
          items: [{ description: item.trim(), quantity: 1 }],
        },
      });
      createdId = created.id;
      if (photos.length > 0) {
        // The pictures, in the sentence they were written into, as the first
        // message from the requester. If this fails the request stays a
        // draft rather than reaching approvers without the evidence.
        const payload = commentPayload(reason, false, photos);
        if (payload.kind === 'multipart') {
          const form = new FormData();
          for (const [name, value] of payload.fields) form.append(name, value);
          for (const file of payload.files) {
            form.append(file.field, { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
          }
          try {
            await api.request(`/requests/${created.id}/comments`, { formData: form });
          } catch {
            showFlash('error', DRAFT_IMAGES_FAILED_MESSAGE);
            router.push(`/request/${created.id}`);
            return;
          }
        }
      }
      await api.request(`/requests/${created.id}/submit`, { method: 'POST' });
      const sent = submittedMessage(photos.length);
      setReason('');
      setItem('');
      pictures.clear();
      await load();
      showFlash('success', sent);
    } catch (caught) {
      setFormError(
        caught instanceof ApiError
          ? (caught.problem?.detail ?? caught.problem?.title ?? 'Could not submit. Please try again.')
          : createdId
            ? 'The request was saved as a draft but not submitted. Check your connection and open it to submit.'
            : 'Could not submit. Check your connection and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.background }}
      data={rows}
      keyExtractor={(r) => r.id}
      refreshControl={<PullRefresh refreshing={loading} onRefresh={load} />}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
      ListHeaderComponent={
        <View style={{ marginBottom: spacing.xl }}>
          <Card>
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 16, marginBottom: spacing.md }}>
              {raiseBlockedReason ? 'Raising requests' : 'New request'}
            </Text>
            {raiseBlockedReason ? (
              <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>
                {raiseBlockedReason}
              </Text>
            ) : (
              <>
                <Field label="What do you need?" placeholder="e.g. Laptop docking station" value={item} onChangeText={setItem} />
                <Field
                  label="Business reason"
                  placeholder="Why do you need it? (at least 10 characters)"
                  value={reason}
                  onChangeText={(t) => {
                    pictures.onChangeText(t);
                    if (formError) setFormError(null);
                  }}
                  onSelectionChange={pictures.onSelectionChange}
                  multiline
                  maxLength={2000}
                />
                <PhotoMarkerStrip photos={photos} onRemove={pictures.remove} disabled={submitting} />
                <PhotoPickButtons
                  onLibrary={pictures.addFromLibrary}
                  onCamera={pictures.addFromCamera}
                  disabled={submitting}
                  count={photos.length}
                />
                <Text style={{ color: c.subtle, fontSize: 12, marginTop: -4, marginBottom: spacing.md }}>
                  Photos of the fault or the item help approvers decide. {PHOTO_MARKER_HINT}
                </Text>
                {formError ? (
                  <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>{formError}</Text>
                ) : null}
                <FlashBanner flash={flash} />
                <Button label="Submit request" icon="send" onPress={() => void submit()} loading={submitting} />
              </>
            )}
          </Card>
          <View style={{ height: spacing.xl }} />
          <SectionTitle>Your requests</SectionTitle>
        </View>
      }
      ListEmptyComponent={
        loading ? <ListSkeleton /> : (
          <Card>
            <EmptyState icon="document-text-outline" title="No requests yet" message="Requests you raise will appear here." />
          </Card>
        )
      }
      renderItem={({ item: row }) => {
        const tone = palette[REQUEST_STATUS_TOKENS[row.status].tone];
        return (
          <Card
            onPress={() => router.push(`/request/${row.id}`)}
            style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
          >
            <IconBadge icon="document-text-outline" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }}>{row.requestNumber}</Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {row.businessReason}
              </Text>
              <View style={{ marginTop: 8 }}>
                <StatusPill
                  label={row.currentStep?.name ?? REQUEST_STATUS_TOKENS[row.status].label}
                  bg={tone.bg}
                  fg={tone.fg}
                />
              </View>
            </View>
            <Chevron />
          </Card>
        );
      }}
    />
  );
}
