import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { WaitingReceipt } from '@techpioasset/domain';
import { useSession } from '../../providers/session';
import { useT } from '../../providers/language';
import { useTheme } from '../../theme';
import { Button, Card, IconBadge } from '../ui';
import { committed, refused } from '../../lib/haptics';

/** Rows shown before "and N more": the card is a prompt, not the list. */
const SHOWN = 3;

/**
 * "Confirm receipt" on Home (Phase 4, v2.80).
 *
 * A handover waits on exactly one person, and until now they found out from
 * an email or by opening the right asset. The card sits at the top of Home
 * whenever something is waiting and is gone once nothing is. Confirming is
 * the same call the asset page makes; the tag is on the row so the person
 * checks the thing in front of them before they tap.
 */
export function ReceiptCard({
  waiting,
  onConfirmed,
}: {
  waiting: WaitingReceipt[];
  onConfirmed: () => void;
}) {
  const { api } = useSession();
  const t = useT();
  const router = useRouter();
  const { c, spacing } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  if (waiting.length === 0) return null;

  async function confirm(row: WaitingReceipt) {
    setBusy(row.assignmentId);
    setFailed(null);
    try {
      await api.request(`/assets/assignments/${row.assignmentId}/acknowledge`, { method: 'POST' });
      committed();
      onConfirmed();
    } catch {
      refused();
      setFailed(t('receipt.failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card style={{ marginBottom: spacing.lg, borderColor: c.warning, borderWidth: 1 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          marginBottom: spacing.md,
        }}
      >
        <IconBadge icon="checkmark-circle-outline" tint={c.warning} />
        <View style={{ flex: 1 }}>
          <Text
            style={{ color: c.text, fontWeight: '800', fontSize: 15 }}
            accessibilityRole="header"
          >
            {t('receipt.title')}
          </Text>
          <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
            {waiting.length === 1
              ? t('receipt.oneItem')
              : t('receipt.manyItems', { count: waiting.length })}
          </Text>
        </View>
      </View>

      {waiting.slice(0, SHOWN).map((row) => (
        <View
          key={row.assignmentId}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            marginBottom: spacing.sm,
          }}
        >
          <Pressable
            style={{ flex: 1 }}
            onPress={() => router.push(`/asset/${row.assetId}`)}
            accessibilityRole="link"
          >
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>
              {row.name}
            </Text>
            <Text style={{ color: c.muted, fontSize: 12 }}>{row.assetTag}</Text>
          </Pressable>
          <Button
            label={t('receipt.confirm')}
            icon="checkmark"
            onPress={() => void confirm(row)}
            loading={busy === row.assignmentId}
            disabled={busy !== null}
          />
        </View>
      ))}

      {waiting.length > SHOWN ? (
        <Pressable onPress={() => router.push('/my-equipment')} hitSlop={8}>
          <Text style={{ color: c.brand, fontSize: 13, fontWeight: '700', marginTop: spacing.sm }}>
            {t('receipt.more', { count: waiting.length - SHOWN })}
          </Text>
        </Pressable>
      ) : null}

      {failed ? (
        <Text
          style={{ color: c.danger, fontSize: 13, marginTop: spacing.sm }}
          accessibilityRole="alert"
        >
          {failed}
        </Text>
      ) : null}
    </Card>
  );
}
