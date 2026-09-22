import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { OfflineOperation } from '@techpioasset/domain';
import type { HeldOutcome } from '../src/lib/offline-queue';
import {
  isMine,
  refreshSyncStatus,
  sendNow,
  syncQueue,
  useSyncStatus,
} from '../src/lib/sync-service';
import { savedLabel } from '../src/lib/offline-cache';
import { useSession } from '../src/providers/session';
import { useTheme } from '../src/theme';
import { Button, Card, EmptyState, Screen, SectionTitle } from '../src/components/ui';

const KIND: Record<string, string> = {
  ASSET_ASSIGN: 'Handover',
  ASSET_REASSIGN: 'Handover',
  ASSET_RETURN: 'Return',
  STOCK_COUNT: 'Stock count',
  INVENTORY_SCAN: 'Stock-take scan',
};

/**
 * Changes recorded with no signal (Phase 6, v2.82): what is waiting to send,
 * and what came back as a conflict or a refusal.
 *
 * A conflict is never forced through from here. Somebody else changed the
 * asset (or the stock) after this was recorded, so the only choices are to
 * look at it as it is now and redo the change if it is still right, or to
 * discard it. Discarding asks twice: it is the one irreversible thing here.
 */
export default function SyncScreen() {
  const { api } = useSession();
  const router = useRouter();
  const { c, spacing } = useTheme();
  const { sending } = useSyncStatus();
  const [rows, setRows] = useState<{ op: OfflineOperation; held: HeldOutcome | null }[] | null>(
    null,
  );
  const [confirming, setConfirming] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows((await syncQueue.entries()).filter((e) => isMine(e.op)));
    await refreshSyncStatus();
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    setNote(null);
    try {
      const result = await sendNow(api);
      setNote(
        result === null
          ? 'Nothing waiting to send.'
          : result.pending > 0
            ? 'Still no connection. It will keep trying.'
            : `Sent. ${result.applied} applied${result.conflict + result.rejected > 0 ? `, ${result.conflict + result.rejected} need you` : ''}.`,
      );
    } catch {
      setNote('Still no connection. It will keep trying.');
    }
    await load();
  }

  async function discard(id: string) {
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    await syncQueue.discard(id);
    setConfirming(null);
    await load();
  }

  const waiting = rows?.filter((r) => !r.held) ?? [];
  const needsYou = rows?.filter((r) => r.held) ?? [];

  return (
    <Screen scroll>
      <Button
        label={sending ? 'Sending…' : 'Send now'}
        icon="cloud-upload-outline"
        onPress={() => void send()}
        loading={sending}
      />
      {note ? (
        <Text style={{ color: c.muted, fontSize: 13, marginTop: spacing.sm }}>{note}</Text>
      ) : null}

      {rows && rows.length === 0 ? (
        <Card style={{ marginTop: spacing.lg }}>
          <EmptyState
            icon="checkmark-done-outline"
            title="All sent"
            message="Nothing recorded offline is waiting."
          />
        </Card>
      ) : null}

      {needsYou.length > 0 ? (
        <>
          <SectionTitle style={{ marginTop: spacing.xl }}>Needs you</SectionTitle>
          {needsYou.map(({ op, held }) => (
            <Card
              key={op.clientGeneratedId}
              style={{ marginBottom: spacing.md, borderColor: c.danger, borderWidth: 1 }}
            >
              <Row op={op} />
              <Text style={{ color: c.danger, fontSize: 13, marginTop: spacing.sm }}>
                {held!.outcome === 'CONFLICT' ? 'Not applied: ' : 'Refused: '}
                {held!.message ?? 'The server could not apply this.'}
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                {op.entityId ? (
                  <Button
                    label="Open asset"
                    variant="secondary"
                    onPress={() => router.push(`/asset/${op.entityId}`)}
                    style={{ flex: 1 }}
                  />
                ) : null}
                <Button
                  label={confirming === op.clientGeneratedId ? 'Tap again to discard' : 'Discard'}
                  variant="danger"
                  onPress={() => void discard(op.clientGeneratedId)}
                  style={{ flex: 1 }}
                />
              </View>
            </Card>
          ))}
        </>
      ) : null}

      {waiting.length > 0 ? (
        <>
          <SectionTitle style={{ marginTop: spacing.xl }}>Waiting to send</SectionTitle>
          {waiting.map(({ op }) => (
            <Card key={op.clientGeneratedId} style={{ marginBottom: spacing.md }}>
              <Row op={op} />
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function Row({ op }: { op: OfflineOperation }) {
  const { c } = useTheme();
  const payload = (op.payload ?? {}) as { label?: string };
  return (
    <View>
      <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }}>
        {payload.label ?? KIND[op.type] ?? op.type}
      </Text>
      <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
        {KIND[op.type] ?? op.type} · recorded {savedLabel(op.capturedAt)}
      </Text>
    </View>
  );
}
