import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { PERMISSIONS, type AssetStatus } from '@techpioasset/domain';
import { buildDispatchPayload, transferView } from '../../lib/asset-admin';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { ChipPicker } from '../chip-picker';
import { Button, Card, Field, SectionTitle } from '../ui';
import { AssetSheet, FormLabel } from './sheet';
import { toast } from '../toast';

/**
 * Office transfers on the phone (web: transfer-panel.tsx).
 *
 * Dispatch puts the asset IN_TRANSIT; it stays attributed to the origin office
 * until someone at the destination confirms arrival. Confirming arrival is the
 * phone's natural job - the person doing it is standing next to the box.
 */

export interface OpenTransfer {
  id: string;
  transferredAt: string;
  reason: string | null;
  fromOffice: { id: string; name: string } | null;
  toOffice: { id: string; name: string } | null;
}

const LANDINGS = [
  { id: 'AVAILABLE', name: 'Available' },
  { id: 'IN_STORAGE', name: 'In storage' },
];

export function TransferCard({
  assetId,
  assetName,
  status,
  officeId,
  holderId,
  openTransfer,
  onChanged,
}: {
  assetId: string;
  assetName: string;
  status: AssetStatus;
  officeId: string | null;
  holderId: string | null;
  openTransfer: OpenTransfer | null;
  onChanged: () => void;
}) {
  const { api, user } = useSession();
  const { c, spacing } = useTheme();

  const view = transferView({
    canTransfer: user?.permissions.includes(PERMISSIONS.ASSETS_TRANSFER) ?? false,
    status,
    holderId,
    hasOpenTransfer: Boolean(openTransfer),
  });

  const [open, setOpen] = useState(false);
  const [offices, setOffices] = useState<{ id: string; name: string }[] | null>(null);
  const [toOfficeId, setToOfficeId] = useState('');
  const [reason, setReason] = useState('');
  const [landing, setLanding] = useState('AVAILABLE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || view !== 'dispatch') return;
    setToOfficeId('');
    setReason('');
    setError(null);
    void (async () => {
      try {
        setOffices((await api.request<{ id: string; name: string }[]>('/offices')) ?? []);
      } catch {
        setOffices([]);
        setError('Could not load offices.');
      }
    })();
  }, [open, view, api]);

  if (view === 'none') return null;

  const fail = (e: unknown, fallback: string) =>
    setError(e instanceof Error && e.message ? e.message : fallback);

  async function dispatch() {
    if (!toOfficeId) {
      setError('Choose the destination office.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.request(`/assets/${assetId}/transfer`, {
        method: 'POST',
        body: buildDispatchPayload(toOfficeId, reason),
      });
      setOpen(false);
      onChanged();
      toast.say('Dispatched', 'Waiting for the destination to confirm arrival.');
    } catch (e) {
      fail(e, 'Could not dispatch this asset');
    } finally {
      setBusy(false);
    }
  }

  async function receive() {
    setBusy(true);
    setError(null);
    try {
      await api.request(`/assets/${assetId}/transfer/receive`, {
        method: 'POST',
        body: { resultingStatus: landing },
      });
      onChanged();
      toast.say('Arrival confirmed');
    } catch (e) {
      fail(e, 'Could not confirm arrival');
    } finally {
      setBusy(false);
    }
  }

  // On the road: the only sensible action is confirming it arrived.
  if (view === 'receive' && openTransfer) {
    return (
      <>
        <SectionTitle>In transit</SectionTitle>
        <Card style={{ marginBottom: spacing.xl }}>
          <Text style={{ color: c.text, fontSize: 14, lineHeight: 20 }}>
            {openTransfer.fromOffice?.name ?? 'Unknown office'} →{' '}
            <Text style={{ fontWeight: '700' }}>{openTransfer.toOffice?.name ?? 'Unknown office'}</Text>
          </Text>
          <Text style={{ color: c.muted, fontSize: 13, marginTop: 2, marginBottom: spacing.md }}>
            Dispatched {new Date(openTransfer.transferredAt).toLocaleDateString()}
            {openTransfer.reason ? ` — ${openTransfer.reason}` : ''}
          </Text>
          <FormLabel>Where it lands</FormLabel>
          <ChipPicker label="Where it lands" options={LANDINGS} value={landing} onChange={setLanding} />
          {error ? <Text style={{ color: c.danger, fontSize: 13, marginTop: spacing.md }}>{error}</Text> : null}
          <Button
            label="Confirm arrival"
            icon="checkmark-done-outline"
            onPress={receive}
            loading={busy}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      </>
    );
  }

  const destinations = (offices ?? []).filter((o) => o.id !== officeId);

  return (
    <>
      <Button
        label="Send to another office"
        icon="car-outline"
        variant="secondary"
        onPress={() => setOpen(true)}
        style={{ marginBottom: spacing.md }}
      />
      <AssetSheet
        visible={open}
        title="Office transfer"
        subtitle={assetName}
        onClose={() => (busy ? undefined : setOpen(false))}
      >
        <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19, marginBottom: spacing.lg }}>
          Send this asset to another office. It stays attributed here until the destination confirms
          arrival.
        </Text>
        <FormLabel>Destination office</FormLabel>
        {offices === null ? (
          <ActivityIndicator color={c.brand} style={{ marginVertical: spacing.lg }} />
        ) : destinations.length === 0 ? (
          <Text style={{ color: c.subtle, fontSize: 13 }}>No other office to send it to.</Text>
        ) : (
          <ChipPicker
            label="Destination office"
            options={destinations}
            value={toOfficeId}
            onChange={setToOfficeId}
          />
        )}
        <View style={{ height: spacing.lg }} />
        <Field
          label="Reason (optional)"
          value={reason}
          onChangeText={setReason}
          placeholder="New starter in the Mohali office…"
          maxLength={500}
        />
        {error ? <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>{error}</Text> : null}
        <Button label="Dispatch" icon="send-outline" onPress={dispatch} loading={busy} disabled={!toOfficeId} />
      </AssetSheet>
    </>
  );
}
