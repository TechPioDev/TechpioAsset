import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import {
  ASSET_PHOTO_ASPECT,
  assetPhotoHint,
  assetSlides,
  illustrationIcon,
  photoSizeLabel,
  slideCountLabel,
  type AssetImageSource,
  type AssetOwnPhoto,
  type IllustrationIcon,
  type SlideCustodyGroup,
} from '@techpioasset/domain';
import { problemMessage } from '../../lib/asset-admin';
import { assetImageCaption, illustrationIonicon } from '../../lib/asset-overview';
import {
  addPhotoRefusal,
  REPLACE_DELETES_OLD,
  removePhotoPrompt,
  unitPhotoActions,
  unitPhotoCoverPath,
  unitPhotoImagePath,
  unitPhotoLabel,
  unitPhotoRemovePath,
  unitPhotoUploadPath,
  uploadedAlert,
  type UnitPhotoActionKey,
} from '../../lib/asset-photos';
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
 * v2.63 (web: v2.62): the box shows the asset's attached pictures, and a tap
 * opens all of them as a slideshow - the lead picture first, then every
 * condition photo. With no lead picture the newest condition photo is the
 * cover; the illustration is only for an asset nobody has photographed. The
 * order is the domain's assetSlides, shared with the web. Only the cover is
 * downloaded with the screen; the viewer fetches the rest as it is opened.
 *
 * Adding a photo goes through the pickers the request composer already uses
 * (system camera or gallery) rather than the condition-photo viewfinder: this
 * is a product shot, not evidence of a handover, and it goes to a different
 * endpoint (POST /assets/:id/unit-photos).
 *
 * v2.65: the owner looked at a phone photo filling this box, saw the top of the
 * laptop cut off, and said the design was not good. Three answers:
 *  - the cover is shown WHOLE, over a blurred, dimmed copy of itself that fills
 *    the box, so nothing is cropped and the box still looks full whatever the
 *    picture's shape. The slideshow was already uncropped;
 *  - an asset holds up to five photos of the unit, managed from a strip under
 *    the box: replace (the server deletes the old file, automatically), make
 *    cover, remove. The limit and its wording are the domain's
 *    asset-photo-rules, shared with the web and the API. The strip's
 *    thumbnails are downloaded only for people who may edit the record;
 *  - the exact size that fills the box (1600 × 800 px) is stated under the
 *    strip, and again - with the picture's own size - after uploading one that
 *    does not fit. An upload is never refused for its shape.
 */

/** A thumbnail in the photo strip: five of them and their gaps fit a 360 dp phone. */
const THUMB = 52;

/**
 * The one sheet the photo strip opens, in two steps so that "Replace" never has
 * to open a second modal over a closing one: what to do with a photo, then
 * where the new picture comes from.
 */
