import { Ionicons } from '@expo/vector-icons';
import { Tabs, Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ComponentProps } from 'react';
import { PERMISSIONS } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
const icon =
  (name: IconName) =>
  ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} color={color} size={size} />
  );

/**
 * Bottom tab navigation. Five core tabs stay on the bar; everything else lives
 * under "More" (hidden tab screens, reached from the More menu). Tabs are shown
 * by permission, mirroring the web sidebar; the API enforces each regardless.
 */
export default function TabsLayout() {
  const { status, user } = useSession();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();

  if (status !== 'authenticated' || !user) return <Redirect href="/login" />;

  const can = (permission: string) => user.permissions.includes(permission);
  /** Visible when the user holds ANY of the listed permissions. */
  const gate = (...permissions: string[]) => (permissions.some(can) ? undefined : null);

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: c.headerBg },
        headerTintColor: c.text,
        headerTitleStyle: { fontWeight: '700', fontSize: 18 },
        headerShadowVisible: false,
        // The bar was a flat 60 with no inset. Measured: that left the tab item
        // 35px, the icon took 28, and the label was squeezed into 5px with
        // overflow:hidden - so every label was sliced in half. It also ignored
        // the home indicator entirely. 72 leaves room for a 28px icon, its 2px
        // gap and a 14px label, and the inset keeps all of it clear of the
        // indicator on phones that have one.
        tabBarStyle: {
          backgroundColor: c.tabBar,
          borderTopColor: c.border,
          height: 72 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
        },
        tabBarItemStyle: { paddingVertical: 0 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginTop: 2 },
        tabBarActiveTintColor: c.tabActive,
        tabBarInactiveTintColor: c.tabInactive,
        sceneStyle: { backgroundColor: c.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen
        name="assets"
        options={{
          title: 'Assets',
          tabBarIcon: icon('cube-outline'),
          href: gate(PERMISSIONS.ASSETS_READ),
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Requests',
          tabBarIcon: icon('document-text-outline'),
          // The one tab that was never gated. A supplier holds no request
          // permission at all, so it opened a screen the server answers with
          // 403 - a dead tab on the bar of every account that cannot raise or
          // read one.
          href: gate(PERMISSIONS.REQUESTS_READ),
        }}
      />
      {/*
        Named and gated for the queue, not for approving (v2.27).

        An assessment stage - an Inventory check - is cleared by recording an
        answer, which needs REQUESTS_ASSESS alone. Gating the tab on approval
        hid it from exactly the people those stages are assigned to, so the work
        sat in a queue they had no way to open. The screen behind it already
        asks for `awaitingMe=true`, which resolves assessment stages too.
      */}
      <Tabs.Screen
        name="approvals"
        options={{
          title: 'Awaiting me',
          tabBarIcon: icon('checkmark-done-outline'),
          href: gate(PERMISSIONS.REQUESTS_APPROVE, PERMISSIONS.REQUESTS_ASSESS),
        }}
      />
      <Tabs.Screen
        name="catalogue"
        options={{
          title: 'Catalogue',
          tabBarIcon: icon('pricetags-outline'),
          // A supplier's whole reason for an account; buried in More it was two
          // taps from everything it does.
          href: gate(PERMISSIONS.VENDOR_PRODUCTS_READ),
        }}
      />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('grid-outline') }} />

      {/* Reached from the More menu — hidden from the bar. */}
      <Tabs.Screen name="capture" options={{ title: 'Capture bill', href: null }} />
      <Tabs.Screen name="scan" options={{ title: 'Scan', href: null }} />
      <Tabs.Screen name="inventory" options={{ title: 'Inventory', href: null }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', href: null }} />
    </Tabs>
  );
}
