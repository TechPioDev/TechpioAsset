import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { ApiError } from '../src/lib/api-client';
import {
  DRAFT_IMAGES_FAILED_MESSAGE,
  commentPayload,
  wordsWithoutMarkers,
} from '../src/lib/comment-images';
import {
  PROBLEM_CATEGORIES,
  initialAsset,
  photoHelps,
  problemRequest,
  type ProblemAsset,
} from '../src/lib/report-problem';
import { useSession } from '../src/providers/session';
import { useT } from '../src/providers/language';
import { useTheme } from '../src/theme';
import {
  Button,
  Card,
  Field,
  ListSkeleton,
  Screen,
  SectionTitle,
  type IconName,
} from '../src/components/ui';
import {
  FlashBanner,
  PhotoMarkerStrip,
  PhotoPickButtons,
  useFlash,
  usePhotoMarkers,
} from '../src/components/requests/photo-markers';

/** The catalogue names Lucide icons (the web's); these are the phone's. */
const ICONS: Record<string, IconName> = {
  Gauge: 'speedometer-outline',
  Monitor: 'desktop-outline',
  Keyboard: 'keypad-outline',
  Headphones: 'headset-outline',
  AppWindow: 'apps-outline',
  ShieldAlert: 'warning-outline',
  CircleHelp: 'help-circle-outline',
};

/**
 * Report a problem (Phase 4, v2.80): which item, what is wrong, a photo, send.
 *
 * Opened from Home, or from an asset's page with that asset already chosen.
 * With one item held, or opened from the item, it is: pick what is wrong,
 * take the photo, Send. The request is an ordinary request - same approvals,
 * same duplicate check, same conversation - raised through the web's issue
 * catalogue, so IT sees one queue whichever door it came in by.
 */
