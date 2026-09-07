import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { PERMISSIONS, qualityOutcome, type RejectDisposition } from '@techpioasset/domain';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT, type Tone } from '@techpioasset/ui-tokens';
import { ApiError } from '../../src/lib/api-client';
import { buildQualityCheck, qualityDraftProblem, type QualityDraft } from '../../src/lib/quality';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Button, Card, Field, Screen, SectionTitle, StatusPill } from '../../src/components/ui';

/**
 * Quality check, at the place the goods are standing (v2.42).
 *
 * This is the step that turns a received asset into an available one. It
 * belongs on a phone more than anywhere else: the person who can tell whether
 * the screen is cracked is holding the laptop, not sitting at a desk, and the
 * unit they are rejecting is the one in their hands.
 *
 * The arithmetic is checked with the same domain function the server uses, so
 * the message about numbers that do not add up appears before the request
 * rather than after it.
 */

interface ReceiptAsset {
  id: string;
  assetTag: string;
  serialNumber: string | null;
  status: string;
}

interface ReceiptLine {
  id: string;
  quantity: string;
  intake: 'STOCK' | 'ASSET';
  purchaseOrderLine: { lineNumber: number; description: string };
  inventoryItem: { id: string; name: string } | null;
  assets: ReceiptAsset[];
  qualityCheck: {
    id: string;
    outcome: 'PASSED' | 'PARTIAL' | 'FAILED';
    quantityAccepted: string;
    quantityRejected: string;
    rejectionReason: string | null;
    disposition: RejectDisposition | null;
    inspectedAt: string;
  } | null;
}

interface Receipt {
  id: string;
  grnNumber: string;
  receivedAt: string;
  purchaseOrder: { id: string; poNumber: string; vendor: { name: string } | null };
  lines: ReceiptLine[];
}

