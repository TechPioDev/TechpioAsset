import { Ionicons } from '@expo/vector-icons';
import { Tabs, Redirect, usePathname } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ComponentProps } from 'react';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { NotificationBadge } from '../../src/components/notification-badge';
import { homePlan, tabOrder, type TabKey } from '../../src/lib/home-plan';
import { HeaderSearchButton } from '../../src/components/header-search-button';
import { rememberDestination } from '../../src/lib/pending-route';
import { useT } from '../../src/providers/language';
import type { StringKey } from '../../src/i18n/strings';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * U3 - the tab you are on is drawn filled, the others outlined.
 *
 * Every tab used the outline icon in both states, so the only difference
 * between "here" and "not here" was the colour of a 21px glyph. Shape is the
 * cue people actually read, and it is the one that survives being colour
 * blind or glancing at the phone in sunlight.
 */
const icon =
  (name: IconName) =>
  ({ color, size, focused }: { color: string; size: number; focused: boolean }) => (
    <Ionicons
      name={(focused ? name.replace(/-outline$/, '') : name) as IconName}
      color={color}
      size={size}
    />
  );

/** Every screen that can take one of the role's places on the bar. */
const ROLE_TABS: Record<
  TabKey,
  { title: string; label?: string; icon: IconName; key?: StringKey }
> = {
  assets: { title: 'Assets', icon: 'cube-outline', key: 'tab.assets' },
  requests: { title: 'Requests', icon: 'document-text-outline', key: 'tab.requests' },
  approvals: { title: 'Awaiting me', icon: 'checkmark-done-outline', key: 'tab.approvals' },
  catalogue: { title: 'Catalogue', icon: 'pricetags-outline' },
  scan: { title: 'Scan', icon: 'qr-code-outline', key: 'tab.scan' },
  inventory: {
    title: 'Inventory',
    label: 'Count',
    icon: 'clipboard-outline',
    key: 'tab.inventory',
  },
  capture: { title: 'Capture bill', label: 'Bills', icon: 'camera-outline' },
};

/**
 * Bottom tab navigation. Five core tabs stay on the bar; everything else lives
 * under "More" (hidden tab screens, reached from the More menu). Tabs are shown
 * by permission, mirroring the web sidebar; the API enforces each regardless.
 */
export default function TabsLayout() {
  const { status, user } = useSession();
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  if (status !== 'authenticated' || !user) {
    // v2.81 - a shortcut onto a tab (Scan, New request) lands there after the
    // unlock, not on Home. Only while starting up or locked: after a sign-out
    // the next person must not inherit where the last one was.
    if (status === 'loading' || status === 'locked') rememberDestination(pathname);
    return <Redirect href="/login" />;
  }

  const plan = homePlan(user.roles ?? [], user.permissions);
  const barTabs = tabOrder(plan);
  const hiddenTabs = (Object.keys(ROLE_TABS) as TabKey[]).filter((tab) => !barTabs.includes(tab));

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
        // 0.3.32 - search everything, from every tab. Home overrides this to
        // put the bell beside it.
        headerRight: () => <HeaderSearchButton />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tab.home'),
          tabBarIcon: icon('home-outline'),
          // The web's bell, on the phone: count of unread, opens the inbox.
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <HeaderSearchButton />
              <NotificationBadge />
            </View>
          ),
        }}
      />
      {/*
        0.3.30 - the three places between Home and Menu are chosen for the role
        (lib/home-plan.ts): a technician gets the scanner, a manager leads with
        what is awaiting them, a storekeeper gets the count, a supplier only its
        catalogue. The plan applies each screen's permission, as `gate` did
        here before - Requests for anybody who can read them, "Awaiting me" for
        approvers AND assessors (an Inventory check is cleared with
        REQUESTS_ASSESS alone) - so a tab the server would answer with 403 is
        never on the bar. They render in the plan's order: the bar follows the
        order of these children.
      */}
      {barTabs.map((tab) => (
        <Tabs.Screen
          key={tab}
          name={tab}
          options={{
            // v2.84 - the bar speaks the chosen language; a tab with no
            // translation yet keeps its English name rather than a blank.
            title: ROLE_TABS[tab].key ? t(ROLE_TABS[tab].key) : ROLE_TABS[tab].title,
            tabBarLabel: ROLE_TABS[tab].key
              ? t(ROLE_TABS[tab].key)
              : (ROLE_TABS[tab].label ?? ROLE_TABS[tab].title),
            tabBarIcon: icon(ROLE_TABS[tab].icon),
          }}
        />
      ))}
      <Tabs.Screen
        name="more"
        options={{ title: t('tab.menu'), tabBarIcon: icon('grid-outline') }}
      />

      {/* Off the bar for this account, and still reached from Menu. */}
      {hiddenTabs.map((tab) => (
        <Tabs.Screen key={tab} name={tab} options={{ title: ROLE_TABS[tab].title, href: null }} />
      ))}
      <Tabs.Screen name="profile" options={{ title: 'Profile', href: null }} />
    </Tabs>
  );
}
