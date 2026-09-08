import { useCallback, useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSession } from '../providers/session';
import { useTheme } from '../theme';
import { AuthImage } from './auth-image';
import { Card, SectionTitle } from './ui';
import { Ionicons } from '@expo/vector-icons';

/**
 * Condition photos for one asset, on a phone (v2.33).
 *
 * The web lays handover and return side by side in two columns. A phone has no
 * room for that, so each custody event becomes a block: who held it and the
 * condition at each end as a line of text, then the photos in a single
 * horizontal strip that reads left to right in the order they were taken -
 * handover first, return after.
 *
 * The labels do the work the columns did on the web. Without them a strip of
 * photographs of the same laptop says nothing about which were taken when,
 * which is the entire question.
 */

interface Photo {
  id: string;
  caption: string | null;
  takenAt: string;
  by: string | null;
}

interface CustodyGroup {
  assignmentId: string;
  holder: string | null;
  assignedAt: string;
  conditionOut: string;
  returnedAt: string | null;
  conditionIn: string | null;
  open: boolean;
  handover: Photo[];
  returned: Photo[];
}

/** One thumbnail, tappable to open full size. */
function Thumb({
  uri,
  headers,
  label,
  caption,
  onOpen,
}: {
  uri: string;
  headers: Record<string, string>;
  label: string;
  caption: string | null;
  onOpen: (source: { uri: string; headers?: Record<string, string> }) => void;
}) {
  const { radius } = useTheme();
  return (
    <Pressable
      onPress={() => onOpen({ uri, headers })}
      accessibilityRole="imagebutton"
    >
      <AuthImage
        uri={uri}
        headers={headers}
        style={{ width: 96, height: 96, borderRadius: radius.md }}
        accessibilityLabel={caption ?? `${label} photo`}
      />
    </Pressable>
  );
}

/** `refreshKey` changes to force a reload after the camera sheet saves one. */
export function ConditionPhotoStrip({
  assetId,
  refreshKey = 0,
}: {
  assetId: string;
  refreshKey?: number;
}) {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [groups, setGroups] = useState<CustodyGroup[] | null>(null);
  /**
   * The photo being viewed full-screen. A 96px thumbnail shows that a photo
   * exists; it does not show the scratch the photo was taken for, which is the
   * only reason anyone opens this section.
   */
  const [viewing, setViewing] = useState<{
    source: { uri: string; headers?: Record<string, string> };
    label: string;
    caption: string | null;
    by: string | null;
    takenAt: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      setGroups(await api.request<CustodyGroup[]>(`/assets/${assetId}/photos`));
    } catch {
      // A failed photo list must not blank the asset screen around it - the
      // section simply stays empty.
      setGroups([]);
    }
  }, [api, assetId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const withPhotos = (groups ?? []).filter((g) => g.handover.length + g.returned.length > 0);
  if (withPhotos.length === 0) return null;

  const thumb = (photo: Photo, label: string) => {
    const src = api.imageSource(`/assets/${assetId}/photos/${photo.id}`);
    return (
    <View key={photo.id} style={{ marginRight: spacing.md }}>
      <Thumb
        uri={src.uri}
        headers={src.headers}
        label={label}
        caption={photo.caption}
        onOpen={(source) =>
          setViewing({
            source,
            label,
            caption: photo.caption,
            by: photo.by,
            takenAt: photo.takenAt,
          })
        }
      />
      <Text style={{ color: c.muted, fontSize: 11, marginTop: 4 }}>{label}</Text>
      {photo.by ? (
        <Text style={{ color: c.muted, fontSize: 11 }} numberOfLines={1}>
          {photo.by}
        </Text>
      ) : null}
    </View>
    );
  };

  return (
    <>
      <SectionTitle>Condition photos</SectionTitle>
      {withPhotos.map((g) => (
        <Card key={g.assignmentId} style={{ marginBottom: spacing.md }}>
          <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>
            {g.holder ?? 'Unknown holder'}
          </Text>
          <Text style={{ color: c.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.md }}>
            {new Date(g.assignedAt).toLocaleDateString()}
            {g.returnedAt ? ` → ${new Date(g.returnedAt).toLocaleDateString()}` : ' → still out'}
            {'  ·  '}
            {g.conditionOut}
            {g.conditionIn ? ` → ${g.conditionIn}` : ''}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {g.handover.map((p) => thumb(p, 'Handover'))}
            {g.returned.map((p) => thumb(p, 'Return'))}
          </ScrollView>
        </Card>
      ))}

      <Modal
        visible={viewing !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setViewing(null)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              padding: spacing.lg,
              gap: spacing.md,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                {viewing?.caption ?? viewing?.label}
              </Text>
              {/* A photograph proves nothing without when it was taken and by
                  whom, so both travel with it into the full-size view. */}
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 }}>
                {viewing?.label}
                {viewing ? ` · ${new Date(viewing.takenAt).toLocaleString()}` : ''}
                {viewing?.by ? ` · ${viewing.by}` : ''}
              </Text>
            </View>
            <Pressable
              onPress={() => setViewing(null)}
              hitSlop={12}
              accessibilityLabel="Close photo"
            >
              <Ionicons name="close" size={26} color="#fff" />
            </Pressable>
          </View>

          <Pressable style={{ flex: 1 }} onPress={() => setViewing(null)}>
            {viewing ? (
              <Image
                source={viewing.source}
                style={{ flex: 1, width: '100%' }}
                resizeMode="contain"
                accessibilityLabel={viewing.caption ?? `${viewing.label} photo`}
              />
            ) : null}
          </Pressable>
        </View>
      </Modal>
    </>
  );
}
