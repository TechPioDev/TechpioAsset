import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, Text, View, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { formatFileSize, parseMessageBody } from '@techpioasset/domain';
import {
  MAX_COMMENT_IMAGES,
  addPendingPhoto,
  insertPhotoMarker,
  photoCaption,
  removePhotoMarker,
  syncPhotosToMarkers,
  withPhotoSize,
  type PendingPhoto,
  type TextSelection,
} from '../../lib/comment-images';
import { PICKER_UNAVAILABLE_MESSAGE, pickImageFromCamera, pickImageFromLibrary, type PickOutcome } from '../../lib/pick-image';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { AuthImage } from '../auth-image';
import { Button } from '../ui';

/**
 * Pictures inline in a message, on the phone (v2.61). Shared by the
 * conversation and the new-request form: the banner that reports back, the
 * marker/photo state behind a text box, the strip of thumbnails, the picker
 * buttons, and the thread renderer that puts each picture where its token is.
 */

export type FlashTone = 'success' | 'error';
export interface Flash {
  tone: FlashTone;
  text: string;
}

/** The app's answer to a toast: auto-hides, errors linger longer, never blocks what is behind it. */
export function useFlash() {
  const [flash, setFlash] = useState<Flash | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFlash = useCallback((tone: FlashTone, text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setFlash({ tone, text });
    timer.current = setTimeout(() => setFlash(null), tone === 'error' ? 8000 : 4000);
  }, []);
  const clearFlash = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setFlash(null);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return { flash, showFlash, clearFlash };
}

export function FlashBanner({ flash }: { flash: Flash | null }) {
  const { scheme, spacing, radius } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  if (!flash) return null;
  const tone = flash.tone === 'success' ? palette.success : palette.critical;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: tone.bg,
        borderColor: tone.border,
        borderWidth: 1,
        borderRadius: radius.md,
        padding: 10,
        marginBottom: spacing.md,
      }}
    >
      <Ionicons name={flash.tone === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color={tone.fg} />
      <Text style={{ color: tone.fg, fontSize: 13, flex: 1 }}>{flash.text}</Text>
    </View>
  );
}

/**
 * The pictures behind a text box, and their `[photo N]` markers in it.
 *
 * The text is the parent's state; this keeps the photo list in step with the
 * markers (delete a marker and its picture goes, remove a picture and its
 * marker goes) and puts a new marker in where the cursor was last seen.
 */
