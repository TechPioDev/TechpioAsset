import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import {
  assetSlides,
  illustrationIcon,
  slideCountLabel,
  type AssetImageSource,
  type IllustrationIcon,
  type SlideCustodyGroup,
} from '@techpioasset/domain';
import { problemMessage } from '../../lib/asset-admin';
import { assetImageCaption, illustrationIonicon } from '../../lib/asset-overview';
import {
  PICKER_UNAVAILABLE_MESSAGE,
  pickImageFromCamera,
  pickImageFromLibrary,
  type PickOutcome,
} from '../../lib/pick-image';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { AuthImage } from '../auth-image';
import { PhotoViewer } from '../photo-viewer';
import { Button, Card } from '../ui';
import { AssetSheet } from './sheet';

/**
 * The picture that leads the asset screen (web: asset-image-card.tsx, v2.61).
 *
 * Three sources, in order: the catalogue listing's primary image when the unit
 * came through procurement; a photo somebody uploaded of this very unit; and
 * failing both, a clean illustration by type with the brand name. The rule is
 * resolveAssetImageSource in the domain package; this only draws the result
 * and offers add / replace / remove to people who may edit the record.
 *
 * v2.63 (web: v2.62): the box shows the asset's attached pictures, filling it,
 * and a tap opens all of them as a slideshow - the lead picture first, then
 * every condition photo. With no lead picture the newest condition photo is
 * the cover; the illustration is only for an asset nobody has photographed.
 * The order is the domain's assetSlides, shared with the web. Only the cover
 * is downloaded with the screen; the viewer fetches the rest as it is opened.
 *
 * Adding a photo goes through the pickers the request composer already uses
 * (system camera or gallery) rather than the condition-photo viewfinder: this
 * is a product shot, not evidence of a handover, and it goes to a different
 * endpoint (POST /assets/:id/photo, one per asset).
 */

/** The device glyph, sized for the header thumbnail or the illustration. */
export function DeviceIcon({
  typeKey,
  size,
  color,
}: {
  typeKey: string | null | undefined;
  size: number;
  color: string;
}) {
  return <Ionicons name={illustrationIonicon(illustrationIcon(typeKey))} size={size} color={color} />;
}

function Illustration({ icon, brand, name }: { icon: IllustrationIcon; brand: string | null; name: string }) {
  const { c } = useTheme();
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`${brand ? `${brand} ` : ''}${name}`}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background, gap: 8 }}
    >
      <Ionicons name={illustrationIonicon(icon)} size={72} color={c.subtle} />
      {brand ? <Text style={{ color: c.muted, fontSize: 14, fontWeight: '600' }}>{brand}</Text> : null}
    </View>
  );
}

