import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import {
  searchGroups,
  searchSummary,
  searchTerm,
  SEARCH_MIN_LENGTH,
  type SearchGroupKey,
  type SearchRow,
} from '@techpioasset/domain';
import { searchMenu } from '../src/lib/menu';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Card, Chevron, Screen, SectionTitle } from '../src/components/ui';

type IconName = ComponentProps<typeof Ionicons>['name'];

const GROUP_ICON: Record<SearchGroupKey, IconName> = {
  assets: 'cube-outline',
  people: 'person-outline',
  requests: 'document-text-outline',
};

/** Where a result leads on the phone; the domain leaves that to each platform. */
const GROUP_HREF: Record<SearchGroupKey, (id: string) => string> = {
  assets: (id) => `/asset/${id}`,
  people: (id) => `/person/${id}`,
  requests: (id) => `/request/${id}`,
};

/**
 * Search everything (0.3.32): one box for an asset, a person, a request - or a
 * screen of the app.
 *
 * Somebody holding a serial number, a colleague's name or a request number used
 * to have to know which list to open first. This asks the three lists at once
 * (the domain's global-search.ts: each already applies this account's
 * permission and scope, so an employee finds only their own) and the Menu,
 * which is the app's own statement of what this person may open.
 *
 * A group that fails or finds nothing is simply not shown. A slow answer for a
 * term the person has already typed past is dropped, not drawn.
 */
export default function SearchScreen() {
  const { api, user } = useSession();
  const router = useRouter();
  const { c, radius, spacing } = useTheme();
  const [text, setText] = useState('');
  const [term, setTerm] = useState<string | null>(null);
  const [results, setResults] = useState<Partial<Record<SearchGroupKey, SearchRow[]>>>({});
  const [searching, setSearching] = useState(false);
  const latest = useRef(0);

  const permissions = useMemo(() => user?.permissions ?? [], [user?.permissions]);
  const roles = useMemo(() => user?.roles ?? [], [user?.roles]);
  const groups = useMemo(() => searchGroups(permissions), [permissions]);

  // Typing pauses for a moment before anything is asked of the server.
  useEffect(() => {
    const timer = setTimeout(() => setTerm(searchTerm(text)), 300);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const ticket = ++latest.current;
    if (!term) {
      setResults({});
      setSearching(false);
      return;
    }
    setSearching(true);
    void Promise.all(
      groups.map((group) =>
        api
          .request<unknown>(group.path(term))
          .then((payload) => [group.key, group.rows(payload)] as const)
          .catch(() => [group.key, [] as SearchRow[]] as const),
      ),
    ).then((entries) => {
      if (ticket !== latest.current) return;
      setResults(Object.fromEntries(entries));
      setSearching(false);
    });
  }, [api, groups, term]);

  const screens = useMemo(
    () => (term ? searchMenu(term, permissions, roles).slice(0, 5) : []),
    [term, permissions, roles],
  );
  const total = groups.reduce((n, g) => n + (results[g.key]?.length ?? 0), 0) + screens.length;

  return (
    <Screen scroll>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.card,
          borderRadius: radius.lg,
          paddingHorizontal: spacing.md,
          marginBottom: spacing.md,
        }}
      >
        <Ionicons name="search" size={18} color={c.muted} />
        <TextInput
          value={text}
          onChangeText={setText}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          placeholder="Name, asset tag, serial, request number…"
          placeholderTextColor={c.subtle}
          accessibilityLabel="Search everything"
          style={{ flex: 1, minHeight: 48, color: c.text, fontSize: 15 }}
        />
        {searching ? <ActivityIndicator size="small" color={c.brand} /> : null}
        {text ? (
          <Pressable onPress={() => setText('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={c.subtle} />
          </Pressable>
        ) : null}
      </View>

      {!term ? (
        <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19 }}>
          Type at least {SEARCH_MIN_LENGTH} characters. Finds{' '}
          {[...groups.map((g) => g.title.toLowerCase()), 'screens of the app'].join(', ')} you are allowed to
          see.
        </Text>
      ) : searching && total === 0 ? null : (
        <Text accessibilityRole="text" style={{ color: c.muted, fontSize: 13, marginBottom: spacing.md }}>
          {searchSummary(total, term)}
        </Text>
      )}

      {groups.map((group) => {
        const rows = results[group.key] ?? [];
        if (!term || rows.length === 0) return null;
        return (
          <View key={group.key} style={{ marginBottom: spacing.lg }}>
            <SectionTitle>{group.title}</SectionTitle>
            {rows.map((row) => (
              <Card
                key={row.id}
                onPress={() => router.push(GROUP_HREF[group.key](row.id) as never)}
                style={{ marginBottom: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
              >
                <Ionicons name={GROUP_ICON[group.key]} size={20} color={c.brand} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>
                    {row.title}
                  </Text>
                  {row.subtitle ? (
                    <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                      {row.subtitle}
                    </Text>
                  ) : null}
                  {row.badge ? (
                    <Text style={{ color: c.subtle, fontSize: 12, fontWeight: '600', marginTop: 3 }} numberOfLines={1}>
                      {row.badge}
                    </Text>
                  ) : null}
                </View>
                <Chevron />
              </Card>
            ))}
          </View>
        );
      })}

      {screens.length > 0 ? (
        <View style={{ marginBottom: spacing.lg }}>
          <SectionTitle>Screens</SectionTitle>
          {screens.map(({ item, group }) => (
            <Card
              key={item.href}
              onPress={() => router.push(item.href as never)}
              style={{ marginBottom: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
            >
              <Ionicons name={item.icon as IconName} size={20} color={c.brand} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>
                  {item.label}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {group.title} · {item.description}
                </Text>
              </View>
              <Chevron />
            </Card>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
