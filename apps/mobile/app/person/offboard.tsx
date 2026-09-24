import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import {
  offboardingExceptionProblem,
  offboardingFinishState,
  offboardingProgress,
  offboardingProgressLabel,
  type OffboardingAssetRef,
  type OffboardingRow,
} from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Button, Card, DetailSkeleton, Field, Screen, SectionTitle, StatusPill } from '../../src/components/ui';
import { HandoverSheet, type HandoverMode } from '../../src/components/handover-sheet';
import { FlashBanner, useFlash } from '../../src/components/requests/photo-markers';
import { errorText } from '../../src/components/people/sheet';
import { personName } from '../../src/lib/people-admin';
import { offboardGates, offboardedMessage } from '../../src/lib/offboarding';

/**
 * Offboarding a person, from the phone.
 *
 * The same two steps as the web panel: the leaver's kit with a return or a
 * hand-over per row (the sheets the asset page already uses), then Finish,
 * which the server refuses while anything is still out. Usually done standing
 * next to the person with the laptop on the desk, which is why it is here.
 */

interface Person {
  id: string;
  email: string;
  status: string;
  profile: { displayName: string | null; firstName: string | null; lastName: string | null } | null;
}

interface Task {
  id: string;
  status: string;
  exceptionReason: string | null;
  checklist: OffboardingAssetRef[] | null;
  outstandingAssets: OffboardingAssetRef[];
}

interface HeldConsumable {
  inventoryItemId: string;
  name: string;
  unit: string | null;
  quantity: number;
}

const statusText = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');