type PhotoSheet =
  | { step: 'actions'; photoId: string }
  /** `replaceId` null adds a photo; otherwise that photo is swapped. */
  | { step: 'source'; replaceId: string | null };

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
  ownPhotos,
  legacyPhotoApi = false,
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
  /**
   * v2.65 - every photo uploaded of this unit (up to five), the cover first,
   * whatever is being shown in the box.
   */
  ownPhotos: readonly AssetOwnPhoto[];
  /**
   * The API that answered predates v2.65 (it sent no `photos` list): the strip
   * then keeps to that API's one-photo routes. False everywhere else.
   */
  legacyPhotoApi?: boolean;
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
  /** The asset is reloaded after a photo is added, replaced, promoted or removed. */
  onChanged: () => void;
}) {
  const { api } = useSession();
  const { c, spacing, radius } = useTheme();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<PhotoSheet | null>(null);
  const [viewing, setViewing] = useState(false);

  // The parent builds `source`, `ownPhotos` and `catalogue` afresh on every
  // render, so the list is rebuilt each time (it is cheap) and its identity
  // held while the pictures in it are the same: the viewer resolves its image
  // sources once per list, and a new list on every render would re-fetch them.
  const fresh = assetSlides({
    assetId,
    source,
    ownPhoto: ownPhotos[0] ?? null,
    ownPhotos,
    catalogue,
    groups: groups ?? [],
  });
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

  // The strip's thumbnails, their image sources held steady for the same
  // reason as the cover's.
  const photoSignature = ownPhotos.map((p) => `${p.id}:${p.sizeBytes ?? ''}`).join('|');
  const thumbs = useMemo(
    () => ownPhotos.map((p) => ({ ...p, src: api.imageSource(unitPhotoImagePath(assetId, p.id)) })),
    [api, assetId, photoSignature],
  );
  const addRefusal = addPhotoRefusal(ownPhotos.length, legacyPhotoApi);
  const addOff = busy || addRefusal !== null;
  // What the sheet draws. It keeps its last contents while it slides shut, so
  // the title and buttons do not change under the person's thumb on the way out.
  const lastSheet = useRef<PhotoSheet | null>(null);
  if (sheet) lastSheet.current = sheet;
  const shown = sheet ?? lastSheet.current;
  const selectedIndex = shown?.step === 'actions' ? ownPhotos.findIndex((p) => p.id === shown.photoId) : -1;

  async function upload(outcome: PickOutcome, replaceId: string | null) {
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
      await api.request(unitPhotoUploadPath(assetId, replaceId, legacyPhotoApi), { formData: form });
      setFailed(false);
      onChanged();
      // Saved whatever its shape; a picture that does not fit the 2:1 box is
      // told its own size and the exact one that does.
      const done = uploadedAlert({ replaced: replaceId !== null, dimensions: outcome.dimensions });
      Alert.alert(done.title, done.message);
    } catch (e) {
      // The server's own words - the five-photo limit, a rejected file - are
      // the problem's `detail`, which is what problemMessage hands back.
      setError(problemMessage(e, 'Could not upload that photo'));
    } finally {
      setBusy(false);
    }
  }

  async function makeCover(photoId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.request(unitPhotoCoverPath(assetId, photoId), { method: 'POST' });
      setFailed(false);
      onChanged();
      Alert.alert('Cover changed');
    } catch (e) {
      setError(problemMessage(e, 'Could not change the cover'));
    } finally {
      setBusy(false);
    }
  }

  function remove(photoId: string) {
    const index = ownPhotos.findIndex((p) => p.id === photoId);
    const prompt = removePhotoPrompt({ isCover: index === 0, count: ownPhotos.length });
    Alert.alert(prompt.title, prompt.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              await api.request(unitPhotoRemovePath(assetId, photoId, legacyPhotoApi), { method: 'DELETE' });
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

  function act(key: UnitPhotoActionKey, photoId: string) {
    if (key === 'replace') {
      setSheet({ step: 'source', replaceId: photoId });
      return;
    }
    setSheet(null);
    if (key === 'cover') void makeCover(photoId);
    else remove(photoId);
  }

  const caption = assetImageCaption(cover, failed);

  return (
    <Card style={{ padding: 0, overflow: 'hidden', marginBottom: spacing.lg }}>
      {/* 2:1 - the shape the upload hint names, the same on the web. */}
      <View style={{ width: '100%', aspectRatio: ASSET_PHOTO_ASPECT }}>
        {showIllustration || !src ? (
          <Illustration icon={illustrationIcon(typeKey)} brand={brand} name={assetName} />
        ) : (
          <Pressable
            onPress={() => setViewing(true)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`View ${slideCountLabel(slides.length)} of ${assetName}`}
            style={{ width: '100%', height: '100%', overflow: 'hidden', backgroundColor: c.background }}
          >
            {/* v2.65 - the backdrop: the same picture blurred and dimmed,
                filling the box, so a portrait phone photo shown whole still
                sits in a full box rather than between two grey bars. It is
                decoration, hidden from screen readers; if it fails to load the
                plain background shows through and nothing else changes. */}
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
            >
              <AuthImage
                uri={src.uri}
                headers={src.headers}
                resizeMode="cover"
                blurRadius={24}
                style={{ width: '100%', height: '100%', backgroundColor: c.background }}
                accessibilityLabel=""
              />
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  left: 0,
                  backgroundColor: 'rgba(2,6,23,0.28)',
                }}
              />
            </View>
            {/* contain: the whole picture, never cropped - what the owner asked
                for after seeing the top of a laptop cut off. */}
            <AuthImage
              uri={src.uri}
              headers={src.headers}
              resizeMode="contain"
              style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }}
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
          gap: 4,
          flexWrap: 'wrap',
          borderTopWidth: 1,
          borderTopColor: c.border,
          paddingHorizontal: spacing.lg,
          paddingVertical: 10,
        }}
      >
        <Text style={{ color: c.subtle, fontSize: 12 }}>{caption}</Text>
        {source.kind === 'catalogue' && !failed && onViewListing ? (
          <Pressable onPress={onViewListing} accessibilityRole="link" hitSlop={6}>
            <Text style={{ color: c.brand, fontSize: 12, fontWeight: '600' }}>· view listing</Text>
          </Pressable>
        ) : null}
      </View>

      {/* v2.65 - the photos of this unit, for people who may edit the record. */}
      {canManage ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: c.border,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            gap: spacing.sm,
          }}
        >
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}
          >
            <Text style={{ color: c.text, fontSize: 13, fontWeight: '700', flexShrink: 1 }}>
              Photos of this unit
            </Text>
            <Pressable
              onPress={() => setSheet({ step: 'source', replaceId: null })}
              disabled={addOff}
              accessibilityRole="button"
              accessibilityState={{ disabled: addOff }}
              accessibilityHint={addRefusal ?? undefined}
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
                opacity: addOff ? 0.5 : 1,
              }}
            >
              <Ionicons name="camera-outline" size={14} color={c.text} />
              <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }}>Add photo</Text>
            </Pressable>
          </View>

          {thumbs.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {thumbs.map((p, i) => (
                <Pressable
                  key={p.id}
                  onPress={() => setSheet({ step: 'actions', photoId: p.id })}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={unitPhotoLabel(i, thumbs.length)}
                  accessibilityHint="Replace, make cover or remove"
                  style={{ width: THUMB, alignItems: 'center', opacity: busy ? 0.5 : 1 }}
                >
                  <View
                    style={{
                      width: THUMB,
                      height: THUMB,
                      borderRadius: radius.md,
                      overflow: 'hidden',
                      borderWidth: i === 0 ? 2 : 1,
                      borderColor: i === 0 ? c.brand : c.border,
                    }}
                  >
                    <AuthImage
                      uri={p.src.uri}
                      headers={p.src.headers}
                      style={{ width: '100%', height: '100%' }}
                      accessibilityLabel=""
                    />
                    {i === 0 ? (
                      <View
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          bottom: 0,
                          backgroundColor: 'rgba(0,0,0,0.65)',
                          paddingVertical: 1,
                        }}
                      >
                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', textAlign: 'center' }}>
                          Cover
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ color: c.subtle, fontSize: 10, marginTop: 2 }} numberOfLines={1}>
                    {photoSizeLabel(p.sizeBytes) ?? ' '}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* Why "Add photo" is off, in the sentence the server would send. */}
          {addRefusal ? <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{addRefusal}</Text> : null}
          {/* The exact size that fills the box, and how many of five are used. */}
          <Text style={{ color: c.subtle, fontSize: 12, lineHeight: 17 }}>
            {assetPhotoHint(ownPhotos.length)}
            {thumbs.length > 0 ? ' Tap a photo to replace it, make it the cover or remove it.' : ''}
          </Text>
        </View>
      ) : null}
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

      {/* One sheet, two steps - a sheet rather than an Alert, which Android
          caps at three buttons. */}
      <AssetSheet
        visible={sheet !== null}
        title={
          shown?.step === 'actions'
            ? unitPhotoLabel(Math.max(selectedIndex, 0), Math.max(ownPhotos.length, 1))
            : shown?.replaceId
              ? 'Replace this photo'
              : 'Add a photo'
        }
        subtitle={assetName}
        onClose={() => setSheet(null)}
      >
        {shown?.step === 'actions' ? (
          unitPhotoActions({ isCover: selectedIndex === 0, legacy: legacyPhotoApi }).map((action) => (
            <Pressable
              key={action.key}
              accessibilityRole="menuitem"
              onPress={() => act(action.key, shown.photoId)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingVertical: 12,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                backgroundColor: pressed ? c.surface : 'transparent',
              })}
            >
              <Ionicons name={action.icon} size={20} color={action.destructive ? c.danger : c.muted} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: action.destructive ? c.danger : c.text, fontSize: 15, fontWeight: '600' }}>
                  {action.label}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 1 }}>{action.hint}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.subtle} />
            </Pressable>
          ))
        ) : shown?.step === 'source' ? (
          <>
            <Button
              label="Take a photo"
              icon="camera-outline"
              onPress={() => {
                const { replaceId } = shown;
                setSheet(null);
                void pickImageFromCamera().then((outcome) => upload(outcome, replaceId));
              }}
              style={{ marginBottom: spacing.sm }}
            />
            <Button
              label="Choose from gallery"
              icon="images-outline"
              variant="secondary"
              onPress={() => {
                const { replaceId } = shown;
                setSheet(null);
                void pickImageFromLibrary().then((outcome) => upload(outcome, replaceId));
              }}
            />
            {shown.replaceId ? (
              <Text style={{ color: c.text, fontSize: 12, marginTop: spacing.md, lineHeight: 18 }}>
                {REPLACE_DELETES_OLD}
              </Text>
            ) : null}
            <Text style={{ color: c.muted, fontSize: 12, marginTop: spacing.md, lineHeight: 18 }}>
              {assetPhotoHint(ownPhotos.length)} A picture of another shape is still accepted, and shown
              whole. Condition evidence at handover and return goes in the Condition photos section instead.
            </Text>
          </>
        ) : null}
      </AssetSheet>
    </Card>
  );
}
