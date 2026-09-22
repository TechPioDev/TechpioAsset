import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '../providers/session';
import { isNoConnection, recordOffline } from '../lib/sync-service';
import { useTheme } from '../theme';
import { Button, Field } from './ui';

export interface CountTarget {
  inventoryItemId: string;
  stockLocationId: string;
  itemName: string;
  locationName: string;
  unit: string;
  /** What the system says is on the shelf as the count starts. */
  systemQuantity: number;
}

/**
 * Counting a shelf (Phase 6, v2.82): "there are N here". Online it posts the
 * difference to the ledger as a cycle-count correction, exactly as the web
 * does. With no signal it is saved with the figure the system showed, and
 * applied later only if nothing has moved since - otherwise it comes back
 * asking for a recount, because setting the shelf to N would silently undo
 * whatever was issued or received in between.
 */
export function StockCountSheet({
  target,
  onClose,
  onDone,
}: {
  target: CountTarget | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { api } = useSession();
  const { c, spacing } = useTheme();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setValue('');
    setError(null);
    setOffline(false);
  }, [target]);

  if (!target) return null;
  const counted = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(counted) && counted >= 0;

  async function save() {
    if (!target || !valid) {
      setError('Enter how many are on the shelf.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (offline) {
        await recordOffline({
          type: 'STOCK_COUNT',
          entityId: null,
          payload: {
            inventoryItemId: target.inventoryItemId,
            stockLocationId: target.stockLocationId,
            countedQuantity: counted,
            seenQuantity: target.systemQuantity,
          },
          label: `Count ${target.itemName} at ${target.locationName}: ${counted}`,
        });
        onDone('Saved on the phone. It will be sent when you are back online.');
        return;
      }
      await api.request('/stock/count-correction', {
        method: 'POST',
        body: {
          inventoryItemId: target.inventoryItemId,
          stockLocationId: target.stockLocationId,
          countedQuantity: counted,
        },
      });
      onDone(
        counted === target.systemQuantity
          ? 'Counted - it matches the system.'
          : `Counted ${counted}; the system said ${target.systemQuantity}. Corrected in the ledger.`,
      );
    } catch (e) {
      if (isNoConnection(e)) {
        setOffline(true);
        setError(
          'No connection. Save the count here and it will be sent when you are back online.',
        );
      } else {
        setError(e instanceof Error ? e.message : 'Could not record the count.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(2,6,23,0.45)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: c.background,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            padding: spacing.lg,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>
                Count {target.itemName}
              </Text>
              <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>
                {target.locationName} · the system says {target.systemQuantity} {target.unit}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={c.muted} />
            </Pressable>
          </View>
          <Field
            label="How many are on the shelf?"
            value={value}
            onChangeText={setValue}
            keyboardType="numeric"
            placeholder="0"
            autoFocus
          />
          {error ? (
            <Text style={{ color: c.danger, fontSize: 13, marginBottom: spacing.md }}>{error}</Text>
          ) : null}
          <Button
            label={offline ? 'Save and send later' : 'Record count'}
            icon={offline ? 'cloud-upload-outline' : 'checkmark'}
            onPress={() => void save()}
            loading={busy}
          />
        </View>
      </View>
    </Modal>
  );
}