const OUTCOME_TONE: Record<'PASSED' | 'PARTIAL' | 'FAILED', Tone> = {
  PASSED: 'success',
  PARTIAL: 'warning',
  FAILED: 'critical',
};
const OUTCOME_LABEL: Record<'PASSED' | 'PARTIAL' | 'FAILED', string> = {
  PASSED: 'Passed',
  PARTIAL: 'Partly passed',
  FAILED: 'Failed',
};

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useSession();
  const { c, scheme, spacing, radius } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Per-line inspection being filled in. */
  const [rejected, setRejected] = useState('0');
  const [reason, setReason] = useState('');
  const [disposition, setDisposition] = useState<RejectDisposition>('RETURN_TO_VENDOR');
  const [rejectedAssetIds, setRejectedAssetIds] = useState<string[]>([]);

  const canInspect = !!user?.permissions.includes(PERMISSIONS.PROCUREMENT_RECEIVE);

  const load = useCallback(async () => {
    setReceipt(await api.request<Receipt>(`/procurement/receipts/${id}`));
  }, [api, id]);
  useEffect(() => void load(), [load]);

  const startInspecting = (line: ReceiptLine) => {
    setOpenLine(line.id);
    setRejected('0');
    setReason('');
    setDisposition('RETURN_TO_VENDOR');
    setRejectedAssetIds([]);
  };

  const toggleUnit = (assetId: string) =>
    setRejectedAssetIds((ids) => {
      const next = ids.includes(assetId) ? ids.filter((i) => i !== assetId) : [...ids, assetId];
      // The count follows the units picked: on an asset line the inspector is
      // naming the things in their hands, so typing a number as well would be
      // two ways to say the same thing and one of them would be wrong.
      setRejected(String(next.length));
      return next;
    });

  if (!receipt) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }

  const draftFor = (line: ReceiptLine): QualityDraft => ({
    received: Number(line.quantity),
    rejected: Number(rejected) || 0,
    reason,
    disposition,
    rejectedAssetIds,
    intake: line.intake,
  });

  const submit = async (line: ReceiptLine) => {
    const draft = draftFor(line);
    const problem = qualityDraftProblem(draft);
    if (problem) {
      Alert.alert('Check the numbers', problem);
      return;
    }
    const payload = buildQualityCheck(draft);

    setBusy(true);
    try {
      await api.request(`/procurement/receipt-lines/${line.id}/quality-check`, {
        method: 'POST',
        body: payload,
      });
      setOpenLine(null);
      await load();
      Alert.alert(
        'Inspection recorded',
        line.intake === 'ASSET' && payload.quantityAccepted > 0
          ? `${payload.quantityAccepted} unit(s) are now available to assign.`
          : 'Recorded.',
      );
    } catch (error) {
      Alert.alert(
        'Could not record the inspection',
        error instanceof ApiError ? error.message : 'Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '800' }}>{receipt.grnNumber}</Text>
      <Text style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>
        {[
          receipt.purchaseOrder.poNumber,
          receipt.purchaseOrder.vendor?.name,
          new Date(receipt.receivedAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }),
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>

      <SectionTitle>What arrived</SectionTitle>

      {receipt.lines.map((line) => {
        const done = line.qualityCheck;
        const received = Number(line.quantity);
        const rejectedCount = Number(rejected) || 0;
        const preview = qualityOutcome(received - rejectedCount, rejectedCount);
        const isOpen = openLine === line.id;

        return (
          <Card key={line.id} style={{ marginBottom: spacing.md }}>
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }}>
              {line.purchaseOrderLine.description}
            </Text>
            <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
              {received} received · {line.intake === 'ASSET' ? 'as assets' : 'into stock'}
              {line.inventoryItem ? ` · ${line.inventoryItem.name}` : ''}
            </Text>

            {done ? (
              <View style={{ marginTop: spacing.md }}>
                <View style={{ flexDirection: 'row' }}>
                  <StatusPill
                    label={OUTCOME_LABEL[done.outcome]}
                    bg={palette[OUTCOME_TONE[done.outcome]].bg}
                    fg={palette[OUTCOME_TONE[done.outcome]].fg}
                  />
                </View>
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 6 }}>
                  {Number(done.quantityAccepted)} accepted, {Number(done.quantityRejected)} rejected
                  {done.rejectionReason ? ` — ${done.rejectionReason}` : ''}
                </Text>
                <Text style={{ color: c.subtle, fontSize: 11, marginTop: 2 }}>
                  Inspected {new Date(done.inspectedAt).toLocaleDateString()}
                </Text>
              </View>
            ) : !canInspect ? null : isOpen ? (
              <View style={{ marginTop: spacing.md }}>
                {line.intake === 'ASSET' && line.assets.length > 0 ? (
                  <>
                    <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
                      Tap any unit that failed
                    </Text>
                    {line.assets.map((asset) => {
                      const picked = rejectedAssetIds.includes(asset.id);
                      return (
                        <Pressable
                          key={asset.id}
                          onPress={() => toggleUnit(asset.id)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: picked }}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 10,
                            paddingVertical: 10,
                            paddingHorizontal: 12,
                            borderWidth: 1,
                            borderColor: picked ? c.danger : c.border,
                            backgroundColor: picked ? palette.critical.bg : 'transparent',
                            borderRadius: radius.md,
                            marginBottom: 6,
                          }}
                        >
                          <View
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: 4,
                              borderWidth: 1,
                              borderColor: picked ? c.danger : c.border,
                              backgroundColor: picked ? c.danger : 'transparent',
                            }}
                          />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ color: c.text, fontSize: 13, fontWeight: '600' }}>
                              {asset.assetTag}
                            </Text>
                            {asset.serialNumber ? (
                              <Text style={{ color: c.subtle, fontSize: 11 }}>{asset.serialNumber}</Text>
                            ) : null}
                          </View>
                        </Pressable>
                      );
                    })}
                  </>
                ) : (
                  <Field
                    label="How many failed"
                    value={rejected}
                    onChangeText={setRejected}
                    keyboardType="number-pad"
                  />
                )}

                {rejectedCount > 0 ? (
                  <>
                    <Field
                      label="Why"
                      value={reason}
                      onChangeText={setReason}
                      placeholder="Screen cracked in transit"
                      multiline
                    />
                    <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
                      What happens to them
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.md }}>
                      {(
                        [
                          ['RETURN_TO_VENDOR', 'Back to supplier'],
                          ['HOLD_DAMAGED', 'Keep as damaged'],
                        ] as [RejectDisposition, string][]
                      ).map(([value, label]) => (
                        <Pressable
                          key={value}
                          onPress={() => setDisposition(value)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: disposition === value }}
                          style={{
                            flex: 1,
                            paddingVertical: 10,
                            borderRadius: radius.md,
                            borderWidth: 1,
                            borderColor: disposition === value ? c.brand : c.border,
                            backgroundColor: disposition === value ? c.brand : 'transparent',
                            alignItems: 'center',
                          }}
                        >
                          <Text
                            style={{
                              color: disposition === value ? c.brandText : c.text,
                              fontSize: 13,
                              fontWeight: '600',
                            }}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : null}

                <Text style={{ color: c.muted, fontSize: 12, marginBottom: spacing.md }}>
                  {received - rejectedCount} accepted, {rejectedCount} rejected —{' '}
                  {OUTCOME_LABEL[preview].toLowerCase()}
                </Text>

                <Button
                  label="Record inspection"
                  icon="checkmark-done-outline"
                  loading={busy}
                  onPress={() => void submit(line)}
                />
                <Button
                  label="Cancel"
                  variant="ghost"
                  onPress={() => setOpenLine(null)}
                  style={{ marginTop: 6 }}
                />
              </View>
            ) : (
              <Button
                label="Inspect this line"
                variant="secondary"
                icon="search-outline"
                onPress={() => startInspecting(line)}
                style={{ marginTop: spacing.md }}
              />
            )}
          </Card>
        );
      })}
    </Screen>
  );
}
