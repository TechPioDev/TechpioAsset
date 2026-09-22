import { Stack, usePathname, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppearanceProvider } from '../src/providers/appearance';
import { SessionProvider, useSession } from '../src/providers/session';
import { gateRedirect } from '../src/lib/session-gate';
import { rememberDestination } from '../src/lib/pending-route';
import { NotificationTaps } from '../src/components/notification-taps';
import { WhatsNewGate } from '../src/components/whats-new-gate';
import { SyncRunner } from '../src/components/sync-banner';
import { useTheme } from '../src/theme';

/**
 * Root layout. Wraps the whole app in the safe-area + session providers, and
 * themes the native navigation headers to match the app's palette.
 */
export default function RootLayout() {
  // The provider has to sit above anything calling useTheme - including this
  // file - so the shell is a separate component inside it.
  return (
    <AppearanceProvider>
      <RootShell />
    </AppearanceProvider>
  );
}

function RootShell() {
  const { c } = useTheme();
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="auto" />
        <NotificationTaps />
        <SessionGate />
        <WhatsNewGate />
        <SyncRunner />
        <Stack
          screenOptions={{
            headerShown: false,
            headerStyle: { backgroundColor: c.headerBg },
            headerTintColor: c.text,
            headerTitleStyle: { fontWeight: '700' },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: c.background },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="forgot-password" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="asset/[id]" options={{ headerShown: true, title: 'Asset' }} />
          <Stack.Screen name="asset/new" options={{ headerShown: true, title: 'Register asset' }} />
          <Stack.Screen name="asset/edit" options={{ headerShown: true, title: 'Edit asset' }} />
          <Stack.Screen
            name="asset/receipt"
            options={{ headerShown: true, title: 'Handover receipt' }}
          />
          <Stack.Screen name="invoice/new" options={{ headerShown: true, title: 'Add invoice' }} />
          <Stack.Screen name="invoice/[id]" options={{ headerShown: true, title: 'Invoice' }} />
          <Stack.Screen
            name="notifications"
            options={{ headerShown: true, title: 'Notifications' }}
          />
          <Stack.Screen name="menu/[group]" options={{ headerShown: true, title: 'Menu' }} />
          <Stack.Screen
            name="people-invitations"
            options={{ headerShown: true, title: 'Pending invitations' }}
          />
          <Stack.Screen name="person/[id]" options={{ headerShown: true, title: 'Person' }} />
          <Stack.Screen
            name="person/offboard"
            options={{ headerShown: true, title: 'Offboarding' }}
          />
          <Stack.Screen
            name="my-equipment"
            options={{ headerShown: true, title: 'My equipment' }}
          />
          <Stack.Screen name="help" options={{ headerShown: true, title: 'Help' }} />
          <Stack.Screen name="request/[id]" options={{ headerShown: true, title: 'Request' }} />
          <Stack.Screen
            name="report-problem"
            options={{ headerShown: true, title: 'Report a problem' }}
          />
          <Stack.Screen name="sync" options={{ headerShown: true, title: 'Waiting to sync' }} />
          <Stack.Screen
            name="whats-new"
            options={{ headerShown: true, title: 'What’s new', presentation: 'modal' }}
          />
          <Stack.Screen name="scan" options={{ headerShown: true, title: 'Scan' }} />
          <Stack.Screen
            name="purchase-orders"
            options={{ headerShown: true, title: 'Receive orders' }}
          />
          <Stack.Screen
            name="purchase-order/[id]"
            options={{ headerShown: true, title: 'Purchase order' }}
          />
          <Stack.Screen name="stock" options={{ headerShown: true, title: 'Stock' }} />
          <Stack.Screen name="licenses" options={{ headerShown: true, title: 'Licenses' }} />
          <Stack.Screen name="license/[id]" options={{ headerShown: true, title: 'License' }} />
          <Stack.Screen name="my-licenses" options={{ headerShown: true, title: 'My licenses' }} />
          <Stack.Screen name="invoices" options={{ headerShown: true, title: 'Invoices' }} />
          <Stack.Screen name="maintenance" options={{ headerShown: true, title: 'Maintenance' }} />
          <Stack.Screen name="work-orders" options={{ headerShown: true, title: 'Work orders' }} />
          <Stack.Screen
            name="work-order/[id]"
            options={{ headerShown: true, title: 'Work order' }}
          />
          <Stack.Screen name="people" options={{ headerShown: true, title: 'People' }} />
          <Stack.Screen name="analytics" options={{ headerShown: true, title: 'Analytics' }} />
          <Stack.Screen name="reports" options={{ headerShown: true, title: 'Reports' }} />
          <Stack.Screen name="expenses" options={{ headerShown: true, title: 'Expenses' }} />
          <Stack.Screen name="audit" options={{ headerShown: true, title: 'Audit log' }} />
          <Stack.Screen name="search" options={{ headerShown: true, title: 'Search' }} />
          <Stack.Screen
            name="verification"
            options={{ headerShown: true, title: 'Verification round' }}
          />

          <Stack.Screen name="settings/index" options={{ headerShown: true, title: 'Settings' }} />
          <Stack.Screen
            name="settings/appearance"
            options={{ headerShown: true, title: 'Appearance' }}
          />
          <Stack.Screen
            name="settings/security"
            options={{ headerShown: true, title: 'Security' }}
          />
          <Stack.Screen
            name="settings/organisation"
            options={{ headerShown: true, title: 'Organisation' }}
          />
          <Stack.Screen name="settings/offices" options={{ headerShown: true, title: 'Offices' }} />
          <Stack.Screen
            name="settings/departments"
            options={{ headerShown: true, title: 'Departments' }}
          />
          <Stack.Screen name="settings/ai" options={{ headerShown: true, title: 'AI settings' }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

/**
 * Keeps every screen behind sign-in and the biometric unlock (v2.78). The
 * start screen always did this; a screen opened directly - a link into the
 * app, a notification, a reload of the web build - did not. Renders nothing.
 */
function SessionGate() {
  const { status } = useSession();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();
  // Navigating before the root navigator has mounted throws ("Attempted to
  // navigate before mounting the Root Layout") - seen on a cold load straight
  // onto a record. Wait until the navigator has a state to navigate within.
  const ready = Boolean(useRootNavigationState()?.key);
  const target = gateRedirect(status, segments);
  useEffect(() => {
    if (!ready || !target) return;
    // v2.81 - so a shortcut or link lands where it was going once unlocked.
    if (status === 'locked') rememberDestination(pathname);
    router.replace(target);
  }, [ready, target, router, pathname, status]);
  return null;
}
