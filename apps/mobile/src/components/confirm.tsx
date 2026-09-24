import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { Button, Text } from './ui';
import { tapped } from '../lib/haptics';

/**
 * Asking before something that cannot be taken back (U2).
 *
 * 24 of the app's native alerts were real questions - revoke this seat,
 * report this asset damaged, dispose of it - and those deserve to stop you.
 * They keep that weight here; what they gain is the app's own type, colour
 * and spacing, and a destructive action that looks destructive rather than
 * relying on iOS to tint it red and Android to not bother.
 *
 * `confirm()` returns a promise, so a call site reads as the decision it is:
 *
 *   if (!(await confirm({ title: 'Revoke seat?', destructive: true }))) return;
 *
 * Like the toast, it is module-level rather than a hook, because most of
 * these live in plain callbacks rather than component bodies. With no host
 * mounted it resolves `false` - never silently proceed with something
 * irreversible because the question could not be asked.
 */

export interface ConfirmRequest {
  title: string;
  message?: string;
  /** The button that does the thing. Defaults to "Confirm". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Draws the action as dangerous and gives it the warning mark. */
  destructive?: boolean;
}

type Pending = ConfirmRequest & { resolve: (ok: boolean) => void };

let open: ((p: Pending) => void) | null = null;

export function confirm(request: ConfirmRequest): Promise<boolean> {
  if (!open) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => open?.({ ...request, resolve }));
}

export function ConfirmHost() {
  const { c, radius, spacing, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    open = setPending;
    return () => {
      open = null;
    };
  }, []);

  const finish = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <Modal
      visible={pending !== null}
      transparent
      animationType="fade"
      // Android's back button is a cancel, never a silent confirm.
      onRequestClose={() => finish(false)}
    >
      <Pressable
        onPress={() => finish(false)}
        style={{
          flex: 1,
          backgroundColor: 'rgba(2,6,23,0.55)',
          justifyContent: 'flex-end',
          paddingBottom: insets.bottom + spacing.lg,
          paddingHorizontal: spacing.lg,
        }}
      >
        {/* Swallows taps so a press inside the card does not dismiss it. */}
        <Pressable
          onPress={() => undefined}
          style={{
            backgroundColor: c.card,
            borderRadius: radius.xl,
            padding: spacing.xl,
            ...elevation(2),
          }}
        >
          {pending?.destructive ? (
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                backgroundColor: c.dangerSoft,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: spacing.md,
              }}
            >
              <Ionicons name="warning-outline" size={23} color={c.danger} />
            </View>
          ) : null}

          <Text variant="heading">{pending?.title}</Text>
          {pending?.message ? (
            <Text variant="body" tone="muted" style={{ marginTop: 6 }}>
              {pending.message}
            </Text>
          ) : null}

          <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
            <Button
              label={pending?.confirmLabel ?? 'Confirm'}
              variant={pending?.destructive ? 'danger' : 'primary'}
              onPress={() => finish(true)}
            />
            <Button
              label={pending?.cancelLabel ?? 'Cancel'}
              variant="secondary"
              onPress={() => {
                tapped();
                finish(false);
              }}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
