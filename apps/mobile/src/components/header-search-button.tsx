import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import { searchGroups } from '@techpioasset/domain';
import { useSession } from '../providers/session';
import { useTheme } from '../theme';

/**
 * The magnifying glass in a tab's header (0.3.32): search everything from
 * wherever you are. Not drawn for an account with nothing to search - a
 * supplier - rather than opening a screen that could only ever come up empty.
 */
export function HeaderSearchButton() {
  const { user } = useSession();
  const router = useRouter();
  const { c } = useTheme();
  if (searchGroups(user?.permissions ?? []).length === 0) return null;
  return (
    <Pressable
      onPress={() => router.push('/search' as never)}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Search everything"
      style={{ paddingHorizontal: 12, paddingVertical: 8 }}
    >
      <Ionicons name="search" size={22} color={c.text} />
    </Pressable>
  );
}
