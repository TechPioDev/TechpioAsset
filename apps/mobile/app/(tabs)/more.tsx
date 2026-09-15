import { Ionicons } from '@expo/vector-icons';
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

  const permissions = useMemo(() => user?.permissions ?? [], [user]);
  const groups = useMemo(() => visibleMenu(permissions), [permissions]);
  const results = useMemo(() => searchMenu(query, permissions), [query, permissions]);

  if (!user) return null;
  const name = user.displayName ?? user.email;
  const searching = query.trim().length > 0;

  return (
    <Screen scroll>
      {/* Who is signed in, and a way to their profile. */}
      <Pressable
        onPress={() => router.push('/(tabs)/profile')}
        accessibilityRole="button"
        accessibilityLabel="Open your profile"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.lg,
          borderRadius: radius.lg,
          backgroundColor: c.brand,
          marginBottom: spacing.lg,
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
        <Ionicons name="chevron-forward" size={20} color={c.brandText} />
      </Pressable>

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

      <Pressable
        onPress={() => {
          void logout().then(() => router.replace('/login'));
        }}
        accessibilityRole="button"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          marginTop: spacing.xl,
          padding: spacing.lg,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: c.danger,
          backgroundColor: c.dangerSoft,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Ionicons name="log-out-outline" size={18} color={c.danger} />
        <Text style={{ color: c.danger, fontWeight: '700', fontSize: 15 }}>Sign out</Text>
      </Pressable>
    </Screen>
  );
}