export default function ReportProblemScreen() {
  const { assetId } = useLocalSearchParams<{ assetId?: string }>();
  const { api, user } = useSession();
  const t = useT();
  const router = useRouter();
  const { c, spacing, radius } = useTheme();

  const [assets, setAssets] = useState<ProblemAsset[] | null>(null);
  const [chosenAsset, setChosenAsset] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { flash, showFlash } = useFlash();
  const pictures = usePhotoMarkers({ text, setText, showFlash });
  const { photos } = pictures;

  const load = useCallback(async () => {
    if (!user) return;
    const mine = await api
      .request<ProblemAsset[]>(`/assets?assignedUserId=${user.id}&pageSize=100`)
      .catch(() => [] as ProblemAsset[]);
    setAssets(mine);
    setChosenAsset(initialAsset(mine, assetId ?? null));
  }, [api, user, assetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const asset = assets?.find((a) => a.id === chosenAsset) ?? null;

  async function send() {
    if (!category) {
      setError(t('problem.pickFirst'));
      return;
    }
    const body = problemRequest(category, asset, wordsWithoutMarkers(text));
    if (!body) return;
    setError(null);
    setSending(true);
    let createdId: string | null = null;
    try {
      const created = await api.request<{ id: string }>('/requests', { method: 'POST', body });
      createdId = created.id;
      if (photos.length > 0) {
        // The photo is the evidence: if it cannot go up, the report stays a
        // draft rather than reaching IT without it (as on New request).
        // Every photo named in the message, even if its marker was deleted.
        const named =
          text +
          photos
            .map((_, i) => (text.includes(`[photo ${i + 1}]`) ? '' : ` [photo ${i + 1}]`))
            .join('');
        const payload = commentPayload(named, false, photos);
        if (payload.kind === 'multipart') {
          const form = new FormData();
          for (const [name, value] of payload.fields) form.append(name, value);
          for (const file of payload.files) {
            form.append(file.field, {
              uri: file.uri,
              name: file.name,
              type: file.type,
            } as unknown as Blob);
          }
          try {
            await api.request(`/requests/${created.id}/comments`, { formData: form });
          } catch {
            Alert.alert('Photo not sent', DRAFT_IMAGES_FAILED_MESSAGE);
            router.replace(`/request/${created.id}`);
            return;
          }
        }
      }
      await api.request(`/requests/${created.id}/submit`, { method: 'POST' });
      Alert.alert(t('problem.sent'), t('problem.sentBody'));
      router.replace(`/request/${created.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.problem?.detail ?? caught.problem?.title ?? 'Could not send. Please try again.')
          : createdId
            ? 'Saved as a draft but not sent. Check your connection and open it from Requests to send.'
            : 'Could not send. Check your connection and try again.',
      );
    } finally {
      setSending(false);
    }
  }

  if (assets === null) {
    return (
      <Screen>
        <ListSkeleton rows={4} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <FlashBanner flash={flash} />

      <SectionTitle>{t('problem.whichItem')}</SectionTitle>
      {assets.length === 0 ? (
        <Text style={{ color: c.muted, fontSize: 13, marginBottom: spacing.lg }}>
          {t('problem.noItems')}
        </Text>
      ) : (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: spacing.sm,
            marginBottom: spacing.lg,
          }}
        >
          {assets.map((a) => {
            const on = a.id === chosenAsset;
            return (
              <Pressable
                key={a.id}
                onPress={() => setChosenAsset(on ? null : a.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: on ? c.brand : c.border,
                  backgroundColor: on ? c.brandSoft : c.surface,
                  maxWidth: '100%',
                }}
              >
                <Text
                  style={{ color: on ? c.brand : c.text, fontWeight: '600', fontSize: 13 }}
                  numberOfLines={1}
                >
                  {a.name} · {a.assetTag}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <SectionTitle>{t('problem.whatIsWrong')}</SectionTitle>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: spacing.sm,
          marginBottom: spacing.lg,
        }}
      >
        {PROBLEM_CATEGORIES.map((cat) => {
          const on = cat.key === category;
          return (
            <Pressable
              key={cat.key}
              onPress={() => setCategory(cat.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityHint={cat.hint}
              style={{
                width: '48%',
                padding: spacing.md,
                borderRadius: radius.md,
                borderWidth: on ? 2 : 1,
                borderColor: on ? c.brand : c.border,
                backgroundColor: on ? c.brandSoft : c.surface,
                gap: 6,
              }}
            >
              <Ionicons
                name={ICONS[cat.icon] ?? 'help-circle-outline'}
                size={22}
                color={on ? c.brand : c.muted}
              />
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }}>{cat.label}</Text>
              <Text style={{ color: c.muted, fontSize: 12 }} numberOfLines={2}>
                {cat.hint}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {category ? (
        <Card style={{ marginBottom: spacing.xl }}>
          <Text style={{ color: c.text, fontWeight: '700', fontSize: 15, marginBottom: 4 }}>
            {photoHelps(category) ? t('problem.photoHelps') : t('problem.anythingElse')}
          </Text>
          <Text style={{ color: c.muted, fontSize: 12, marginBottom: spacing.md }}>
            {t('problem.optional')}
          </Text>
          <PhotoPickButtons
            onLibrary={pictures.addFromLibrary}
            onCamera={pictures.addFromCamera}
            disabled={sending}
            count={photos.length}
          />
          <PhotoMarkerStrip photos={photos} onRemove={pictures.remove} disabled={sending} />
          <Field
            placeholder={t('problem.whatHappened')}
            value={text}
            onChangeText={pictures.onChangeText}
            onSelectionChange={pictures.onSelectionChange}
            multiline
          />
          {error ? (
            <Text
              style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}
              accessibilityRole="alert"
            >
              {error}
            </Text>
          ) : null}
          <Button
            label={t('problem.send')}
            icon="send-outline"
            onPress={() => void send()}
            loading={sending}
          />
        </Card>
      ) : error ? (
        <Text style={{ color: c.danger, fontSize: 13 }} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
