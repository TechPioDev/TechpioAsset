import { useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { ApiError } from '../../lib/api-client';
import { problemMessage } from '../../lib/asset-admin';
import { NOTES_MAX_LENGTH, notesPayload } from '../../lib/asset-overview';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { Button, Card } from '../ui';
import { CardTitle } from './detail-parts';

/**
 * The Notes tab (web: asset-notes.tsx, v2.61): the asset's free-text notes,
 * edited in place.
 *
 * Goes through the ordinary PATCH /assets/:id with the record's version, so a
 * note typed over somebody else's concurrent edit is refused the same way the
 * edit form's would be. Read-only for anyone without assets:update - the
 * holder still sees the notes, which is the owner's 2026-08-12 decision.
 */
export function AssetNotes({
  assetId,
  notes,
  description,
  version,
  canEdit,
  onEditForm,
  onSaved,
}: {
  assetId: string;
  notes: string | null | undefined;
  description: string | null | undefined;
  version: number;
  canEdit: boolean;
  /** Opens the full edit form, where the description lives. */
  onEditForm: () => void;
  /** Reloads the asset - after a save, and after a conflict so the version catches up. */
  onSaved: () => void;
}) {
  const { api } = useSession();
  const { c, spacing, radius } = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.request(`/assets/${assetId}`, { method: 'PATCH', body: notesPayload(draft, version) });
      setEditing(false);
      onSaved();
      Alert.alert('Notes saved');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // The draft is kept and the record refreshed underneath it, so "save
        // again" genuinely works once the version has caught up.
        onSaved();
        Alert.alert(
          'Notes changed elsewhere',
          'This asset was edited since it loaded. Its latest version has been brought in - your text is kept. Review and save again.',
        );
      } else {
        Alert.alert('Could not save the notes', problemMessage(e, 'Try again in a moment.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {description ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <CardTitle>Description</CardTitle>
          <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>{description}</Text>
          {canEdit ? (
            <Text
              onPress={onEditForm}
              accessibilityRole="link"
              style={{ color: c.brand, fontSize: 13, fontWeight: '600', marginTop: spacing.md }}
            >
              Edit on the asset form
            </Text>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardTitle
          action={
            canEdit && !editing ? (
              <Text
                onPress={() => {
                  setDraft(notes ?? '');
                  setEditing(true);
                }}
                accessibilityRole="button"
                style={{ color: c.brand, fontSize: 13, fontWeight: '600' }}
              >
                {notes ? 'Edit notes' : 'Add notes'}
              </Text>
            ) : null
          }
        >
          Notes
        </CardTitle>
        <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>
          Known problems, quirks and anything the next holder should know. Visible to whoever holds the
          device.
        </Text>

        {editing ? (
          <View style={{ marginTop: spacing.md }}>
            <TextInput
              accessibilityLabel="Asset notes"
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={NOTES_MAX_LENGTH}
              textAlignVertical="top"
              placeholderTextColor={c.subtle}
              placeholder="Nothing recorded yet"
              style={{
                minHeight: 160,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.surface,
                color: c.text,
                borderRadius: radius.md,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 15,
                lineHeight: 21,
              }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Save notes" onPress={() => void save()} loading={busy} style={{ flex: 1 }} />
              <Button label="Cancel" variant="ghost" onPress={() => setEditing(false)} disabled={busy} />
            </View>
            <Text style={{ color: c.subtle, fontSize: 12, marginTop: 6, textAlign: 'right' }}>
              {draft.length} / {NOTES_MAX_LENGTH}
            </Text>
          </View>
        ) : notes ? (
          <Text selectable style={{ color: c.text, fontSize: 14, lineHeight: 21, marginTop: spacing.md }}>
            {notes}
          </Text>
        ) : (
          <Text style={{ color: c.muted, fontSize: 14, marginTop: spacing.md }}>
            No notes recorded for this asset.
          </Text>
        )}
      </Card>
    </>
  );
}
