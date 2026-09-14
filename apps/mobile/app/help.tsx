import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Card, Screen, SectionTitle } from '../src/components/ui';

/**
 * Help, for the phone.
 *
 * Not a copy of the user guide - the guide is a PDF and is linked once. What
 * someone wants from a help screen mid-task is "where is the thing I am looking
 * for", so this leads with destinations, and only the ones this account can
 * actually reach: the raise-a-request row asks the same /requests/can-create the
 * server enforces with, so nobody is invited to raise a request their company
 * has switched off for them.
 */

interface Row {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail: string;
  onPress: () => void;
}

function LinkRow({ icon, label, detail, onPress, last }: Row & { last: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.border,
      }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          backgroundColor: c.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={17} color={c.muted} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>{label}</Text>
        <Text style={{ color: c.subtle, fontSize: 12, marginTop: 2 }}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.subtle} />
    </Pressable>
  );
}

export default function HelpScreen() {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const router = useRouter();
  const [raise, setRaise] = useState<{ allowed: boolean; reason?: string } | null>(null);

  const loadPolicy = useCallback(async () => {
    try {
      setRaise(await api.request<{ allowed: boolean; reason?: string }>('/requests/can-create'));
    } catch {
      setRaise(null);
    }
  }, [api]);

  useEffect(() => void loadPolicy(), [loadPolicy]);

  const yours: Row[] = [
    {
      icon: 'cube-outline',
      label: 'My equipment',
      detail: 'What is issued to you, and what is waiting to be confirmed.',
      onPress: () => router.push('/my-equipment'),
    },
    {
      icon: 'document-text-outline',
      label: 'My requests',
      detail: 'What you asked for, and where each one has got to.',
      onPress: () => router.push('/(tabs)/requests'),
    },
    {
      icon: 'person-circle-outline',
      label: 'Profile and security',
      detail: 'Your details, notifications, signing out.',
      onPress: () => router.push('/(tabs)/profile'),
    },
  ];

  return (
    <Screen scroll>
      <SectionTitle>Your things</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        {yours.map((r, i) => (
          <LinkRow key={r.label} {...r} last={i === yours.length - 1} />
        ))}
      </Card>

      <SectionTitle>Asking for something</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        {raise?.allowed ? (
          <LinkRow
            icon="add-circle-outline"
            label="Raise a request"
            detail="Ask for equipment, software or a repair."
            onPress={() => router.push('/(tabs)/requests')}
            last
          />
        ) : (
          <Text style={{ color: c.muted, fontSize: 14, padding: 16, lineHeight: 20 }}>
            {raise?.reason ??
              'Requests are raised by IT and HR for this company. Contact them and they will raise one for you.'}
          </Text>
        )}
      </Card>

      <SectionTitle>Scanning</SectionTitle>
      <Card style={{ marginBottom: spacing.xl }}>
        <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>
          The Scan tab reads the QR label on a device and opens it straight away — quicker than
          searching for a serial number, and it works with the label already stuck to the machine.
        </Text>
      </Card>

      <SectionTitle>Guides</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        <LinkRow
          icon="book-outline"
          label="Guides"
          detail="Raising a request, roles, adding assets. Opens in your browser."
          onPress={() => void Linking.openURL('https://pioassets.com/guides')}
          last
        />
      </Card>

      <SectionTitle>Cannot find something?</SectionTitle>
      <Card>
        <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>
          Anything the app cannot answer — a device that is not listed, an account that needs
          changing, equipment you have handed back — is for your IT or HR team, who administer
          PioAssets for your company.
        </Text>
      </Card>
    </Screen>
  );
}
