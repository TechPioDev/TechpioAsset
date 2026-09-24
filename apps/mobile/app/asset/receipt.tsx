import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Share, Text, View } from 'react-native';
import * as Print from 'expo-print';
import { assetReceipt, type ReceiptAssetInput, type ReceiptRow } from '@techpioasset/domain';
import { Button, Card, DetailSkeleton, EmptyState, Screen, SectionTitle } from '../../src/components/ui';
import { InfoRow } from '../../src/components/assets/detail-parts';
import { ApiError } from '../../src/lib/api-client';
import { receiptHtml, receiptText } from '../../src/lib/receipt-document';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';

/**
 * Printable handover receipt on the phone (web: assets/[id]/receipt, v2.15).
 *
 * The paper trail for a device changing hands, and the phone is where the
 * handover happens: both people and the device are in the room. The words are
 * `assetReceipt` from the domain package - the model the web page renders - so
 * the phone's receipt and the web's are one document. Shown natively, printed
 * through the system dialog (which on Android is also "Save as PDF"), and
 * shareable as plain text when there is no printer or PDF viewer at hand.
 *
 * Reached from the asset screen whenever the device has a holder; the API's
 * scope rules mean an employee can only ever open their own.
 */

/** The phone's date style, as on the asset screen: "14 Sept 2026". */
function fmtDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AssetReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const { c, spacing } = useTheme();

  const [asset, setAsset] = useState<ReceiptAssetInput | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    try {
      setAsset(await api.request<ReceiptAssetInput>(`/assets/${id}`));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Check your connection and try again.');
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const receipt = useMemo(() => (asset ? assetReceipt(asset, fmtDate) : null), [asset]);

  async function print() {
    if (!receipt) return;
    setPrinting(true);
    try {
      await Print.printAsync({ html: receiptHtml(receipt) });
    } catch {
      // Cancelling the dialog rejects too (iOS: "Printing did not complete"),
      // and a cancel is not an error worth a message.
    } finally {
      setPrinting(false);
    }
  }

  function share() {
    if (!receipt) return;
    void Share.share({ title: receipt.title, message: receiptText(receipt) }).catch(() => undefined);
  }

  if (loadError) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title="Could not load this asset" message={loadError} />
      </Screen>
    );
  }

  if (!receipt) {
    return (
      <DetailSkeleton />
    );
  }

  const rows = (list: ReceiptRow[]) => (
    <Card style={{ padding: 0, marginBottom: spacing.xl }}>
      {list.map((r, i) => (
        <InfoRow key={r.label} label={r.label} value={r.value} last={i === list.length - 1} />
      ))}
    </Card>
  );

  return (
    <Screen scroll>
      <Card style={{ marginBottom: spacing.lg }}>
        <Text style={{ color: c.text, fontSize: 18, fontWeight: '800' }}>{receipt.title}</Text>
        <Text style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>{receipt.generatedLine}</Text>
        <Button
          label="Print or save as PDF"
          icon="print-outline"
          onPress={() => void print()}
          loading={printing}
          style={{ marginTop: spacing.md }}
        />
        <Button
          label="Share as text"
          icon="share-outline"
          variant="secondary"
          onPress={share}
          style={{ marginTop: spacing.sm, paddingVertical: 10 }}
        />
      </Card>

      {receipt.notIssuedNotice ? (
        <Card style={{ marginBottom: spacing.xl }}>
          <Text style={{ color: c.text, fontSize: 14, lineHeight: 20 }}>{receipt.notIssuedNotice}</Text>
        </Card>
      ) : null}

      <SectionTitle>Device</SectionTitle>
      {rows(receipt.deviceRows)}

      {receipt.handoverRows ? (
        <>
          <SectionTitle>Handover</SectionTitle>
          {rows(receipt.handoverRows)}

          {receipt.confirmation ? (
            <Text style={{ color: c.text, fontSize: 14, lineHeight: 20, marginBottom: spacing.xl }}>
              {receipt.confirmation}
            </Text>
          ) : null}

          {/* Lines to sign on the printout; on screen they say who signs. */}
          {receipt.signatureLabels ? (
            <View style={{ gap: spacing.xl, marginBottom: spacing.xl }}>
              {receipt.signatureLabels.map((line) => (
                <View key={line}>
                  <View style={{ height: 36, borderBottomWidth: 1, borderBottomColor: c.text }} />
                  <Text style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>{line}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      <Text
        style={{
          color: c.subtle,
          fontSize: 12,
          lineHeight: 17,
          borderTopWidth: 1,
          borderTopColor: c.border,
          paddingTop: spacing.sm,
        }}
      >
        {receipt.footer}
      </Text>
    </Screen>
  );
}
