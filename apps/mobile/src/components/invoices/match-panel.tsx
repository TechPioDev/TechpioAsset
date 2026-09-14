import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { ApiError } from '../../lib/api-client';
import { useSession } from '../../providers/session';
import { useTheme } from '../../theme';
import { Button, Card, Field } from '../ui';

interface MatchResult {
  outcome: 'MATCHED' | 'QTY_MISMATCH' | 'PRICE_MISMATCH' | 'NO_RECEIPT' | 'NO_PO';
  details: { receivedValue: number; invoiceTotal: number; delta: number; tolerance: number };
  overriddenAt: string | null;
  overrideReason: string | null;
}

const OUTCOME_LABEL: Record<MatchResult['outcome'], string> = {
  MATCHED: 'Matched',
  QTY_MISMATCH: 'Quantity mismatch',
  PRICE_MISMATCH: 'Price mismatch',
  NO_RECEIPT: 'Nothing received yet',
  NO_PO: 'No purchase order',
};

/**
 * The three-way-match verdict, on the phone (v2.56) - the web MatchPanel.
 *
 * Shown once a verdict exists, exactly as on the web: running a match on an
 * invoice that has none would store a verdict (often "No purchase order") that
 * then blocks verification, so the phone does not offer a first run the web
 * does not. Re-run needs invoices:verify; accepting a mismatch needs
 * procurement:match:override and a reason of at least ten characters.
 */
export function MatchPanel({
  invoiceId,
  canRun,
  canOverride,
  onChanged,
}: {
  invoiceId: string;
  canRun: boolean;
  canOverride: boolean;
  onChanged?: () => void;
}) {
  const { api } = useSession();
  const { c, scheme, spacing, radius } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [reason, setReason] = useState('');
  const [running, setRunning] = useState(false);
  const [overriding, setOverriding] = useState(false);

  const load = useCallback(async () => {
    try {
      setMatch((await api.request<MatchResult | null>(`/procurement/match/${invoiceId}`)) ?? null);
    } catch {
      setMatch(null);
    }
  }, [api, invoiceId]);

  useEffect(() => void load(), [load]);

  if (!match) return null;

  const ok = match.outcome === 'MATCHED';
  const overridden = !!match.overriddenAt;
  const d = match.details;

  async function run() {
    setRunning(true);
    try {
      await api.request(`/procurement/match/${invoiceId}/run`, { method: 'POST' });
      await load();
      onChanged?.();
    } catch (error) {
      Alert.alert('Could not run the match', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setRunning(false);
    }
  }

  function confirmOverride() {
    Alert.alert(
      'Accept this mismatch?',
      'The reason goes on the audit record, with your name.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Accept anyway', style: 'destructive', onPress: () => void override() },
      ],
    );
  }

  async function override() {
    setOverriding(true);
    try {
      await api.request(`/procurement/match/${invoiceId}/override`, {
        method: 'POST',
        body: { reason: reason.trim() },
      });
      setReason('');
      Alert.alert('Overridden', 'Mismatch overridden — on the audit record.');
      await load();
      onChanged?.();
    } catch (error) {
      Alert.alert('Could not override', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setOverriding(false);
    }
  }

  return (
    <Card style={{ marginBottom: spacing.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons
          name={ok ? 'checkmark-circle-outline' : 'warning-outline'}
          size={18}
          color={ok ? palette.success.fg : palette.critical.fg}
        />
        <Text style={{ color: c.text, fontWeight: '700', flex: 1 }}>
          Three-way match: {OUTCOME_LABEL[match.outcome]}
        </Text>
      </View>
      <Text style={{ color: c.subtle, fontSize: 12, marginTop: 4 }}>
        Invoice {d.invoiceTotal.toFixed(2)} vs received {d.receivedValue.toFixed(2)} · delta{' '}
        {d.delta.toFixed(2)} · tolerance {d.tolerance.toFixed(2)}
      </Text>

      {canRun ? (
        <Button
          label="Re-run match"
          icon="refresh-outline"
          variant="ghost"
          onPress={() => void run()}
          loading={running}
          style={{ marginTop: spacing.sm, alignSelf: 'flex-start', paddingHorizontal: 0 }}
        />
      ) : null}

      {overridden ? (
        <Text
          style={{
            marginTop: spacing.md,
            padding: 10,
            borderRadius: radius.md,
            backgroundColor: palette.warning.bg,
            color: palette.warning.fg,
            fontSize: 12,
          }}
        >
          Mismatch accepted with a reason: “{match.overrideReason}”. Recorded in the audit log.
        </Text>
      ) : !ok && canOverride ? (
        <View style={{ marginTop: spacing.md }}>
          <Field
            label="Override reason"
            placeholder="Why is this acceptable? (min 10 chars)"
            value={reason}
            onChangeText={setReason}
            multiline
          />
          <Button
            label="Accept mismatch anyway"
            variant="danger"
            onPress={confirmOverride}
            loading={overriding}
            disabled={reason.trim().length < 10}
          />
        </View>
      ) : null}
    </Card>
  );
}
