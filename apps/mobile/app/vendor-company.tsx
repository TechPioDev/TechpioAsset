import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Button, Card, Field, Screen, SectionTitle } from '../src/components/ui';

/**
 * A supplier's own company details (v2.46).
 *
 * The web has had this since v2.45 and the phone had nothing, so a supplier out
 * on the road - which is where a supplier usually is - could not correct the
 * number a buyer would ring.
 *
 * The buying company owns the supplier's identity: its name, its code, whether
 * it is still active. None of that is editable here, and the server refuses it
 * outright rather than quietly dropping it. What a supplier knows better than
 * the buyer is how to reach it, so that is what this screen edits.
 */

interface OwnVendor {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  taxId: string | null;
  addressLine1: string | null;
  city: string | null;
  country: string | null;
  isActive: boolean;
}

type Draft = Pick<
  OwnVendor,
  | 'contactName'
  | 'contactEmail'
  | 'contactPhone'
  | 'website'
  | 'taxId'
  | 'addressLine1'
  | 'city'
  | 'country'
>;

const EMPTY: Draft = {
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  website: '',
  taxId: '',
  addressLine1: '',
  city: '',
  country: '',
};

const FIELDS: { key: keyof Draft; label: string; keyboard?: 'email-address' | 'phone-pad' }[] = [
  { key: 'contactName', label: 'Who to contact' },
  { key: 'contactEmail', label: 'Email', keyboard: 'email-address' },
  { key: 'contactPhone', label: 'Phone', keyboard: 'phone-pad' },
  { key: 'website', label: 'Website' },
  { key: 'taxId', label: 'GST number' },
  { key: 'addressLine1', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'country', label: 'Country' },
];

export default function VendorCompanyScreen() {
  const { api } = useSession();
  const { c, spacing } = useTheme();

  const [vendor, setVendor] = useState<OwnVendor | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.request<OwnVendor>('/vendors/me');
      setVendor(data);
      setDraft({
        contactName: data.contactName ?? '',
        contactEmail: data.contactEmail ?? '',
        contactPhone: data.contactPhone ?? '',
        website: data.website ?? '',
        taxId: data.taxId ?? '',
        addressLine1: data.addressLine1 ?? '',
        city: data.city ?? '',
        country: data.country ?? '',
      });
    } catch (e) {
      // The server says something useful when an account is not linked to a
      // supplier yet, which is a real state somebody hits on their first login.
      setError(
        e instanceof Error && e.message ? e.message : 'Could not load your company details.',
      );
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => void load(), [load]);

  const set = (key: keyof Draft, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.request('/vendors/me', { method: 'PATCH', body: draft });
      setSaved(true);
      await load();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <SectionTitle>Your company</SectionTitle>
      {vendor ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={{ color: c.text, fontSize: 16, fontWeight: '800' }}>{vendor.name}</Text>
          <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
            Supplier code {vendor.code}
          </Text>
          <Text style={{ color: c.subtle, fontSize: 12, marginTop: spacing.md, lineHeight: 18 }}>
            Your name and code are set by the buyer, so they cannot be changed here. Ask them if
            either is wrong.
          </Text>
        </Card>
      ) : null}

      <SectionTitle>How to reach you</SectionTitle>
      <View>
        {FIELDS.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            value={draft[f.key] ?? ''}
            onChangeText={(v: string) => set(f.key, v)}
            autoCapitalize={f.keyboard === 'email-address' ? 'none' : 'sentences'}
            {...(f.keyboard ? { keyboardType: f.keyboard } : {})}
          />
        ))}
      </View>

      {error ? (
        <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>{error}</Text>
      ) : null}
      {saved ? (
        <Text style={{ color: c.brand, fontSize: 13, marginBottom: spacing.md }}>Saved.</Text>
      ) : null}

      <Button label="Save changes" onPress={save} loading={busy} disabled={loading} />
    </Screen>
  );
}
