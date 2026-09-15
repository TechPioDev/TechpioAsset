import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { EmptyState, Screen } from '../../src/components/ui';
import { ItemTile, TileGrid, useTone } from '../../src/components/menu-tiles';
import { findMenuGroup, type MenuGroup } from '../../src/lib/menu';

/** One menu category's options, as a grid of cards (v2.58). */
export default function MenuGroupScreen() {
  const { group: id } = useLocalSearchParams<{ group: string }>();
  const { user } = useSession();
  const group = findMenuGroup(String(id), user?.permissions ?? [], user?.roles ?? []);

  if (!group) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Menu' }} />
        <EmptyState
          icon="grid-outline"
          title="Nothing here for you"
          message="This part of the menu has no options your account can open."
        />
      </Screen>
    );
  }
  return <GroupGrid group={group} />;
}

function GroupGrid({ group }: { group: MenuGroup }) {
  const router = useRouter();
  const { c, spacing } = useTheme();
  const { fg } = useTone(group.tone);

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: group.title }} />
      <View style={{ marginBottom: spacing.lg }}>
        <Text style={{ color: fg, fontSize: 12, fontWeight: '700', letterSpacing: 0.6 }}>
          {group.items.length} {group.items.length === 1 ? 'OPTION' : 'OPTIONS'}
        </Text>
        <Text style={{ color: c.muted, fontSize: 14, marginTop: 2 }}>{group.description}</Text>
      </View>
      <TileGrid>
        {group.items.map((item) => (
          <ItemTile
            key={item.href}
            label={item.label}
            description={item.description}
            icon={item.icon}
            tone={group.tone}
            onPress={() => router.push(item.href as never)}
          />
        ))}
      </TileGrid>
    </Screen>
  );
}
