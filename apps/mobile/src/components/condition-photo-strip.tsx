import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { conditionPhotosEmptyMessage } from '@techpioasset/domain';
import { useSession } from '../providers/session';
import { useTheme } from '../theme';
import { AuthImage } from './auth-image';
import { Button, Card, SectionTitle } from './ui';
import { Ionicons } from '@expo/vector-icons';

/**
 * Condition photos for one asset, on a phone (v2.33).
 *
 * The web lays handover and return side by side in two columns. A phone has no
 * room for that, so each custody event becomes a block: who held it, the dates
 * and the condition at each end, then "At handover" and "On return" stacked,
 * each with its own horizontal strip of photos (or "No photos").
 *
 * The headings do the work the columns did on the web. Without them a strip of
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

/**
 * `refreshKey` changes to force a reload after the camera sheet saves one.
 *
 * `canCapture` is the web's rule - either custody right - and turns on the add
 * button, the empty-state line and removal of an open handover's photos.
 * Without it the section stays out of the way unless photos exist, which is
 * what an employee looking at their own laptop should see.
 */
export function ConditionPhotoStrip({
  assetId,
  refreshKey = 0,
  canCapture = false,
  holderName = null,
  onAdd,
}: {
  assetId: string;
  refreshKey?: number;
  canCapture?: boolean;
  holderName?: string | null;
  /** Opens the camera sheet for the stage that makes sense right now. */
  onAdd?: (stage: 'HANDOVER' | 'RETURN') => void;
}) {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [groups, setGroups] = useState<CustodyGroup[] | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
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

  // Still loading renders nothing, as on the web: most assets have no photos,
  // and a placeholder that resolves to an absent section is worse than none.
  if (groups === null) return null;
  const current = groups[0];
  const withPhotos = groups.filter((g) => g.handover.length + g.returned.length > 0);
  if (withPhotos.length === 0 && !canCapture) return null;

  function remove(photoId: string) {
    Alert.alert('Remove this photo?', 'It can only be removed while the handover is still open.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            setRemovingId(photoId);
            try {
              await api.request(`/assets/${assetId}/photos/${photoId}`, { method: 'DELETE' });
              await load();
            } catch (e) {
              Alert.alert('Could not remove that photo', e instanceof Error ? e.message : '');
            } finally {
              setRemovingId(null);
            }
          })(),
      },
    ]);
  }

  const thumb = (photo: Photo, label: string, removable: boolean) => {
    const src = api.imageSource(`/assets/${assetId}/photos/${photo.id}`);
    return (
      <View key={photo.id} style={{ marginRight: spacing.md, width: 96 }}>
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
        <Text style={{ color: c.muted, fontSize: 11, marginTop: 4 }} numberOfLines={1}>
          {photo.caption ?? new Date(photo.takenAt).toLocaleDateString()}
        </Text>
        {photo.by ? (
          <Text style={{ color: c.muted, fontSize: 11 }} numberOfLines={1}>
            {photo.by}
          </Text>
        ) : null}
        {removable ? (
          <Pressable onPress={() => remove(photo.id)} disabled={removingId === photo.id} hitSlop={6}>
            <Text style={{ color: c.danger, fontSize: 11, marginTop: 2, opacity: removingId === photo.id ? 0.5 : 1 }}>
              Remove
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  /** One stage of one custody event: its heading, then its photos or "No photos". */
  const stageRow = (title: string, photos: Photo[], label: string, removable: boolean) => (
    <View style={{ marginTop: spacing.md }}>
      <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600', marginBottom: 6 }}>{title}</Text>
      {photos.length === 0 ? (
        <Text style={{ color: c.subtle, fontSize: 12 }}>No photos</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {photos.map((p) => thumb(p, label, removable))}
        </ScrollView>
      )}
    </View>
  );

  return (
    <>
      <SectionTitle>Condition photos</SectionTitle>
      {canCapture ? (
        <Card style={{ marginBottom: spacing.md }}>
          <Text style={{ color: c.muted, fontSize: 13 }}>What it looked like going out, and coming back.</Text>
          {current && onAdd ? (
            <Button
              label={current.open ? 'Add handover photo' : 'Add return photo'}
              icon="camera-outline"
              variant="secondary"
              onPress={() => onAdd(current.open ? 'HANDOVER' : 'RETURN')}
              style={{ marginTop: spacing.md }}
            />
          ) : null}
          {withPhotos.length === 0 ? (
            <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20, marginTop: spacing.md }}>
              {conditionPhotosEmptyMessage(Boolean(current), holderName)}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* One block per custody event: who, when, the condition recorded at
          each end, then the two stages under their own headings - the phone's
          stacked version of the web's two columns. */}
      {withPhotos.map((g) => (
        <Card key={g.assignmentId} style={{ marginBottom: spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' }}>
            <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>{g.holder ?? 'Unknown holder'}</Text>
            <Text style={{ color: c.subtle, fontSize: 12 }}>
              {new Date(g.assignedAt).toLocaleDateString()}
              {g.returnedAt ? ` → ${new Date(g.returnedAt).toLocaleDateString()}` : ' → still out'}
            </Text>
          </View>
          <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
            Condition out: <Text style={{ fontWeight: '700' }}>{g.conditionOut}</Text>
            {g.conditionIn ? (
              <>
                {' · '}back: <Text style={{ fontWeight: '700' }}>{g.conditionIn}</Text>
              </>
            ) : null}
          </Text>
          {/* Removable only while the handover is open: once a return has
              closed it these are the "before" half of a comparison, and the
              server refuses to delete them anyway. */}
          {stageRow('At handover', g.handover, 'Handover', canCapture && g.open)}
          {stageRow('On return', g.returned, 'Return', false)}
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
