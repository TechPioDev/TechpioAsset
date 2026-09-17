import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, Text, View } from 'react-native';
import { MAX_PAGE_SIZE } from '@techpioasset/contracts';
import type { AssetStatus } from '@techpioasset/domain';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { useSession } from '../../src/providers/session';
import { statusColor, statusLabel, useTheme } from '../../src/theme';
import {
  Avatar,
  Button,
  Card,
  Chevron,
  IconBadge,
  Screen,
  SectionTitle,
  StatusPill,
} from '../../src/components/ui';
import { ChangeEmailRow } from '../../src/components/people/change-email';
import { ManageSheet } from '../../src/components/people/manage-sheet';
import { peopleGates, statusLabel as accountStatusLabel, type UserRow } from '../../src/lib/people-admin';
import {
  offboardActionLabel,
  offboardGates,
  openOffboardingFor,
  type OpenTaskRow,
} from '../../src/lib/offboarding';

/**
 * What one person holds.
 *
 * The list of people was a dead end on the phone - you could see who worked here
 * and nothing else. The question actually asked while standing in front of
 * someone is "what have you got?", usually right before taking some of it back,
 * so every row here opens the asset, where the hand-over actions are.
 *
 * Consumables come from a different place than assets (stock held, not
 * assignments) but read as one list to the person holding them, so they are
 * shown together and labelled by quantity rather than by serial.
 */

interface Person {
  id: string;
  email: string;
  status: string;
  profile: {
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    jobTitle: string | null;
    // The API nests these under the profile; they were read from the top level
    // here, so department and office never showed.
    department: { id: string; name: string } | null;
    office: { id: string; name: string } | null;
    manager: {
      id: string;
      email: string;
      profile: { firstName: string; lastName: string } | null;
    } | null;
  } | null;
  roles: { role?: { key?: string; name?: string } | null; name?: string }[];
}

interface HeldAsset {
  id: string;
  assetTag: string;
  name: string;
  status: AssetStatus;
  serialNumber: string | null;
  brand: string | null;
  model: string | null;
  subcategory: { name: string } | null;
}

/** Shape returned by /stock/held-by/:userId - the item is flattened onto the row. */
interface HeldConsumable {
  inventoryItemId: string;
  name: string;
  unit: string | null;
  quantity: number;
}

interface PersonRequest {
  id: string;
  requestNumber: string;
  status: string;
  itemDescription?: string | null;
}