export function usePhotoMarkers({
  text,
  setText,
  showFlash,
}: {
  text: string;
  setText: (next: string) => void;
  showFlash: (tone: FlashTone, text: string) => void;
}) {
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const selection = useRef<TextSelection | null>(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  const onSelectionChange = useCallback((e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    selection.current = e.nativeEvent.selection;
  }, []);

  /** For the text box's onChangeText: the words changed, so the pictures may have. */
  const onChangeText = useCallback(
    (next: string) => {
      const synced = syncPhotosToMarkers(next, photosRef.current);
      if (synced.photos.length !== photosRef.current.length) {
        photosRef.current = synced.photos;
        setPhotos(synced.photos);
      }
      setText(synced.text);
    },
    [setText],
  );

  const queue = useCallback(
    async (outcome: PickOutcome) => {
      if (outcome.kind === 'cancelled') return;
      if (outcome.kind === 'denied') return showFlash('error', 'Permission was refused, so no picture was added.');
      if (outcome.kind === 'unavailable') return showFlash('error', PICKER_UNAVAILABLE_MESSAGE);
      const { next, rejected } = addPendingPhoto(photosRef.current, { ...outcome.image, sizeBytes: null });
      if (rejected) return showFlash('error', rejected);
      photosRef.current = next;
      setPhotos(next);
      setText(insertPhotoMarker(text, selection.current, next.length).text);
      // The picker rarely reports a size, and the owner wants one on every
      // picture: read the file's bytes once, off the render path.
      const added = next[next.length - 1]!;
      try {
        const blob = await fetch(added.uri).then((r) => r.blob());
        setPhotos((current) => withPhotoSize(current, added.key, blob.size));
      } catch {
        // Left unmeasured; the caption then shows the name alone.
      }
    },
    [text, setText, showFlash],
  );

  const remove = useCallback(
    (key: string) => {
      const index = photosRef.current.findIndex((p) => p.key === key);
      if (index < 0) return;
      const synced = syncPhotosToMarkers(removePhotoMarker(text, index + 1), photosRef.current);
      photosRef.current = synced.photos;
      setPhotos(synced.photos);
      setText(synced.text);
    },
    [text, setText],
  );

  const clear = useCallback(() => {
    photosRef.current = [];
    setPhotos([]);
  }, []);

  return {
    photos,
    onSelectionChange,
    onChangeText,
    addFromLibrary: () => void pickImageFromLibrary().then(queue),
    addFromCamera: () => void pickImageFromCamera().then(queue),
    remove,
    clear,
  };
}

/** The pictures behind the markers, numbered to match, each with its size and a remove control. */
export function PhotoMarkerStrip({
  photos,
  onRemove,
  disabled,
}: {
  photos: PendingPhoto[];
  onRemove: (key: string) => void;
  disabled: boolean;
}) {
  const { c, spacing, radius } = useTheme();
  if (photos.length === 0) return null;
  return (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}
      accessibilityLabel="Images in the message"
    >
      {photos.map((photo, i) => (
        <View key={photo.key} style={{ width: 96 }}>
          <Image
            source={{ uri: photo.uri }}
            style={{ width: 96, height: 72, borderRadius: radius.md, backgroundColor: c.border }}
            resizeMode="cover"
            accessibilityLabel={photo.name}
          />
          <View
            style={{
              position: 'absolute',
              top: 4,
              left: 4,
              backgroundColor: 'rgba(0,0,0,0.55)',
              borderRadius: 999,
              paddingHorizontal: 6,
              paddingVertical: 1,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{`photo ${i + 1}`}</Text>
          </View>
          <Text style={{ color: c.subtle, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
            {photoCaption(photo)}
          </Text>
          <Pressable
            onPress={() => onRemove(photo.key)}
            disabled={disabled}
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
  );
}

/** Photo (gallery) and, off the browser build, Camera. */
export function PhotoPickButtons({
  onLibrary,
  onCamera,
  disabled,
  count,
}: {
  onLibrary: () => void;
  onCamera: () => void;
  disabled: boolean;
  count: number;
}) {
  const { spacing } = useTheme();
  const full = disabled || count >= MAX_COMMENT_IMAGES;
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
      <Button label="Photo" icon="image-outline" variant="secondary" onPress={onLibrary} disabled={full} style={{ flex: 1 }} />
      {Platform.OS === 'web' ? null : (
        <Button label="Camera" icon="camera-outline" variant="secondary" onPress={onCamera} disabled={full} style={{ flex: 1 }} />
      )}
    </View>
  );
}

export interface CommentAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
}

const INLINE_W = 240;
const INLINE_H = 180;
const THUMB = 120;

/**
 * A sent message: its text with each picture where the writer put it. Pictures
 * the text does not mention (older messages and builds) follow as thumbnails.
 * A token for a picture the server did not return - one this viewer may not
 * see, or one since removed - shows as unavailable, never as a broken image.
 */
export function MessageBodyView({
  requestId,
  body,
  attachments,
  onOpen,
}: {
  requestId: string;
  body: string;
  attachments: CommentAttachment[];
  onOpen: (attachment: CommentAttachment) => void;
}) {
  const { api } = useSession();
  const { c, spacing, radius } = useTheme();
  const images = attachments.filter((a) => a.isImage);
  const byId = new Map(images.map((a) => [a.id, a]));
  const segments = parseMessageBody(body);
  const referenced = new Set(
    segments.flatMap((s) => (s.kind === 'image' && s.ref.kind === 'attachment' && byId.has(s.ref.id) ? [s.ref.id] : [])),
  );
  const trailing = images.filter((a) => !referenced.has(a.id));

  const picture = (att: CommentAttachment, width: number, height: number) => (
    <Pressable
      key={att.id}
      onPress={() => onOpen(att)}
      accessibilityRole="imagebutton"
      accessibilityLabel={`Open ${att.originalName}`}
      style={{ width, marginVertical: 4 }}
    >
      <AuthImage
        {...api.imageSource(`/requests/${requestId}/attachments/${att.id}`)}
        style={{ width, height, borderRadius: radius.md }}
        accessibilityLabel={att.originalName}
      />
      <Text style={{ color: c.subtle, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
        {att.originalName} · {formatFileSize(att.sizeBytes)}
      </Text>
    </Pressable>
  );

  return (
    <>
      {segments.map((s, i) => {
        if (s.kind === 'text') {
          const text = s.text.replace(/^\n+|\n+$/g, (m) => (m.length > 1 ? '\n' : ''));
          if (text.length === 0) return null;
          return (
            <Text key={i} style={{ color: c.muted, fontSize: 14, marginTop: 4, lineHeight: 20 }}>
              {text}
            </Text>
          );
        }
        const att = s.ref.kind === 'attachment' ? byId.get(s.ref.id) : undefined;
        if (!att) {
          return (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                alignSelf: 'flex-start',
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: c.border,
                borderRadius: radius.md,
                paddingHorizontal: 8,
                paddingVertical: 4,
                marginVertical: 4,
              }}
            >
              <Ionicons name="image-outline" size={14} color={c.subtle} />
              <Text style={{ color: c.subtle, fontSize: 12 }}>Image unavailable</Text>
            </View>
          );
        }
        return picture(att, INLINE_W, INLINE_H);
      })}
      {trailing.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
          {trailing.map((att) => picture(att, THUMB, THUMB))}
        </View>
      ) : null}
    </>
  );
}
