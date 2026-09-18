import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import type { AssetSlide } from '@techpioasset/domain';
import { pageFromOffset, stepIndex, viewerCounter, viewerMetaLine } from '../lib/photo-viewer';
import { useSession } from '../providers/session';
import { useTheme } from '../theme';
import { AuthImage } from './auth-image';

/**
 * A photo at full size, and the ones either side of it (v2.63).
 *
 * Lifted out of the condition-photo strip, where it showed one picture, when
 * the asset screen's lead box needed the same screen for a whole slideshow
 * (web: photo-lightbox.tsx). A swipe or the arrows step through the set rather
 * than making somebody close and reopen for each one: comparing a handover
 * shot against the return shot means going back and forth, repeatedly.
 *
 * The caption, who took it and when travel with each picture - a photograph
 * on its own proves nothing without those.
 *
 * A horizontal paging FlatList rather than a carousel library: it renders only
 * the page on screen and its neighbours, so opening a set of twenty downloads
 * three pictures, not twenty.
 */

/**
 * The domain's slide, as it comes: an id, an API-relative path loaded with the
 * session's token, which picture it is ("At handover · Rohit"), and the
 * caption, date and author that travel with it.
 */
export type ViewerPhoto = AssetSlide;

export function PhotoViewer({
  photos,
  startIndex,
  onClose,
}: {
  photos: readonly ViewerPhoto[];
  /** The picture to open on; null keeps the viewer shut. */
  startIndex: number | null;
  onClose: () => void;
}) {
  const open = startIndex !== null && photos.length > 0;
  return (
    <Modal visible={open} animationType="fade" transparent onRequestClose={onClose}>
      {/* Mounted only while open: the list takes its first page from
          initialScrollIndex, which is read once, on mount. */}
      {open ? <Slides photos={photos} startIndex={startIndex ?? 0} onClose={onClose} /> : null}
    </Modal>
  );
}

function Slides({
  photos,
  startIndex,
  onClose,
}: {
  photos: readonly ViewerPhoto[];
  startIndex: number;
  onClose: () => void;
}) {
  const { api } = useSession();
  const { spacing } = useTheme();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<ViewerPhoto>>(null);
  const first = Math.max(0, Math.min(photos.length - 1, startIndex));
  const [index, setIndex] = useState(first);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  // Measured rather than left to flex: a page inside a horizontal list has no
  // height of its own to stretch to on every platform, and a picture with no
  // height draws nothing.
  const [height, setHeight] = useState(0);

  // Resolved once per list: AuthImage re-fetches on the browser build whenever
  // its headers object changes identity, which a fresh one per render would do.
  const sources = useMemo(() => photos.map((p) => api.imageSource(p.path)), [api, photos]);

  // A photo removed behind the viewer can leave the index past the end.
  useEffect(() => {
    if (index > photos.length - 1) setIndex(Math.max(0, photos.length - 1));
  }, [index, photos.length]);

  const photo = photos[Math.min(index, photos.length - 1)];
  if (!photo) return null;
  const many = photos.length > 1;
  const counter = viewerCounter(index, photos.length);

  function step(delta: number) {
    const next = stepIndex(index, delta, photos.length);
    // Wrapping from one end to the other would animate through every picture
    // in between, fetching each; that jump is made without the animation.
    listRef.current?.scrollToIndex({ index: next, animated: Math.abs(next - index) === 1 });
    setIndex(next);
  }

  const arrow = (side: 'left' | 'right') => (
    <Pressable
      onPress={() => step(side === 'left' ? -1 : 1)}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={side === 'left' ? 'Previous photo' : 'Next photo'}
      style={{
        position: 'absolute',
        [side]: spacing.sm,
        top: '50%',
        marginTop: -22,
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.55)',
      }}
    >
      <Ionicons name={side === 'left' ? 'chevron-back' : 'chevron-forward'} size={24} color="#fff" />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', padding: spacing.lg, gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{photo.caption ?? photo.stageLabel}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 }}>
            {viewerMetaLine(photo, (iso) => new Date(iso).toLocaleString())}
          </Text>
        </View>
        {counter ? (
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600', marginTop: 2 }}>
            {counter}
          </Text>
        ) : null}
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close photo">
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
      </View>

      <View style={{ flex: 1 }} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
        {height > 0 ? (
          <FlatList
            // Remounted when the phone turns: every page is one window wide, and
            // the offsets of the old width would land between two pictures.
            key={width}
            ref={listRef}
            style={{ flex: 1 }}
            data={photos}
            keyExtractor={(p) => p.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={Math.min(index, photos.length - 1)}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            windowSize={3}
            // onScroll rather than onMomentumScrollEnd, which the browser build
            // never fires; the index only changes once a swipe passes half way.
            scrollEventThrottle={16}
            onScroll={(e) => {
              const next = pageFromOffset(e.nativeEvent.contentOffset.x, width, photos.length);
              setIndex((current) => (current === next ? current : next));
            }}
            renderItem={({ item, index: i }) => {
              const src = sources[i];
              return (
                // A tap on the picture closes, as the single-photo viewer did; a
                // swipe still reaches the list underneath.
                <Pressable onPress={onClose} style={{ width, height }} accessibilityLabel="Close photo">
                  {failed.has(item.id) || !src ? (
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <Ionicons name="image-outline" size={40} color="rgba(255,255,255,0.5)" />
                      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
                        This picture could not be loaded
                      </Text>
                    </View>
                  ) : (
                    <AuthImage
                      uri={src.uri}
                      headers={src.headers}
                      resizeMode="contain"
                      style={{ flex: 1, width: '100%', backgroundColor: 'transparent' }}
                      accessibilityLabel={item.caption ?? item.stageLabel}
                      onError={() => setFailed((prev) => new Set(prev).add(item.id))}
                    />
                  )}
                </Pressable>
              );
            }}
          />
        ) : null}
        {many ? arrow('left') : null}
        {many ? arrow('right') : null}
      </View>
    </View>
  );
}
