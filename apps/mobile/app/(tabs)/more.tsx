import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Avatar, Screen } from '../../src/components/ui';
import { CategoryCard, ResultRow, TileGrid } from '../../src/components/menu-tiles';
import { searchMenu, visibleMenu } from '../../src/lib/menu';

/**
 * The menu, as category cards (v2.58).
 *
 * Replaces one long list under four loose headings. Categories open onto a grid
 * of their own options; the search box finds any option directly, because
 * someone who knows what they want should not have to guess its category.
 * Both only ever show what this user's permissions allow.
 */
export default function MoreScreen() {
  const { user, logout } = useSession();
  const router = useRouter();
  const { c, spacing, radius } = useTheme();
  const [query, setQuery] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);

  const permissions = useMemo(() => user?.permissions ?? [], [user]);
  const roles = useMemo(() => user?.roles ?? [], [user]);
  const groups = useMemo(() => visibleMenu(permissions, roles), [permissions, roles]);
  const results = useMemo(
    () => searchMenu(query, permissions, roles),
    [query, permissions, roles],
  );

  if (!user) return null;
  const name = user.displayName ?? user.email;
  const searching = query.trim().length > 0;

  return (
    <Screen scroll>
      {/* Who is signed in. Tapping opens the account menu - profile,
          security, sign out - the way a user menu works on the web. */}
      <Pressable
        onPress={() => setAccountOpen((open) => !open)}
        accessibilityRole="button"
        accessibilityLabel="Account menu"
        accessibilityState={{ expanded: accountOpen }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.lg,
          borderRadius: radius.lg,
          borderBottomLeftRadius: accountOpen ? 0 : radius.lg,
          borderBottomRightRadius: accountOpen ? 0 : radius.lg,
          backgroundColor: c.brand,
          marginBottom: accountOpen ? 0 : spacing.lg,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Avatar name={name} size={48} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.brandText, fontSize: 17, fontWeight: '700' }} numberOfLines={1}>
            {name}
          </Text>
          <Text style={{ color: c.brandText, opacity: 0.85, fontSize: 13 }} numberOfLines={1}>
            {user.roleNames.join(', ') || user.email}
          </Text>
        </View>
        <Ionicons name={accountOpen ? 'chevron-up' : 'chevron-down'} size={20} color={c.brandText} />
      </Pressable>
      {accountOpen ? (
        <View
          style={{
            borderWidth: 1,
            borderTopWidth: 0,
            borderColor: c.border,
            borderBottomLeftRadius: radius.lg,
            borderBottomRightRadius: radius.lg,
            backgroundColor: c.card,
            marginBottom: spacing.lg,
            overflow: 'hidden',
          }}
        >
          {(
            [
              ['person-circle-outline', 'My profile', () => router.push('/(tabs)/profile')],
              ['shield-checkmark-outline', 'Security', () => router.push('/settings/security')],
            ] as const
          ).map(([icon, label, go]) => (
            <Pressable
              key={label}
              onPress={() => {
                setAccountOpen(false);
                go();
              }}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingHorizontal: spacing.lg,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: c.border,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name={icon} size={20} color={c.muted} />
              <Text style={{ flex: 1, color: c.text, fontSize: 15, fontWeight: '500' }}>{label}</Text>
              <Ionicons name="chevron-forward" size={18} color={c.subtle} />
            </Pressable>
          ))}
          <Pressable
            onPress={() => {
              setAccountOpen(false);
              void logout().then(() => router.replace('/login'));
            }}
            accessibilityRole="button"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingHorizontal: spacing.lg,
              paddingVertical: 14,
              backgroundColor: pressed ? c.dangerSoft : 'transparent',
            })}
          >
            <Ionicons name="log-out-outline" size={20} color={c.danger} />
            <Text style={{ flex: 1, color: c.danger, fontSize: 15, fontWeight: '700' }}>Sign out</Text>
          </Pressable>
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface,
          marginBottom: spacing.lg,
        }}
      >
        <Ionicons name="search-outline" size={18} color={c.subtle} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search the menu"
          placeholderTextColor={c.subtle}
          autoCorrect={false}
          accessibilityLabel="Search the menu"
          style={{ flex: 1, color: c.text, fontSize: 15, paddingVertical: 12 }}
        />
        {searching ? (
          <Pressable onPress={() => setQuery('')} accessibilityLabel="Clear search" hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={c.subtle} />
          </Pressable>
        ) : null}
      </View>

      {searching ? (
        results.length === 0 ? (
          <Text style={{ color: c.muted, textAlign: 'center', marginVertical: spacing.xl }}>
            Nothing in the menu matches “{query.trim()}”.
          </Text>
        ) : (
          results.map(({ item, group }) => (
            <ResultRow
              key={item.href}
              label={item.label}
              group={group.title}
              icon={item.icon}
              tone={group.tone}
              onPress={() => router.push(item.href as never)}
            />
          ))
        )
      ) : (
        <TileGrid>
          {groups.map((group) => (
            <CategoryCard
              key={group.id}
              title={group.title}
              description={group.description}
              icon={group.icon}
              tone={group.tone}
              count={group.items.length}
              onPress={() => router.push(`/menu/${group.id}` as never)}
            />
          ))}
        </TileGrid>
      )}


      {/* The build on this phone, to compare with the version shown beside the
          download link on the web login page. */}
      <Text style={{ color: c.subtle, fontSize: 12, textAlign: 'center', marginTop: spacing.xl }}>
        {installedVersionLabel()}
      </Text>
    </Screen>
  );
}

function installedVersionLabel(): string {
  const config = Constants.expoConfig;
  const code = config?.android?.versionCode;
  return `PioAssets ${config?.version ?? ''}${code ? ` (build ${code})` : ''}`.trim();
}

