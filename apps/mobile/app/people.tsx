import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { useSession } from '../src/providers/session';
import { useTheme, type ThemeColors } from '../src/theme';
import { openOffboardingFor, type OpenTaskRow } from '../src/lib/offboarding';
import { Avatar, Button, Card, Chevron, EmptyState, StatusPill } from '../src/components/ui';
import { InviteSheet } from '../src/components/people/invite-sheet';
import { ManageSheet } from '../src/components/people/manage-sheet';
import { useInviteAllPending } from '../src/components/people/invite-all';
import {
  peopleAudience,
  peopleGates,
  peopleRowAffiliation,
  peopleScreenCopy,
  personName,
  statusLabel,
  type UserRow,
} from '../src/lib/people-admin';

/**
 * People, and - for whoever may - inviting and managing them.
 *
 * Mirrors the web People page: search, Active/Deactivated as two views rather
 * than one padded list, Invite and Invite all pending for inviters, and a
 * Manage sheet per person. It used to be the first 100 names and nothing else.
 */

const PAGE_SIZE = 25;

function statusTone(status: string, c: ThemeColors): { bg: string; fg: string } {
  if (status === 'INVITED') return { bg: c.brandSoft, fg: c.brand };
  if (status === 'SUSPENDED') return { bg: c.surface, fg: c.warning };
  return { bg: c.dangerSoft, fg: c.danger };
}