export function AssetImageCard({
  assetId,
  assetName,
  typeKey,
  brand,
  source,
  ownPhoto,
  catalogue,
  groups,
  canManage,
  onViewListing,
  onChanged,
}: {
  assetId: string;
  assetName: string;
  typeKey: string | null | undefined;
  brand: string | null;
  source: AssetImageSource;
  /** The photo uploaded of this unit, whatever is being shown. */
  ownPhoto: { id: string; createdAt: string } | null;
  /** The catalogue listing's primary image, when the unit came through one. */
  catalogue: { productId: string; imageId: string } | null;
  /**
   * The custody events with their condition photos - the list the screen
   * already loads for the Condition photos section, so the slideshow costs no
   * second request. null while it loads, or for someone who may not read it:
   * either way, no condition photos in the slideshow.
   */
  groups: readonly SlideCustodyGroup[] | null;
  canManage: boolean;
  /** Opens the catalogue listing; absent for viewers who may not open the catalogue. */
  onViewListing?: () => void;
  /** The asset is reloaded after a photo is added, replaced or removed. */
  onChanged: () => void;
}) {
  const { api } = useSession();
  const { c, spacing, radius } = useTheme();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [viewing, setViewing] = useState(false);
  const hasOwnPhoto = Boolean(ownPhoto);

  // The parent builds `source`, `ownPhoto` and `catalogue` afresh on every
  // render, so the list is rebuilt each time (it is cheap) and its identity
  // held while the pictures in it are the same: the viewer resolves its image
  // sources once per list, and a new list on every render would re-fetch them.
  const fresh = assetSlides({ assetId, source, ownPhoto, catalogue, groups: groups ?? [] });
  const signature = fresh.map((slide) => slide.id).join('|');
  const slides = useMemo(() => fresh, [signature]);
  const cover = slides[0] ?? null;
  const coverPath = cover?.path ?? null;
  // Held steady between renders: AuthImage re-fetches on the browser build
  // whenever its headers object changes identity.
  const src = useMemo(() => (coverPath ? api.imageSource(coverPath) : null), [api, coverPath]);
  // A different cover (a photo added, the condition photos arriving) gets its
  // own chance to load.
  useEffect(() => setFailed(false), [coverPath]);
  // A picture that will not load (permission, deleted file) falls back to the
  // illustration rather than a broken-image box.
  const showIllustration = !cover || failed || !src;

  async function upload(outcome: PickOutcome) {
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'denied') {
      Alert.alert('Permission needed', 'Allow PioAssets to use the camera or photos, then try again.');
      return;
    }
    if (outcome.kind === 'unavailable') {
      Alert.alert('Not available', PICKER_UNAVAILABLE_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      // React Native's FormData takes a { uri, name, type } descriptor.
      form.append('file', outcome.image as unknown as Blob);
      await api.request(`/assets/${assetId}/photo`, { formData: form });
      setFailed(false);
      onChanged();
      Alert.alert(hasOwnPhoto ? 'Photo replaced' : 'Photo added');
    } catch (e) {
      setError(problemMessage(e, 'Could not upload that photo'));
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    Alert.alert('Remove this photo?', 'The asset goes back to its catalogue picture or an illustration.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              await api.request(`/assets/${assetId}/photo`, { method: 'DELETE' });
              setFailed(false);
              onChanged();
              Alert.alert('Photo removed');
            } catch (e) {
              setError(problemMessage(e, 'Could not remove the photo'));
            } finally {
              setBusy(false);
            }
          })(),
      },
    ]);
  }

  const caption = assetImageCaption(cover, failed);

  return (
    <Card style={{ padding: 0, overflow: 'hidden', marginBottom: spacing.lg }}>
      <View style={{ width: '100%', aspectRatio: 16 / 9 }}>
        {showIllustration || !src ? (
          <Illustration icon={illustrationIcon(typeKey)} brand={brand} name={assetName} />
        ) : (
          <Pressable
            onPress={() => setViewing(true)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`View ${slideCountLabel(slides.length)} of ${assetName}`}
            style={{ width: '100%', height: '100%' }}
          >
            {/* cover: the owner asked for the picture to fill the box; the
                viewer shows it uncropped. */}
            <AuthImage
              uri={src.uri}
              headers={src.headers}
              resizeMode="cover"
              style={{ width: '100%', height: '100%', backgroundColor: c.background }}
              accessibilityLabel={assetName}
              onError={() => setFailed(true)}
            />
            <View
              style={{
                position: 'absolute',
                right: 10,
                bottom: 10,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                backgroundColor: 'rgba(0,0,0,0.65)',
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <Ionicons name="expand-outline" size={13} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>
                {slideCountLabel(slides.length)}
              </Text>
            </View>
          </Pressable>
        )}
        {brand ? (
          <View
            style={{
              position: 'absolute',
              top: 10,
              left: 10,
              backgroundColor: c.card,
              borderColor: c.border,
              borderWidth: 1,
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 3,
            }}
          >
            <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }}>{brand}</Text>
          </View>
        ) : null}
        {busy ? (
          <View
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(2,6,23,0.35)',
            }}
          >
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.sm,
          flexWrap: 'wrap',
          borderTopWidth: 1,
          borderTopColor: c.border,
          paddingHorizontal: spacing.lg,
          paddingVertical: 10,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
          <Text style={{ color: c.subtle, fontSize: 12 }}>{caption}</Text>
          {source.kind === 'catalogue' && !failed && onViewListing ? (
            <Pressable onPress={onViewListing} accessibilityRole="link" hitSlop={6}>
              <Text style={{ color: c.brand, fontSize: 12, fontWeight: '600' }}>· view listing</Text>
            </Pressable>
          ) : null}
        </View>
        {canManage ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Pressable
              onPress={() => setChoosing(true)}
              disabled={busy}
              accessibilityRole="button"
              hitSlop={6}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.surface,
                opacity: busy ? 0.5 : 1,
              }}
            >
              <Ionicons name="camera-outline" size={14} color={c.text} />
              <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }}>
                {hasOwnPhoto ? 'Replace photo' : 'Add photo'}
              </Text>
            </Pressable>
            {hasOwnPhoto ? (
              <Pressable onPress={remove} disabled={busy} accessibilityRole="button" hitSlop={6}>
                <Text style={{ color: c.danger, fontSize: 12, fontWeight: '700', opacity: busy ? 0.5 : 1 }}>
                  Remove
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: c.danger,
            fontSize: 12,
            paddingHorizontal: spacing.lg,
            paddingBottom: 10,
          }}
        >
          {error}
        </Text>
      ) : null}

      {/* Every picture, from the cover on. Shut again if the cover is lost
          while it is open, so it never sits over an illustration. */}
      <PhotoViewer
        photos={slides}
        startIndex={viewing && !showIllustration ? 0 : null}
        onClose={() => setViewing(false)}
      />

      {/* Where the picture comes from - a sheet rather than an Alert, which
          Android caps at three buttons. */}
      <AssetSheet
        visible={choosing}
        title={hasOwnPhoto ? 'Replace the photo' : 'Add a photo'}
        subtitle={assetName}
        onClose={() => setChoosing(false)}
      >
        <Button
          label="Take a photo"
          icon="camera-outline"
          onPress={() => {
            setChoosing(false);
            void pickImageFromCamera().then(upload);
          }}
          style={{ marginBottom: spacing.sm }}
        />
        <Button
          label="Choose from gallery"
          icon="images-outline"
          variant="secondary"
          onPress={() => {
            setChoosing(false);
            void pickImageFromLibrary().then(upload);
          }}
        />
        <Text style={{ color: c.muted, fontSize: 12, marginTop: spacing.md, lineHeight: 18 }}>
          One product shot per asset. Condition evidence at handover and return goes in the Condition
          photos section instead.
        </Text>
      </AssetSheet>
    </Card>
  );
}
