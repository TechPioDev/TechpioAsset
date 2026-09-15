import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import * as Print from 'expo-print';
import { QR_MARGIN, assetLabelUrl, darkRuns, qrLabelHtml, qrMatrix } from '../../lib/qr-label';
import { webOrigin } from '../../providers/session';
import { useTheme } from '../../theme';
import { Button, Card, SectionTitle } from '../ui';

/** The web draws its label at 176px; the phone matches it as nearly as whole-pixel modules allow. */
const TARGET_PX = 176;

/**
 * The asset's QR label (web: AssetQrCard, v2.12). The same code as the web's,
 * drawn from the `qrcode` package's module matrix - see src/lib/qr-label.ts.
 * Always black on a white plate with a quiet zone, whatever the app theme: a
 * scanner reads dark-on-light, and a dark-mode inversion would not scan.
 *
 * Where the web offers "Download label" (a PNG), the phone offers the print
 * dialog, which also saves a PDF - the phone has no downloads folder to speak of.
 */
export function QrLabelCard({ assetTag, qrToken }: { assetTag: string; qrToken: string | null | undefined }) {
  const { c, spacing, radius } = useTheme();
  const [printing, setPrinting] = useState(false);

  const code = useMemo(() => {
    if (!qrToken) return null;
    try {
      const matrix = qrMatrix(assetLabelUrl(webOrigin, qrToken));
      return { matrix, runs: darkRuns(matrix) };
    } catch {
      return null;
    }
  }, [qrToken]);

  if (!qrToken || !code) return null;

  const modules = code.matrix.size + QR_MARGIN * 2;
  const cell = Math.max(2, Math.floor(TARGET_PX / modules));
  const side = cell * modules;

  async function printLabel() {
    if (!code) return;
    setPrinting(true);
    try {
      await Print.printAsync({ html: qrLabelHtml(code.matrix, assetTag) });
    } catch {
      // Cancelling the dialog rejects too (iOS: "Printing did not complete"),
      // and a cancel is not an error worth a message.
    } finally {
      setPrinting(false);
    }
  }

  return (
    <>
      <SectionTitle>QR label</SectionTitle>
      <Card style={{ marginBottom: spacing.xl }}>
        <Text style={{ color: c.subtle, fontSize: 12, marginBottom: spacing.md }}>
          {"Scanning this opens the device's page. Print it and stick it on the asset."}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.lg }}>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`QR code for ${assetTag}`}
            style={{
              backgroundColor: '#ffffff',
              padding: 8,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: c.border,
            }}
          >
            <View style={{ width: side, height: side, backgroundColor: '#ffffff' }}>
              {code.runs.map((r) => (
                <View
                  key={`${r.row}-${r.col}`}
                  style={{
                    position: 'absolute',
                    left: (r.col + QR_MARGIN) * cell,
                    top: (r.row + QR_MARGIN) * cell,
                    width: r.length * cell,
                    height: cell,
                    backgroundColor: '#000000',
                  }}
                />
              ))}
            </View>
          </View>
          <View style={{ gap: spacing.sm }}>
            <Text style={{ color: c.text, fontSize: 14, fontFamily: 'monospace' }}>{assetTag}</Text>
            <Button
              label="Print label"
              icon="print-outline"
              variant="secondary"
              onPress={() => void printLabel()}
              loading={printing}
              style={{ paddingVertical: 9 }}
            />
          </View>
        </View>
      </Card>
    </>
  );
}
