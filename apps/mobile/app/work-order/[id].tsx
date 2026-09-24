import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { PERMISSIONS, workOrderActions } from '@techpioasset/domain';
import { TONE_PALETTE_DARK, TONE_PALETTE_LIGHT } from '@techpioasset/ui-tokens';
import { ApiError } from '../../src/lib/api-client';
import { useSession } from '../../src/providers/session';
import { useTheme } from '../../src/theme';
import { Button, Card, DetailSkeleton, Field, IconBadge, Screen, SectionTitle, StatusPill } from '../../src/components/ui';
import { WO_TONE, isSlaOverdue, woLabel } from '../work-orders';
import { toast } from '../../src/components/toast';
import { confirm } from '../../src/components/confirm';

/**
 * v2.5 H6 - the technician's work-order detail: start / hold / resume /
 * complete, diagnosis notes, and part draw through the v2.4 guarded stock.
 * A refused draw shows the API's honest numbers in an alert - nothing moves.
 *
 * Sign-off: the assigned technician accepts before starting; completing sends
 * the job for approval; another manager approves (Closed) or sends it back with
 * a reason; any open job can be cancelled. Buttons follow the same domain rules
 * the API enforces.
 */

interface PartRow {
  id: string;
  quantity: string;
  reason: string | null;
  inventoryItem: { id: string; sku: string; name: string; unit: string };
}

interface WoDetail {
  id: string;
  type: string;
  status: string;
  title: string;
  description: string | null;
  diagnosis: string | null;
  slaDueAt: string | null;
  escalatedAt: string | null;
  technicianId: string | null;
  acceptedById: string | null;
  completedById: string | null;
  approvedAt: string | null;
  restoreAssetOnApproval: boolean | null;
  completedAt: string | null;
  resolutionNotes: string | null;
  asset: { id: string; assetTag: string; name: string } | null;
  parts: PartRow[];
}

interface StockItem {
  id: string;
  sku: string;
  name: string;
}
interface StockLocation {
  id: string;
  code: string;
  name: string;
}

