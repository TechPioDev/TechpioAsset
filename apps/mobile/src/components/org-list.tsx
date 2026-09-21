import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSession } from '../providers/session';
import { useTheme } from '../theme';
import { Button, Card, Field, PullRefresh, Screen, SectionTitle, StatusPill } from './ui';

/**
 * Offices and departments are the same screen with different nouns: a list of
 * named things with a code, each editable, each deactivatable rather than
 * deleted - equipment and people point at them, so removing one would orphan
 * records that are still true.
 *
 * Only the fields worth typing on a phone are offered. An office's full postal
 * address is a laptop job; naming a new site while standing in it is not.
 */

export interface OrgRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  city?: string | null;
  country?: string | null;
  _count?: { users?: number; assets?: number };
}

export function OrgListScreen({
  title,
  listPath,
  writePath,
  noun,
  extraField,
}: {
  title: string;
  /** Management list - includes inactive rows. */
  listPath: string;
  /** Collection to POST to, and to PATCH `${writePath}/${id}`. */
  writePath: string;
  noun: string;
  /** Offices take a city; departments do not. */
  extraField?: { key: 'city'; label: string };
}) {
  const { api } = useSession();
  const { c, spacing } = useTheme();

  const [rows, setRows] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<OrgRow | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.request<OrgRow[]>(listPath)) ?? []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [api, listPath]);

  useEffect(() => void load(), [load]);

  const active = useMemo(() => rows.filter((r) => r.isActive), [rows]);
  const inactive = useMemo(() => rows.filter((r) => !r.isActive), [rows]);

  const renderRow = (r: OrgRow, i: number, list: OrgRow[]) => (
    <Pressable
      key={r.id}
      onPress={() => setEditing(r)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: i === list.length - 1 ? 0 : 1,
        borderBottomColor: c.border,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
          {r.name}
        </Text>
        <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
          {[r.code, r.city, r.country].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {!r.isActive ? <StatusPill label="Inactive" bg={c.surface} fg={c.muted} /> : null}
      <Ionicons name="chevron-forward" size={16} color={c.subtle} />
    </Pressable>
  );

  return (
    <>
      <Screen scroll refreshControl={<PullRefresh refreshing={loading} onRefresh={load} />}>
        <Button
          label={`Add ${noun}`}
          icon="add-circle-outline"
          onPress={() => setEditing('new')}
          style={{ marginBottom: spacing.xl }}
        />

        <SectionTitle>{`${title}${active.length ? ` (${active.length})` : ''}`}</SectionTitle>
        {active.length === 0 ? (
          <Card style={{ marginBottom: spacing.xl }}>
            <Text style={{ color: c.muted, fontSize: 14 }}>
              {loading ? 'Loading…' : `No ${noun}s yet.`}
            </Text>
          </Card>
        ) : (
          <Card style={{ padding: 0, marginBottom: spacing.xl }}>
            {active.map((r, i) => renderRow(r, i, active))}
          </Card>
        )}

        {inactive.length > 0 ? (
          <>
            <SectionTitle>Inactive</SectionTitle>
            <Card style={{ padding: 0, marginBottom: spacing.xl }}>
              {inactive.map((r, i) => renderRow(r, i, inactive))}
            </Card>
          </>
        ) : null}
      </Screen>

      <OrgEditor
        target={editing}
        noun={noun}
        writePath={writePath}
        extraField={extraField}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />
    </>
  );
}

function OrgEditor({
  target,
  noun,
  writePath,
  extraField,
  onClose,
  onSaved,
}: {
  target: OrgRow | 'new' | null;
  noun: string;
  writePath: string;
  extraField?: { key: 'city'; label: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const isNew = target === 'new';
  const row = target && target !== 'new' ? target : null;

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setCode(row?.code ?? '');
    setName(row?.name ?? '');
    setCity(row?.city ?? '');
    setActive(row?.isActive ?? true);
    setError(null);
  }, [target, row]);

  async function save() {
    if (!name.trim() || !code.trim()) {
      setError('A code and a name are both needed.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { code: code.trim(), name: name.trim() };
      if (extraField) body[extraField.key] = city.trim() || null;
      if (isNew) {
        await api.request(writePath, { method: 'POST', body });
      } else {
        // isActive is the deactivate switch; only PATCH carries it.
        await api.request(`${writePath}/${row!.id}`, {
          method: 'PATCH',
          body: { ...body, isActive: active },
        });
      }
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error && e.message ? e.message : 'That did not save. Check the code is unique.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={target !== null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(2,6,23,0.45)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: c.background,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            maxHeight: '90%',
            paddingBottom: spacing.xl,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: spacing.lg,
              borderBottomWidth: 1,
              borderBottomColor: c.border,
            }}
          >
            <Text style={{ color: c.text, fontSize: 17, fontWeight: '800', flex: 1 }}>
              {isNew ? `New ${noun}` : row?.name}
            </Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={c.muted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
            <Field
              label="Code"
              placeholder="e.g. BLR-HQ"
              autoCapitalize="characters"
              value={code}
              onChangeText={setCode}
            />
            <Field label="Name" placeholder={`${noun} name`} value={name} onChangeText={setName} />
            {extraField ? (
              <Field label={extraField.label} value={city} onChangeText={setCity} />
            ) : null}

            {!isNew ? (
              <Pressable
                onPress={() => setActive((v) => !v)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 12,
                  marginBottom: spacing.md,
                }}
              >
                <Ionicons
                  name={active ? 'checkbox-outline' : 'square-outline'}
                  size={22}
                  color={active ? c.brand : c.muted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>Active</Text>
                  <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }}>
                    Inactive hides it from pickers without unlinking anyone already on it.
                  </Text>
                </View>
              </Pressable>
            ) : null}

            {error ? (
              <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>{error}</Text>
            ) : null}

            <Button label={isNew ? `Add ${noun}` : 'Save changes'} onPress={save} loading={busy} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
