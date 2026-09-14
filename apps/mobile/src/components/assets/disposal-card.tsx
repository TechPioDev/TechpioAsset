import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { PERMISSIONS, type AssetStatus } from '@techpioasset/domain';
import {
  DISPOSABLE_FROM,
  DISPOSAL_METHODS,
  buildDisposalPayload,
  disposalMethodLabel,
  recipientLabel,
  todayIso,
  validateDisposal,
  type DisposalMethod,
} from '../../lib/asset-admin';
import { formatMoney } from '../../lib/format';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { ChipPicker } from '../chip-picker';
import { Button, Card, Field, SectionTitle } from '../ui';
import { AssetSheet, FormLabel } from './sheet';

/**
 * Disposal on the phone (web: disposal-panel.tsx - recorded, never a delete).
 *
 * Offered to holders of assets:dispose, and only when the state machine would
 * accept the move. Once disposed, the same place shows a read-only summary of
 * the record, so the asset answers "where did it go and why" by itself.
 */

export interface DisposalRecord {
  method: string;
  disposedAt: string;
  /** Present only for viewers with cost visibility - the API decides. */
  proceeds?: string | null;
  currency?: string | null;
  recipient: string | null;
  reason: string;
  approvedBy: { profile: { firstName: string; lastName: string } | null } | null;
}

export function DisposalCard({
  assetId,
  assetName,
  status,
  disposal,
  onChanged,
}: {
  assetId: string;
  assetName: string;
  status: AssetStatus;
  disposal: DisposalRecord | null;
  onChanged: () => void;
}) {
  const { api, user } = useSession();
  const { c, spacing } = useTheme();

  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<DisposalMethod>('SCRAPPED');
  const [disposedAt, setDisposedAt] = useState(todayIso);
  const [proceeds, setProceeds] = useState('');
  const [recipient, setRecipient] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMethod('SCRAPPED');
    setDisposedAt(todayIso());
    setProceeds('');
    setRecipient('');
    setReason('');
    setError(null);
  }, [open]);

  // The record, once it exists, renders for anyone who can see the asset.
  if (disposal) {
    const rows: [string, string][] = [
      ['Method', disposalMethodLabel(disposal.method)],
      ['Date', new Date(disposal.disposedAt).toLocaleDateString()],
      ...(disposal.recipient ? ([['Went to', disposal.recipient]] as [string, string][]) : []),
      ...(disposal.proceeds
        ? ([['Proceeds', formatMoney(disposal.proceeds, disposal.currency ?? 'INR')]] as [string, string][])
        : []),
      ...(disposal.approvedBy?.profile
        ? ([
            [
              'Recorded by',
              `${disposal.approvedBy.profile.firstName} ${disposal.approvedBy.profile.lastName}`,
            ],
          ] as [string, string][])
        : []),
    ];
    return (
      <>
        <SectionTitle>Disposed</SectionTitle>
        <Card style={{ marginBottom: spacing.xl }}>
          {rows.map(([label, value]) => (
            <View
              key={label}
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 }}
            >
              <Text style={{ color: c.muted, fontSize: 14 }}>{label}</Text>
              <Text style={{ color: c.text, fontSize: 14, fontWeight: '600', flexShrink: 1 }}>{value}</Text>
            </View>
          ))}
          <Text
            style={{
              color: c.muted,
              fontSize: 13,
              lineHeight: 19,
              marginTop: spacing.sm,
              paddingTop: spacing.sm,
              borderTopWidth: 1,
              borderTopColor: c.border,
            }}
          >
            {disposal.reason}
          </Text>
        </Card>
      </>
    );
  }

  if (!user?.permissions.includes(PERMISSIONS.ASSETS_DISPOSE)) return null;
  if (!DISPOSABLE_FROM.includes(status)) return null;

  const input = { method, disposedAt, proceeds, recipient, reason };

  function submit() {
    const problem = validateDisposal(input, todayIso());
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    Alert.alert(
      `Dispose of ${assetName}?`,
      'This is final: a disposed asset cannot come back into service. Its record and history remain visible.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Record disposal', style: 'destructive', onPress: () => void record() },
      ],
    );
  }

  async function record() {
    setBusy(true);
    try {
      await api.request(`/assets/${assetId}/dispose`, { method: 'POST', body: buildDisposalPayload(input) });
      setOpen(false);
      onChanged();
      Alert.alert('Disposal recorded');
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not record disposal');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        label="Record disposal"
        icon="archive-outline"
        variant="danger"
        onPress={() => setOpen(true)}
        style={{ marginTop: spacing.md }}
      />
      <AssetSheet
        visible={open}
        title="End of life"
        subtitle={assetName}
        onClose={() => (busy ? undefined : setOpen(false))}
      >
        <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19, marginBottom: spacing.lg }}>
          Record how this asset left the company. The asset and its history stay on file.
        </Text>
        <FormLabel>Method</FormLabel>
        <ChipPicker
          label="Method"
          options={DISPOSAL_METHODS as unknown as { id: DisposalMethod; name: string }[]}
          value={method}
          onChange={(id) => setMethod(id as DisposalMethod)}
        />
        <View style={{ height: spacing.lg }} />
        <Field
          label="Date (YYYY-MM-DD)"
          value={disposedAt}
          onChangeText={setDisposedAt}
          placeholder="2026-04-01"
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />
        <Field
          label={method === 'SOLD' ? 'Sale proceeds' : 'Proceeds (if any)'}
          value={proceeds}
          onChangeText={setProceeds}
          placeholder="0.00"
          keyboardType="decimal-pad"
        />
        <Field
          label={recipientLabel(method)}
          value={recipient}
          onChangeText={setRecipient}
          placeholder="Company, charity or person"
          maxLength={200}
        />
        <Field
          label="Reason"
          value={reason}
          onChangeText={setReason}
          placeholder="Beyond economical repair after screen failure…"
          multiline
          maxLength={2000}
        />
        {error ? <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>{error}</Text> : null}
        <Button label="Record disposal" icon="archive-outline" variant="danger" onPress={submit} loading={busy} />
      </AssetSheet>
    </>
  );
}