export default function OffboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useSession();
  const { c, scheme, spacing, radius } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  const router = useRouter();
  const { flash, showFlash } = useFlash();

  const [person, setPerson] = useState<Person | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [consumables, setConsumables] = useState<HeldConsumable[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const [handover, setHandover] = useState<{ mode: HandoverMode; row: OffboardingRow } | null>(
    null,
  );
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [exceptionReason, setExceptionReason] = useState('');
  const [busy, setBusy] = useState(false);

  // v2.85 - opening this screen used to START the offboarding, which told the
  // person to hand everything back and could not be undone. It now opens on a
  // preview that writes nothing; only the button starts it.
  const [outstandingPreview, setOutstandingPreview] = useState<OffboardingRow[] | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const [p, preview, s] = await Promise.all([
          api.request<Person>(`/users/${id}`),
          api.request<{ task: Task | null; outstanding: OffboardingRow[] }>(
            `/lifecycle/offboarding/preview/${id}`,
          ),
          api.request<HeldConsumable[]>(`/stock/held-by/${id}`).catch(() => []),
        ]);
        if (cancelled) return;
        setPerson(p);
        setTask(preview.task);
        setOutstandingPreview(preview.outstanding);
        setConsumables(s ?? []);
      } catch (e) {
        if (!cancelled) setStartError(errorText(e, 'Could not open offboarding.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  /** Starts it deliberately: from here on the person is asked to return things. */
  const startOffboarding = async () => {
    if (!id) return;
    setBusy(true);
    try {
      setTask(
        await api.request<Task>('/lifecycle/offboarding', {
          method: 'POST',
          body: { subjectUserId: id },
        }),
      );
      showFlash('success', `${name} has been asked to return their equipment.`);
    } catch (e) {
      showFlash('error', errorText(e, 'Could not start offboarding.'));
    } finally {
      setBusy(false);
    }
  };

  /** Calls off one started by mistake. The person is told they keep their kit. */
  const cancelOffboarding = async () => {
    if (!task) return;
    setBusy(true);
    try {
      await api.request(`/lifecycle/offboarding/${task.id}/cancel`, { method: 'POST', body: {} });
      setTask(null);
      showFlash('success', `Offboarding called off - ${name} keeps their equipment.`);
    } catch (e) {
      showFlash('error', errorText(e, 'Could not call off the offboarding.'));
    } finally {
      setBusy(false);
    }
  };

  const reloadTask = useCallback(async () => {
    if (!task) return;
    try {
      setTask(await api.request<Task>(`/lifecycle/tasks/${task.id}`));
    } catch (e) {
      showFlash('error', errorText(e, 'Could not refresh the list.'));
    }
  }, [api, task, showFlash]);

  const gates = offboardGates(user, person);
  const name = person ? personName(person) : '';
  const progress = offboardingProgress(task?.checklist, task?.outstandingAssets);
  const finish = offboardingFinishState({ taskStatus: task?.status, blocking: progress.blocking });
  const exceptionProblem = offboardingExceptionProblem(exceptionReason);

  const complete = async (reason?: string) => {
    if (!task) return;
    setBusy(true);
    try {
      const done = await api.request<Task>(`/lifecycle/offboarding/${task.id}/complete`, {
        method: 'POST',
        body: reason ? { exceptionReason: reason } : {},
      });
      setTask(done);
      setExceptionOpen(false);
      showFlash('success', offboardedMessage(name, Boolean(reason)));
    } catch (e) {
      // The server's own words: "N asset(s) are still assigned: …".
      showFlash('error', errorText(e, 'Could not complete the offboarding.'));
      await reloadTask();
    } finally {
      setBusy(false);
    }
  };

  if (startError) {
    return (
      <Screen>
        <Card>
          <Text style={{ color: c.danger, fontSize: 14 }}>{startError}</Text>
          <Button
            label="Back"
            variant="secondary"
            onPress={() => router.back()}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      </Screen>
    );
  }

  if (!person) {
    return (
      <DetailSkeleton />
    );
  }

  // v2.85 - nothing has started: show what it would involve, and ask.
  if (!task) {
    const rows = outstandingPreview ?? [];
    return (
      <Screen scroll fade>
        <Text style={{ color: c.text, fontSize: 20, fontWeight: '800' }}>Offboarding {name}</Text>
        <Text style={{ color: c.muted, fontSize: 13, marginTop: 4, marginBottom: spacing.lg }}>
          Nothing has started. This is what offboarding {name} would involve.
        </Text>

        <FlashBanner flash={flash} />

        <Card style={{ marginBottom: spacing.lg }}>
          <Text
            style={{ color: c.text, fontWeight: '700', fontSize: 15, marginBottom: spacing.sm }}
          >
            {rows.length === 0
              ? 'No equipment is assigned to them'
              : `${rows.length} item(s) still with them`}
          </Text>
          {rows.slice(0, 8).map((row) => (
            <Text
              key={row.assetId}
              style={{ color: c.muted, fontSize: 13, marginTop: 2 }}
              numberOfLines={1}
            >
              {row.name} · {row.assetTag}
            </Text>
          ))}
          {rows.length > 8 ? (
            <Text style={{ color: c.subtle, fontSize: 12, marginTop: 4 }}>
              and {rows.length - 8} more
            </Text>
          ) : null}
          {consumables.length > 0 ? (
            <Text style={{ color: c.muted, fontSize: 13, marginTop: 6 }}>
              Plus {consumables.length} item(s) issued from stock.
            </Text>
          ) : null}
        </Card>

        <Text style={{ color: c.muted, fontSize: 13, marginBottom: spacing.md }}>
          Starting asks {name} to return everything. You can call it off afterwards if it was a
          mistake.
        </Text>
        <Button
          label="Start offboarding"
          icon="log-out-outline"
          onPress={() => void startOffboarding()}
          loading={busy}
        />
      </Screen>
    );
  }

  const stepBadge = (n: number) => (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: c.brand,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
      }}
    >
      <Text style={{ color: c.brandText, fontSize: 12, fontWeight: '800' }}>{n}</Text>
    </View>
  );

  return (
    <Screen scroll>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '800' }}>Offboarding {name}</Text>
      <Text style={{ color: c.muted, fontSize: 13, marginTop: 4, marginBottom: spacing.lg }}>
        Take back what they hold, then close the account. They have been told what has to come back.
      </Text>

      <FlashBanner flash={flash} />

      {/* v2.85 - started by mistake? Call it off; they keep their equipment. */}
      {task.status === 'OPEN' ? (
        <Button
          label="Call off this offboarding"
          icon="close-circle-outline"
          variant="secondary"
          onPress={() => void cancelOffboarding()}
          disabled={busy}
          style={{ marginBottom: spacing.lg }}
        />
      ) : null}

      {/* Step 1 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
        {stepBadge(1)}
        <SectionTitle style={{ marginBottom: 0, flex: 1 }}>Return equipment</SectionTitle>
        <StatusPill label={offboardingProgressLabel(progress)} bg={c.surface} fg={c.muted} />
      </View>

      {progress.total === 0 ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={{ color: c.muted, fontSize: 14 }}>
            No equipment is assigned to {name}. Nothing blocks completion.
          </Text>
        </Card>
      ) : (
        <View style={{ marginBottom: spacing.md }}>
          {progress.rows.map((row) => (
            <Card key={row.assetId} style={{ marginBottom: spacing.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Ionicons
                  name={row.returned ? 'checkmark-circle' : 'hardware-chip-outline'}
                  size={22}
                  color={row.returned ? c.success : c.brand}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{ color: c.text, fontWeight: '700', fontSize: 15 }}
                    numberOfLines={1}
                  >
                    {row.name}
                  </Text>
                  <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                    {row.assetTag} · {row.returned ? 'Returned' : statusText(row.status)}
                  </Text>
                </View>
                {row.returned ? (
                  <StatusPill label="Done" bg={palette.success.bg} fg={palette.success.fg} />
                ) : null}
              </View>
              {!row.returned && (gates.canReturn || gates.canHandOver) ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                  {gates.canReturn ? (
                    <View style={{ flex: 1 }}>
                      <Button
                        label="Record return"
                        icon="arrow-undo-outline"
                        variant="secondary"
                        disabled={busy}
                        onPress={() => setHandover({ mode: 'return', row })}
                      />
                    </View>
                  ) : null}
                  {gates.canHandOver ? (
                    <View style={{ flex: 1 }}>
                      <Button
                        label="Hand over"
                        icon="swap-horizontal-outline"
                        variant="secondary"
                        disabled={busy}
                        onPress={() => setHandover({ mode: 'reassign', row })}
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Card>
          ))}
        </View>
      )}

      {progress.blocking > 0 && !gates.canReturn ? (
        // HR may run the offboarding but not touch custody; say who can.
        <Text style={{ color: c.muted, fontSize: 12, marginBottom: spacing.lg }}>
          Recording a return needs the assets:return permission - ask IT or an office admin. Pull
          this screen open again as they record each one.
        </Text>
      ) : null}

      {consumables.length > 0 ? (
        <>
          <SectionTitle>Consumables held</SectionTitle>
          <Text style={{ color: c.muted, fontSize: 12, marginBottom: spacing.sm }}>
            Stock items do not block completion. Return them from Stock on the web.
          </Text>
          <Card style={{ padding: 0, marginBottom: spacing.lg }}>
            {consumables.map((s, i) => (
              <View
                key={s.inventoryItemId}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  paddingVertical: 13,
                  borderBottomWidth: i === consumables.length - 1 ? 0 : 1,
                  borderBottomColor: c.border,
                }}
              >
                <Text style={{ color: c.text, fontSize: 14, flex: 1 }} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>
                  {s.quantity}
                  {s.unit ? ` ${s.unit}` : ''}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {/* Step 2 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
        {stepBadge(2)}
        <SectionTitle style={{ marginBottom: 0 }}>Finish</SectionTitle>
      </View>
      <Card style={{ marginBottom: spacing.xl }}>
        {finish === 'completed' ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="checkmark-circle" size={20} color={c.success} />
              <Text style={{ color: c.text, fontSize: 14, flex: 1 }}>
                Offboarding completed. {name}&apos;s account is deactivated.
              </Text>
            </View>
            <Button
              label="Back to person"
              variant="secondary"
              onPress={() => router.back()}
              style={{ marginTop: spacing.md }}
            />
          </>
        ) : (
          <>
            <Text style={{ color: c.muted, fontSize: 14 }}>
              {offboardingProgressLabel(progress)}
              {finish === 'blocked'
                ? ` - ${progress.blocking} still ${progress.blocking === 1 ? 'blocks' : 'block'} completion.`
                : ' - nothing blocks completion.'}
            </Text>
            <Button
              label="Complete offboarding and deactivate account"
              icon="person-remove-outline"
              loading={busy && !exceptionOpen}
              disabled={finish !== 'ready' || busy}
              onPress={() => void complete()}
              style={{ marginTop: spacing.md }}
            />
            {finish === 'blocked' && !exceptionOpen ? (
              <Button
                label="Complete with exception…"
                variant="secondary"
                disabled={busy}
                onPress={() => setExceptionOpen(true)}
                style={{ marginTop: spacing.sm }}
              />
            ) : null}
            {finish === 'blocked' && exceptionOpen ? (
              <View
                style={{
                  marginTop: spacing.md,
                  borderWidth: 1,
                  borderColor: palette.warning.border,
                  backgroundColor: palette.warning.bg,
                  borderRadius: radius.md,
                  padding: spacing.md,
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 8,
                    marginBottom: spacing.md,
                  }}
                >
                  <Ionicons name="warning-outline" size={18} color={palette.warning.fg} />
                  <Text
                    style={{ color: palette.warning.fg, fontSize: 13, flex: 1, lineHeight: 18 }}
                  >
                    The {progress.blocking} outstanding{' '}
                    {progress.blocking === 1 ? 'asset stays' : 'assets stay'} recorded against{' '}
                    {name} after their account is closed. Your name is recorded as having approved
                    this.
                  </Text>
                </View>
                <Field
                  label="Reason (required, at least 10 characters)"
                  placeholder="Laptop reported stolen; police report PR-2026-4471 filed."
                  value={exceptionReason}
                  onChangeText={setExceptionReason}
                  multiline
                  maxLength={1000}
                />
                {exceptionReason.length > 0 && exceptionProblem ? (
                  <Text style={{ color: c.danger, fontSize: 12, marginBottom: spacing.sm }}>
                    {exceptionProblem}
                  </Text>
                ) : null}
                <Button
                  label="Complete with exception and deactivate"
                  variant="danger"
                  loading={busy}
                  disabled={Boolean(exceptionProblem) || busy}
                  onPress={() => void complete(exceptionReason.trim())}
                />
                <Button
                  label="Cancel"
                  variant="ghost"
                  disabled={busy}
                  onPress={() => {
                    setExceptionOpen(false);
                    setExceptionReason('');
                  }}
                  style={{ marginTop: spacing.sm }}
                />
              </View>
            ) : null}
          </>
        )}
      </Card>

      <Text style={{ color: c.subtle, fontSize: 12, marginBottom: spacing.lg }}>
        Licence seats are not listed here: the register has no per-person seat view for
        administrators yet. Reclaim them from the licence itself.
      </Text>

      <HandoverSheet
        visible={handover !== null}
        mode={handover?.mode ?? 'return'}
        assetId={handover?.row.assetId ?? ''}
        assetName={handover?.row.name ?? ''}
        holderName={name}
        holderId={id ?? null}
        onClose={() => setHandover(null)}
        onDone={() => {
          showFlash(
            'success',
            handover?.mode === 'return'
              ? `${handover.row.name} returned`
              : `${handover?.row.name} handed over`,
          );
          void reloadTask();
        }}
      />
    </Screen>
  );
}
