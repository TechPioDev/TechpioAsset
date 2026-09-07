import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { PERMISSIONS } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Card, Screen, SectionTitle } from '../../src/components/ui';
import type { IconName } from '../../src/components/ui';

interface Item {
  icon: IconName;
  label: string;
  href: Href;
  perm?: string;
}

const GROUPS: { title: string; items: Item[] }[] = [
  {
    // First, and permission-free: an employee holds none of the permissions
    // below, so before this the menu opened onto little but Profile.
    title: 'Yours',
    items: [
      { icon: 'cube-outline', label: 'My equipment', href: '/my-equipment' },
      { icon: 'ribbon-outline', label: 'My licenses', href: '/my-licenses' },
      { icon: 'help-circle-outline', label: 'Help', href: '/help' },
    ],
  },
  {
    title: 'Capture',
    items: [
      { icon: 'scan-outline', label: 'Scan a code', href: '/(tabs)/scan', perm: PERMISSIONS.ASSETS_READ },
      { icon: 'receipt-outline', label: 'Capture bill', href: '/(tabs)/capture', perm: PERMISSIONS.INVOICES_UPLOAD },
      { icon: 'clipboard-outline', label: 'Inventory count', href: '/(tabs)/inventory', perm: PERMISSIONS.INVENTORY_ADJUST },
    ],
  },
  {
    title: 'Records',
    items: [
      { icon: 'cube-outline', label: 'Receive orders', href: '/purchase-orders', perm: PERMISSIONS.PROCUREMENT_RECEIVE },
      {
        icon: 'pricetags-outline',
        label: 'Catalogue',
        href: '/catalogue',
        // Suppliers hold this too - it is the one screen a vendor account needs.
        perm: PERMISSIONS.VENDOR_PRODUCTS_READ,
      },
      { icon: 'layers-outline', label: 'Stock', href: '/stock', perm: PERMISSIONS.INVENTORY_READ },
      { icon: 'key-outline', label: 'Licenses', href: '/licenses', perm: PERMISSIONS.LICENSES_READ },
      { icon: 'document-attach-outline', label: 'Invoices', href: '/invoices', perm: PERMISSIONS.INVOICES_READ },
      { icon: 'build-outline', label: 'My work orders', href: '/work-orders', perm: PERMISSIONS.MAINTENANCE_MANAGE },
      { icon: 'construct-outline', label: 'Maintenance', href: '/maintenance', perm: PERMISSIONS.MAINTENANCE_READ },
      { icon: 'people-outline', label: 'People', href: '/people', perm: PERMISSIONS.USERS_READ },
      { icon: 'stats-chart-outline', label: 'Analytics', href: '/analytics', perm: PERMISSIONS.ANALYTICS_READ },
      { icon: 'bar-chart-outline', label: 'Reports', href: '/reports', perm: PERMISSIONS.REPORTS_READ },
      { icon: 'time-outline', label: 'Audit log', href: '/audit', perm: PERMISSIONS.AUDIT_READ },
    ],
  },
  {
    title: 'Account',
    items: [
      // The hub itself is permission-free: Appearance and Security are on it for
      // everyone, and the company rows inside are gated individually.
      { icon: 'settings-outline', label: 'Settings', href: '/settings' },
      { icon: 'person-circle-outline', label: 'Profile', href: '/(tabs)/profile' },
    ],
  },
];

export default function MoreScreen() {
  const { user, logout } = useSession();
  const router = useRouter();
  const { c, spacing } = useTheme();

  const can = (perm?: string) => !perm || !!user?.permissions.includes(perm);

  return (
    <Screen scroll>
      {GROUPS.map((group) => {
        const items = group.items.filter((i) => can(i.perm));
        if (items.length === 0) return null;
        return (
          <View key={group.title} style={{ marginBottom: spacing.xl }}>
            <SectionTitle>{group.title}</SectionTitle>
            <Card style={{ padding: 0 }}>
              {items.map((item, i) => (
                <Row
                  key={item.label}
                  icon={item.icon}
                  label={item.label}
                  last={i === items.length - 1}
                  onPress={() => router.push(item.href)}
                />
              ))}
            </Card>
          </View>
        );
      })}

      <Card
        style={{ borderColor: c.danger, alignItems: 'center' }}
        onPress={() => {
          void logout().then(() => router.replace('/login'));
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="log-out-outline" size={18} color={c.danger} />
          <Text style={{ color: c.danger, fontWeight: '700', fontSize: 15 }}>Sign out</Text>
        </View>
      </Card>
    </Screen>
  );
}

function Row({
  icon,
  label,
  onPress,
  last,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  last: boolean;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 15,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          backgroundColor: c.brandSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={18} color={c.brand} />
      </View>
      <Text style={{ color: c.text, fontSize: 15, fontWeight: '500', flex: 1 }}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={c.subtle} />
    </Pressable>
  );
}