const nameOf = (p: Person) =>
  p.profile?.displayName ||
  [p.profile?.firstName, p.profile?.lastName].filter(Boolean).join(' ') ||
  p.email;

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useSession();
  const gates = peopleGates(user);
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  const router = useRouter();

  const [person, setPerson] = useState<Person | null>(null);
  const [assets, setAssets] = useState<HeldAsset[]>([]);
  const [consumables, setConsumables] = useState<HeldConsumable[]>([]);
  const [requests, setRequests] = useState<PersonRequest[]>([]);
  const [openTasks, setOpenTasks] = useState<OpenTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  // The Manage sheet needs the list row: GET /users/:id does not carry the
  // request override, and the web opens the same panel from the list too.
  const [manageRow, setManageRow] = useState<UserRow | null>(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      // Held stock and requests are secondary: a missing one should not blank
      // the page, so each falls back to empty rather than rejecting the lot.
      const [p, a, s, r, t] = await Promise.all([
        api.request<Person>(`/users/${id}`),
        api.request<HeldAsset[]>(`/assets?assignedUserId=${id}&pageSize=${MAX_PAGE_SIZE}`).catch(() => []),
        api.request<HeldConsumable[]>(`/stock/held-by/${id}`).catch(() => []),
        api.request<PersonRequest[]>(`/requests?requesterId=${id}&pageSize=10`).catch(() => []),
        // Open offboardings, for the "in progress" pill. Same query as People.
        api.request<OpenTaskRow[]>('/lifecycle/tasks?direction=OFFBOARDING&status=OPEN').catch(() => []),
      ]);
      setPerson(p);
      setAssets(a ?? []);
      setConsumables(s ?? []);
      setRequests(r ?? []);
      setOpenTasks(t ?? []);
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  // On focus rather than on mount: coming back from the Offboarding screen
  // must show the Deactivated pill and the emptied kit without a pull.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openManage = async () => {
    if (!person) return;
    setOpening(true);
    try {
      const view = person.status === 'DEACTIVATED' ? 'deactivated' : 'active';
      const rows = await api.request<UserRow[]>(
        `/users?q=${encodeURIComponent(person.email)}&view=${view}&pageSize=25`,
      );
      const row = rows?.find((r) => r.id === person.id);
      if (row) setManageRow(row);
      else Alert.alert('Could not open', 'This person could not be found in People. Pull to refresh and try again.');
    } catch {
      Alert.alert('Could not open', 'Check your connection and try again.');
    } finally {
      setOpening(false);
    }
  };

  if (!person) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }

  const role = person.roles?.map((r) => r.role?.name ?? r.name).filter(Boolean)[0];
  const name = nameOf(person);
  const openTask = openOffboardingFor(openTasks, person.id);
  const offboard = offboardGates(user, person);

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Card style={{ marginBottom: spacing.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Avatar name={name} size={52} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '800' }} numberOfLines={1}>
              {name}
            </Text>
            <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
              {person.email}
            </Text>
          </View>
        </View>
        <View style={{ marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {role ? <StatusPill label={role} bg={c.brandSoft} fg={c.brand} /> : null}
          {person.status !== 'ACTIVE' ? (
            <StatusPill label={accountStatusLabel(person.status)} bg={c.dangerSoft} fg={c.danger} />
          ) : null}
          {openTask ? (
            <StatusPill label="Offboarding in progress" bg={palette.warning.bg} fg={palette.warning.fg} />
          ) : null}
          {person.profile?.jobTitle ? (
            <StatusPill label={person.profile.jobTitle} bg={c.surface} fg={c.muted} />
          ) : null}
          {person.profile?.department?.name ? (
            <StatusPill label={person.profile.department.name} bg={c.surface} fg={c.muted} />
          ) : null}
          {person.profile?.office?.name ? (
            <StatusPill label={person.profile.office.name} bg={c.surface} fg={c.muted} />
          ) : null}
        </View>
        <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.md }}>
          <Text style={{ color: c.subtle, fontSize: 12 }}>Line manager</Text>
          {person.profile?.manager ? (
            <Pressable onPress={() => router.push(`/person/${person.profile!.manager!.id}`)}>
              <Text style={{ color: c.brand, fontSize: 14, fontWeight: '600', marginTop: 2 }}>
                {person.profile.manager.profile
                  ? `${person.profile.manager.profile.firstName} ${person.profile.manager.profile.lastName}`
                  : person.profile.manager.email}
              </Text>
            </Pressable>
          ) : (
            // Not a blank: "none" here has a consequence worth naming.
            <Text style={{ color: c.muted, fontSize: 14, marginTop: 2 }}>
              Not set — approvals fall back to the Manager role
            </Text>
          )}
        </View>
        {gates.canChangeEmail ? (
          <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.md }}>
            <ChangeEmailRow userId={person.id} current={person.email} onChanged={() => void load()} />
          </View>
        ) : null}
        {/* The one management action that lives here rather than in Manage:
            it works through the kit below, so it belongs beside it. */}
        {offboard.canOffboard ? (
          <Button
            label={offboardActionLabel(Boolean(openTask))}
            icon="log-out-outline"
            variant={openTask ? 'primary' : 'secondary'}
            onPress={() => router.push(`/person/offboard?id=${person.id}`)}
            style={{ marginTop: spacing.md }}
          />
        ) : null}
        {gates.canManage ? (
          <Button
            label="Manage"
            icon="settings-outline"
            variant="secondary"
            loading={opening}
            onPress={() => void openManage()}
            style={{ marginTop: gates.canManage && offboard.canOffboard ? spacing.sm : spacing.md }}
          />
        ) : null}
      </Card>

      {manageRow ? (
        <ManageSheet
          user={manageRow}
          visible
          onClose={() => setManageRow(null)}
          onChanged={() => void load()}
          onDeleted={() => router.back()}
        />
      ) : null}

      {/* Say "100+" rather than "100" when the page is full: the count is of
          what was fetched, and presenting a capped page as a total is the same
          mistake the Reports screen used to make. */}
      <SectionTitle>
        {`Equipment${assets.length ? ` (${assets.length}${assets.length === MAX_PAGE_SIZE ? '+' : ''})` : ''}`}
      </SectionTitle>
      {assets.length === 0 ? (
        <Card style={{ marginBottom: spacing.xl }}>
          <Text style={{ color: c.muted, fontSize: 14 }}>Nothing is issued to {name} yet.</Text>
        </Card>
      ) : (
        <View style={{ marginBottom: spacing.xl }}>
          {assets.map((a) => {
            const tone = statusColor(a.status, scheme);
            const identity = a.serialNumber ? `SN ${a.serialNumber}` : a.assetTag;
            return (
              <Card
                key={a.id}
                onPress={() => router.push(`/asset/${a.id}`)}
                style={{
                  marginBottom: spacing.md,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                }}
              >
                <IconBadge icon="hardware-chip-outline" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                    {[a.subcategory?.name, [a.brand, a.model].filter(Boolean).join(' '), identity]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  <View style={{ flexDirection: 'row', marginTop: 6 }}>
                    <StatusPill label={statusLabel(a.status)} bg={tone.bg} fg={tone.fg} />
                  </View>
                </View>
                <Chevron />
              </Card>
            );
          })}
        </View>
      )}

      {consumables.length > 0 ? (
        <>
          <SectionTitle>Consumables held</SectionTitle>
          <Card style={{ padding: 0, marginBottom: spacing.xl }}>
            {consumables.map((s, i) => (
              <View
                key={s.inventoryItemId}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  paddingVertical: 13,
                  borderBottomWidth: i === consumables.length - 1 ? 0 : 1,
                  borderBottomColor: c.border,
                }}
              >
                <Text style={{ color: c.text, fontSize: 14, flex: 1 }} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>
                  {s.quantity}
                  {s.unit ? ` ${s.unit}` : ''}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {requests.length > 0 ? (
        <>
          <SectionTitle>Recent requests</SectionTitle>
          <Card style={{ padding: 0, marginBottom: spacing.xl }}>
            {requests.map((r, i) => (
              <Pressable
                key={r.id}
                onPress={() => router.push(`/request/${r.id}`)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  paddingHorizontal: 16,
                  paddingVertical: 13,
                  borderBottomWidth: i === requests.length - 1 ? 0 : 1,
                  borderBottomColor: c.border,
                }}
              >
                <Ionicons name="document-text-outline" size={18} color={c.muted} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
                    {r.requestNumber}
                  </Text>
                  {r.itemDescription ? (
                    <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                      {r.itemDescription}
                    </Text>
                  ) : null}
                </View>
                <Chevron />
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