export default function PeopleScreen() {
  const { api, user } = useSession();
  const { c, radius, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  const router = useRouter();
  const gates = peopleGates(user);
  // v2.68 - the same screen lists vendor sign-ins when the menu asks for them
  // (/people?audience=vendors); the default list no longer carries them.
  const audience = peopleAudience(useLocalSearchParams<{ audience?: string }>().audience);
  const copy = peopleScreenCopy(audience);

  const [rows, setRows] = useState<UserRow[]>([]);
  // Who is mid-offboarding, so the row says so before anyone opens Manage.
  const [openTasks, setOpenTasks] = useState<OpenTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'active' | 'deactivated'>('active');
  const [inviting, setInviting] = useState(false);
  const [managing, setManaging] = useState<UserRow | null>(null);
  // Ignore a slow response for a search the user has already moved past.
  const latest = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchPage = useCallback(
    (n: number) => {
      const params = new URLSearchParams({ page: String(n), pageSize: String(PAGE_SIZE), view, audience });
      if (q) params.set('q', q);
      return api.request<UserRow[]>(`/users?${params.toString()}`);
    },
    [api, q, view, audience],
  );

  const load = useCallback(async () => {
    const token = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const [data, tasks] = await Promise.all([
        fetchPage(1).then((d) => d ?? []),
        // Optional: a refusal or a slow answer must not blank the list.
        api.request<OpenTaskRow[]>('/lifecycle/tasks?direction=OFFBOARDING&status=OPEN').catch(() => []),
      ]);
      if (token !== latest.current) return;
      setRows(data);
      setOpenTasks(tasks ?? []);
      setPage(1);
      // The client drops the page meta, so a full page is what says "more".
      setHasMore(data.length === PAGE_SIZE);
    } catch {
      if (token === latest.current) setError('Could not load people.');
    } finally {
      if (token === latest.current) setLoading(false);
    }
  }, [api, fetchPage]);

  useEffect(() => void load(), [load]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || loading) return;
    const token = latest.current;
    setLoadingMore(true);
    try {
      const data = (await fetchPage(page + 1)) ?? [];
      if (token !== latest.current) return;
      setRows((prev) => [...prev, ...data.filter((d) => !prev.some((p) => p.id === d.id))]);
      setPage((p) => p + 1);
      setHasMore(data.length === PAGE_SIZE);
    } catch {
      // A failed next page leaves what is already shown; pull to refresh retries.
    } finally {
      setLoadingMore(false);
    }
  };

  const inviteAll = useInviteAllPending(() => void load());

  const header = (
    <View style={{ marginBottom: spacing.md }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface,
          borderRadius: radius.md,
          paddingHorizontal: 12,
          marginBottom: spacing.md,
        }}
      >
        <Ionicons name="search" size={16} color={c.subtle} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name, email or employee number"
          placeholderTextColor={c.subtle}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search people"
          style={{ flex: 1, color: c.text, fontSize: 15, paddingVertical: 11 }}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={c.subtle} />
          </Pressable>
        ) : null}
      </View>

      {/* Deactivated accounts get their own view instead of padding the list
          with people who cannot sign in. */}
      <View
        accessibilityRole="radiogroup"
        style={{
          flexDirection: 'row',
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: radius.md,
          padding: 3,
          marginBottom: spacing.md,
        }}
      >
        {(
          [
            { value: 'active', label: 'Active' },
            { value: 'deactivated', label: 'Deactivated' },
          ] as const
        ).map((opt) => {
          const on = view === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => setView(opt.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 8,
                borderRadius: radius.md - 3,
                backgroundColor: on ? c.brand : 'transparent',
              }}
            >
              <Text style={{ color: on ? c.brandText : c.muted, fontWeight: '600', fontSize: 14 }}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Stack.Screen options={{ title: copy.title }} />
      {copy.intro && view !== 'deactivated' ? (
        <Text style={{ color: c.muted, fontSize: 13, lineHeight: 18, marginBottom: spacing.md }}>{copy.intro}</Text>
      ) : null}
      {view === 'deactivated' ? (
        <Text style={{ color: c.muted, fontSize: 13, marginBottom: spacing.md }}>
          Deactivated accounts. They keep their history but cannot sign in.
        </Text>
      ) : null}

      {gates.canInvite && audience === 'staff' ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
          <Button label="Invite user" icon="person-add-outline" onPress={() => setInviting(true)} style={{ flex: 1 }} />
          <Button
            label="Invite all pending"
            icon="send-outline"
            variant="secondary"
            onPress={inviteAll.run}
            loading={inviteAll.busy}
            style={{ flex: 1 }}
          />
        </View>
      ) : null}
      {gates.canSeeInvitations ? (
        <Button
          label="Pending invitations"
          icon="mail-outline"
          variant="secondary"
          onPress={() => router.push('/people-invitations')}
          style={{ marginBottom: spacing.sm }}
        />
      ) : null}
      {error ? <Text style={{ color: c.danger, fontSize: 13, marginTop: spacing.sm }}>{error}</Text> : null}
    </View>
  );

  return (
    <>
      <FlatList
        style={{ flex: 1, backgroundColor: c.background }}
        data={rows}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.4}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={c.brand} style={{ marginVertical: spacing.lg }} /> : null}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="people-outline"
              title={copy.emptyTitle}
              message={q ? 'Try a different search.' : 'No one is visible to you yet.'}
            />
          )
        }
        renderItem={({ item }) => {
          const name = personName(item);
          const role = item.roles?.map((r) => r.role?.name).filter(Boolean)[0];
          const tone = statusTone(item.status, c);
          return (
            <Card
              onPress={() => router.push(`/person/${item.id}`)}
              style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
            >
              <Avatar name={name} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {item.profile?.jobTitle ? `${item.profile.jobTitle} · ` : ''}
                  {item.email}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {item.status !== 'ACTIVE' ? (
                    <StatusPill label={statusLabel(item.status)} bg={tone.bg} fg={tone.fg} />
                  ) : null}
                  {openOffboardingFor(openTasks, item.id) ? (
                    <StatusPill label="Offboarding in progress" bg={palette.warning.bg} fg={palette.warning.fg} />
                  ) : null}
                  {role ? <StatusPill label={role} bg={c.brandSoft} fg={c.brand} /> : null}
                  {peopleRowAffiliation(item, audience) ? (
                    <StatusPill label={peopleRowAffiliation(item, audience)!} bg={c.surface} fg={c.muted} />
                  ) : null}
                </View>
              </View>
              {gates.canManage ? (
                <Pressable
                  onPress={() => setManaging(item)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Manage ${name}`}
                  style={{ padding: 4 }}
                >
                  <Ionicons name="settings-outline" size={20} color={c.muted} />
                </Pressable>
              ) : null}
              <Chevron />
            </Card>
          );
        }}
      />

      <InviteSheet visible={inviting} onClose={() => setInviting(false)} onInvited={() => void load()} />
      {managing ? (
        <ManageSheet
          user={managing}
          visible
          onClose={() => setManaging(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </>
  );
}
