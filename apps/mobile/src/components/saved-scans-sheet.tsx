import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { displayToken, scannedWhen, type SavedScan } from '../lib/offline-scans';
import { useTheme } from '../theme';
import { AssetSheet } from './assets/sheet';
import { Button, EmptyState } from './ui';

/**
 * Saved scans (0.3.29) - the codes read while there was no connection.
 *
 * Opened from the scan screen and nowhere else: it is the second half of a
 * scan, not a place of its own, and a menu entry for something that is empty
 * on nearly every phone nearly all the time would be clutter.
 *
 * A row is a code and when it was read - that is all the phone knows, because
 * the lookup that would have named the asset is the thing that could not
 * happen. Tapping a row is that lookup, made now. The screen owns the lookup
 * and the storage; this sheet only shows the list and reports what came back,
 * so the rule for "network failure or a real no" stays in one place.
 */
export function SavedScansSheet({
  visible,
  scans,
  onClose,
  onOpen,
  onRemove,
  onClearAll,
}: {
  visible: boolean;
  scans: readonly SavedScan[];
  onClose: () => void;
  /** Looks the code up. Resolves to null when it opened, or to why it did not. */
  onOpen: (token: string) => Promise<string | null>;
  onRemove: (token: string) => void;
  onClearAll: () => void;
}) {
  const { c, spacing, radius } = useTheme();
  const [opening, setOpening] = useState<string | null>(null);
  // Kept per row, so the reason sits under the code it is about and the other
  // rows stay usable - one banner for the whole sheet could not say which.
  const [failures, setFailures] = useState<Record<string, string>>({});
  // "12 min ago" is worked out when the sheet opens, not on every render.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!visible) return;
    setNow(new Date());
    setFailures({});
  }, [visible]);

  async function open(token: string) {
    if (opening) return;
    setOpening(token);
    setFailures((current) => {
      const { [token]: _cleared, ...rest } = current;
      return rest;
    });
    try {
      const failure = await onOpen(token);
      if (failure) setFailures((current) => ({ ...current, [token]: failure }));
    } finally {
      setOpening(null);
    }
  }

  function confirmClearAll() {
    Alert.alert(
      'Clear all saved scans?',
      `${scans.length === 1 ? 'The saved code' : `All ${scans.length} saved codes`} will be removed from this phone. The assets themselves are not affected.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear all', style: 'destructive', onPress: onClearAll },
      ],
    );
  }

  return (
    <AssetSheet
      visible={visible}
      title="Saved scans"
      subtitle="Read with no connection. Tap one to open it."
      onClose={onClose}
    >
      {scans.length === 0 ? (
        <EmptyState
          icon="qr-code-outline"
          title="Nothing saved"
          message="A code scanned with no connection is kept here until you open it."
        />
      ) : (
        <>
          {scans.map((scan) => {
            const busy = opening === scan.token;
            const failure = failures[scan.token];
            return (
              <View
                key={scan.token}
                style={{
                  backgroundColor: c.card,
                  borderColor: c.border,
                  borderWidth: 1,
                  borderRadius: radius.lg,
                  marginBottom: spacing.md,
                  overflow: 'hidden',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Pressable
                    onPress={() => void open(scan.token)}
                    disabled={opening !== null}
                    accessibilityRole="button"
                    accessibilityLabel={`Open saved scan ${scan.token}`}
                    style={({ pressed }) => ({
                      flex: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.md,
                      padding: spacing.md,
                      opacity: pressed || (opening !== null && !busy) ? 0.6 : 1,
                    })}
                  >
                    <View style={{ width: 24, alignItems: 'center' }}>
                      {busy ? (
                        <ActivityIndicator color={c.brand} />
                      ) : (
                        <Ionicons name="qr-code-outline" size={22} color={c.brand} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>
                        {displayToken(scan.token)}
                      </Text>
                      <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
                        {busy ? 'Looking it up…' : `Scanned ${scannedWhen(scan.scannedAt, now).toLowerCase()}`}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => onRemove(scan.token)}
                    disabled={busy}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove saved scan ${scan.token}`}
                    style={({ pressed }) => ({ padding: spacing.md, opacity: pressed || busy ? 0.5 : 1 })}
                  >
                    <Ionicons name="trash-outline" size={20} color={c.danger} />
                  </Pressable>
                </View>
                {failure ? (
                  <Text
                    style={{
                      color: c.danger,
                      backgroundColor: c.dangerSoft,
                      fontSize: 13,
                      lineHeight: 18,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                    }}
                  >
                    {failure}
                  </Text>
                ) : null}
              </View>
            );
          })}
          <Button
            label="Clear all"
            icon="trash-outline"
            variant="danger"
            onPress={confirmClearAll}
            disabled={opening !== null}
          />
        </>
      )}
    </AssetSheet>
  );
}