export default function WorkOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useSession();
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [wo, setWo] = useState<WoDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnosis, setDiagnosis] = useState('');
  const [notes, setNotes] = useState('');
  const [sendBackReason, setSendBackReason] = useState('');
  const [items, setItems] = useState<StockItem[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [itemId, setItemId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [qty, setQty] = useState('1');

  const load = useCallback(async () => {
    setWo(await api.request<WoDetail>(`/maintenance/${id}`));
  }, [api, id]);
  useEffect(() => void load(), [load]);

  // Stock pickers load lazily and fail soft: a technician without inventory
  // read simply does not see the part-draw card.
  useEffect(() => {
    void (async () => {
      try {
        setItems((await api.request<StockItem[]>('/stock/items')) ?? []);
        setLocations((await api.request<StockLocation[]>('/stock/locations')) ?? []);
      } catch {
        /* no inventory visibility - the card stays hidden */
      }
    })();
  }, [api]);

  async function act(path: string, body?: unknown, method: 'POST' | 'PATCH' = 'POST') {
    setBusy(true);
    try {
      await api.request(`/maintenance/${id}/${path}`, { method, body: body ?? {} });
      await load();
      return true;
    } catch (error) {
      toast.say('Could not update', error instanceof Error ? error.message : 'Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Two buttons each - Android shows at most three.
  function confirmApprove(restoreAsset: boolean | null) {
    void (async () => {
      const ok = await confirm({
        title: 'Approve this work order?',
        message:
          restoreAsset === false
            ? 'It closes. The asset stays out of service, as the technician asked.'
            : 'It closes and the asset returns to service.',
        confirmLabel: 'Approve',
        cancelLabel: 'Not yet',
      });
      if (ok) await act('approve');
    })();
  }

  function confirmCancel() {
    void (async () => {
      const ok = await confirm({
        title: 'Cancel this work order?',
        message: 'It closes without being completed. This cannot be undone.',
        confirmLabel: 'Cancel work order',
        cancelLabel: 'Keep it',
        destructive: true,
      });
      if (ok) await act('cancel');
    })();
  }

  async function drawPart() {
    setBusy(true);
    try {
      await api.request(`/maintenance/${id}/consume-part`, {
        method: 'POST',
        body: { inventoryItemId: itemId, stockLocationId: locationId, quantity: Number(qty) },
      });
      setQty('1');
      await load();
      toast.say('Part drawn', 'The stock ledger records it against this work order.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // The guarded take speaking - honest numbers, nothing moved.
        toast.say('Draw refused', error.message);
      } else {
        toast.say('Could not draw the part', error instanceof Error ? error.message : 'Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!wo) {
    return (
      <DetailSkeleton />
    );
  }

  const tone = palette[WO_TONE[wo.status] ?? 'neutral'];
  const overdue = isSlaOverdue(wo);
  const open = !['COMPLETED', 'CANCELLED', 'FAILED'].includes(wo.status);
  const working = wo.status === 'IN_PROGRESS' || wo.status === 'ON_HOLD';
  const actions = workOrderActions(wo, {
    id: user?.id ?? '',
    canManage: user?.permissions.includes(PERMISSIONS.MAINTENANCE_MANAGE) ?? false,
  });
  const unaccepted = wo.technicianId !== null && wo.acceptedById !== wo.technicianId;
  const awaitingApproval = wo.status === 'AWAITING_APPROVAL';

  return (
    <Screen scroll fade>
      <Card style={{ marginBottom: spacing.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <IconBadge icon="build-outline" tint={overdue ? c.danger : undefined} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>{wo.title}</Text>
            <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>
              {[wo.asset ? `${wo.asset.assetTag}` : null, wo.type.toLowerCase()]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md }}>
          <StatusPill label={woLabel(wo.status)} bg={tone.bg} fg={tone.fg} />
          {wo.slaDueAt ? (
            <StatusPill
              label={
                overdue
                  ? `SLA overdue${wo.escalatedAt ? ' · escalated' : ''}`
                  : `due ${new Date(wo.slaDueAt).toLocaleDateString()}`
              }
              bg={overdue ? palette.critical.bg : palette.info.bg}
              fg={overdue ? palette.critical.fg : palette.info.fg}
            />
          ) : null}
        </View>
        {wo.description ? (
          <Text style={{ color: c.muted, fontSize: 13, marginTop: spacing.md }}>{wo.description}</Text>
        ) : null}
      </Card>

      {wo.diagnosis ? (
        <>
          <SectionTitle>Diagnosis</SectionTitle>
          <Card style={{ marginBottom: spacing.xl }}>
            <Text style={{ color: c.text, fontSize: 13, lineHeight: 19 }}>{wo.diagnosis}</Text>
          </Card>
        </>
      ) : null}

      {wo.parts.length > 0 ? (
        <>
          <SectionTitle>Parts used</SectionTitle>
          <Card style={{ padding: 0, marginBottom: spacing.xl }}>
            {wo.parts.map((part, i) => (
              <View
                key={part.id}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderBottomWidth: i === wo.parts.length - 1 ? 0 : 1,
                  borderBottomColor: c.border,
                }}
              >
                <Text style={{ color: c.text, fontWeight: '600', fontSize: 13, flex: 1 }} numberOfLines={1}>
                  {part.inventoryItem.name}
                </Text>
                <Text style={{ color: c.muted, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                  {Number(part.quantity)} {part.inventoryItem.unit}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {wo.completedAt ? (
        <>
          <SectionTitle>Outcome</SectionTitle>
          <Card style={{ marginBottom: spacing.xl }}>
            <Text style={{ color: c.muted, fontSize: 13 }}>
              Completed {new Date(wo.completedAt).toLocaleDateString()}
              {wo.approvedAt
                ? `, approved ${new Date(wo.approvedAt).toLocaleDateString()}.`
                : awaitingApproval
                  ? ', awaiting approval.'
                  : '.'}
              {wo.resolutionNotes ? ` ${wo.resolutionNotes}` : ''}
            </Text>
          </Card>
        </>
      ) : null}

      {open ? (
        <>
          <SectionTitle>Update diagnosis</SectionTitle>
          <Card style={{ marginBottom: spacing.xl }}>
            <Field
              label="What did you find?"
              value={diagnosis}
              onChangeText={setDiagnosis}
              placeholder={wo.diagnosis ?? 'Worn battery, loose fan cable…'}
              multiline
            />
            <Button
              label="Save diagnosis"
              variant="secondary"
              icon="create-outline"
              loading={busy}
              disabled={!diagnosis.trim()}
              onPress={() => void act('diagnosis', { diagnosis }, 'PATCH').then(() => setDiagnosis(''))}
            />
          </Card>
        </>
      ) : null}

      {working && items.length > 0 && locations.length > 0 ? (
        <>
          <SectionTitle>Draw a part</SectionTitle>
          <Card style={{ marginBottom: spacing.xl }}>
            <Text style={{ color: c.muted, fontSize: 12, marginBottom: 8 }}>Part</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md }}>
              {items.map((item) => (
                <Choice
                  key={item.id}
                  label={item.name}
                  selected={itemId === item.id}
                  onPress={() => setItemId(item.id)}
                />
              ))}
            </View>
            <Text style={{ color: c.muted, fontSize: 12, marginBottom: 8 }}>From location</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md }}>
              {locations.map((loc) => (
                <Choice
                  key={loc.id}
                  label={loc.code}
                  selected={locationId === loc.id}
                  onPress={() => setLocationId(loc.id)}
                />
              ))}
            </View>
            <Field
              label="Quantity"
              value={qty}
              onChangeText={setQty}
              keyboardType="number-pad"
              accessibilityLabel="Part quantity"
            />
            <Button
              label="Draw part"
              icon="download-outline"
              loading={busy}
              disabled={!itemId || !locationId || !/^\d+$/.test(qty) || Number(qty) < 1}
              onPress={() => void drawPart()}
            />
          </Card>
        </>
      ) : null}

      {open ? (
        <>
          <SectionTitle>Actions</SectionTitle>
          <View style={{ gap: spacing.md }}>
            {actions.accept ? (
              <>
                <Text style={{ color: c.muted, fontSize: 13 }}>
                  This job is assigned to you. Accept it to start work.
                </Text>
                <Button
                  label="Accept work order"
                  icon="checkmark-circle-outline"
                  loading={busy}
                  onPress={() => void act('accept')}
                />
              </>
            ) : null}
            {actions.start ? (
              <Button label="Start work" icon="play-outline" loading={busy} onPress={() => void act('start')} />
            ) : null}
            {unaccepted &&
            !actions.accept &&
            ['REQUESTED', 'SCHEDULED', 'ON_HOLD'].includes(wo.status) ? (
              <Text style={{ color: c.muted, fontSize: 13 }}>
                Waiting for the assigned technician to accept before work can start.
              </Text>
            ) : null}
            {actions.hold ? (
              <Button
                label="Put on hold"
                variant="secondary"
                icon="pause-outline"
                loading={busy}
                onPress={() => void act('hold')}
              />
            ) : null}
            {actions.resume ? (
              <Button label="Resume work" icon="play-outline" loading={busy} onPress={() => void act('resume')} />
            ) : null}
            {actions.complete ? (
              <>
                <Field
                  label="Resolution notes (optional)"
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Replaced the battery, tested charge..."
                  multiline
                />
                <Text style={{ color: c.muted, fontSize: 12 }}>
                  Another manager approves the work; the asset returns to service then.
                </Text>
                <Button
                  label="Complete and send for approval"
                  icon="checkmark-done-outline"
                  loading={busy}
                  onPress={() =>
                    void act('complete', {
                      ...(notes ? { resolutionNotes: notes } : {}),
                      replacementRecommended: false,
                      restoreAsset: true,
                    })
                  }
                />
              </>
            ) : null}
            {awaitingApproval && !actions.approve ? (
              <Text style={{ color: c.muted, fontSize: 13 }}>
                {wo.completedById === user?.id
                  ? 'You completed this job, so another manager must approve it or send it back.'
                  : 'Waiting for a manager to approve it.'}
              </Text>
            ) : null}
            {actions.approve ? (
              <Button
                label="Approve and close"
                icon="shield-checkmark-outline"
                loading={busy}
                onPress={() => confirmApprove(wo.restoreAssetOnApproval)}
              />
            ) : null}
            {actions.sendBack ? (
              <Card>
                <Field
                  label="Reason for sending back"
                  value={sendBackReason}
                  onChangeText={setSendBackReason}
                  placeholder="What still needs doing?"
                  maxLength={500}
                  multiline
                />
                <Button
                  label="Send back"
                  variant="secondary"
                  icon="arrow-undo-outline"
                  loading={busy}
                  disabled={!sendBackReason.trim()}
                  onPress={() =>
                    void act('send-back', { reason: sendBackReason.trim() }).then((ok) => {
                      if (ok) setSendBackReason('');
                    })
                  }
                />
              </Card>
            ) : null}
            {actions.cancel ? (
              <Button
                label="Cancel work order"
                variant="danger"
                icon="close-circle-outline"
                loading={busy}
                onPress={confirmCancel}
              />
            ) : null}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 99,
        backgroundColor: selected ? c.brand : c.surface,
        borderWidth: 1,
        borderColor: selected ? c.brand : c.border,
      }}
    >
      <Text style={{ color: selected ? c.brandText : c.muted, fontSize: 12, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}
