import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import {
  REQUEST_STATUS_TOKENS,
  TONE_PALETTE_DARK,
  TONE_PALETTE_LIGHT,
} from '@techpioasset/ui-tokens';
import type { RequestStatus } from '@techpioasset/domain';
import { useSession } from '../../src/providers/session';
import { useTheme, type Scheme } from '../../src/theme';
import { personName, formatMoney } from '../../src/lib/format';
import { Button, Card, DetailSkeleton, Field, Screen, SectionTitle, StatusPill } from '../../src/components/ui';
import { PERMISSIONS } from '@techpioasset/domain';
import { ProcurementAssessment } from '../../src/components/requests/procurement-assessment';
import { toast } from '../../src/components/toast';
import { confirm } from '../../src/components/confirm';
import {
  RequestConversation,
  type RequestComment,
} from '../../src/components/requests/request-conversation';
import {
  RequestAttachments,
  type RequestAttachment,
} from '../../src/components/requests/request-attachments';

interface ApprovalStep {
  id: string;
  stepName: string;
  decision: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED';
  /** v2.26 - APPROVAL steps are decided; the other two are done. */
  kind: 'APPROVAL' | 'INVENTORY_CHECK' | 'COST_ASSESSMENT';
  comment: string | null;
  reviewStartedAt: string | null;
  reviewStartedBy: { profile: { firstName: string | null; lastName: string | null } | null } | null;
  approver: {
    email: string;
    profile: { firstName: string | null; lastName: string | null } | null;
  } | null;
}

interface RequestDetail {
  id: string;
  requestNumber: string;
  type: string;
  status: RequestStatus;
  priority: string;
  businessReason: string;
  requiredBy: string | null;
  estimatedCost: string | null;
  currency: string;
  requester: {
    id: string;
    email: string;
    profile: { firstName: string | null; lastName: string | null } | null;
  } | null;
  beneficiary: {
    id: string;
    email: string;
    profile: { firstName: string | null; lastName: string | null } | null;
  } | null;
  items: { id: string; description: string; quantity: number; estimatedCost: string | null }[];
  approvals: ApprovalStep[];
  canDecide: boolean;
  /** Whether this step is the viewer's to stop - a different right to approving. */
  canDecline: boolean;
  /** Internal notes are only returned to holders of requests:approve. */
  comments: RequestComment[];
  attachments: RequestAttachment[];
}

/** Request detail with approve / reject (spec section 12). */
export default function RequestDetailScreen() {
  const { id, action } = useLocalSearchParams<{ id: string; action?: string }>();
  return <RequestDetailView id={id} action={action} />;
}

/**
 * The request page itself (v2.83): its own screen on a phone, the pane beside
 * the list on a tablet. `onFinished` replaces "go back" when there is
 * nothing to go back to - the list is right there.
 */
export function RequestDetailView({
  id,
  action: actionParam,
  onFinished,
}: {
  id: string;
  action?: string;
  onFinished?: () => void;
}) {
  // v2.78 - a button on the approval push (Approve / Reject) lands here asked
  // to do it. Handled once the request has loaded, and only once.
  const askedAction = actionParam === 'approve' || actionParam === 'reject' ? actionParam : null;
  const actionHandled = useRef(false);
  const { api, user } = useSession();
  const router = useRouter();
  const { c, scheme, spacing } = useTheme();
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;

  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await api.request<RequestDetail>(`/requests/${id}`);
    setRequest(data);
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function startReview() {
    if (!request) return;
    setBusy(true);
    try {
      await api.request(`/requests/${request.id}/review`, { method: 'POST' });
      await load();
    } catch {
      toast.say('Could not mark this', 'You may no longer be the approver for this step.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Answer the inventory check from the phone (v2.26).
   *
   * The screen offered Approve on this stage, which the server always refuses -
   * it is completed by recording the answer, not by agreeing with it - and
   * offered no way to record that answer at all. So the one step most likely to
   * be done away from a desk, standing in the stockroom looking at a shelf,
   * was the one step a phone could not finish.
   *
   * The quick yes/no stays here for the stock stage. Every other stage shows
   * the full procurement assessment (v2.56) to holders of requests:assess, as
   * the web page does.
   */
  async function answerStock(purchaseRequired: boolean) {
    if (!request) return;
    setBusy(true);
    try {
      await api.request(`/requests/${request.id}/assessment`, {
        method: 'PATCH',
        body: { inventoryAvailable: !purchaseRequired, purchaseRequired },
      });
      toast.say(
        'Recorded',
        purchaseRequired
          ? 'Marked as needing a purchase — it moves on to be costed.'
          : 'Filled from stock — no purchase, so finance approval is skipped.',
      );
      if (onFinished) onFinished();
      else router.back();
    } catch {
      toast.say('Could not record this', 'You may no longer be able to assess this request.');
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: 'APPROVED' | 'REJECTED') {
    if (!request) return;
    if (decision === 'REJECTED' && comment.trim().length === 0) {
      toast.say('Add a reason', 'Please note why you are rejecting this request.');
      return;
    }
    setBusy(true);
    try {
      await api.request(`/requests/${request.id}/decision`, {
        method: 'POST',
        body: { decision, comment: comment.trim() || undefined },
      });
      toast.say(
        decision === 'APPROVED' ? 'Approved' : 'Rejected',
        decision === 'APPROVED'
          ? 'The request moves to the next step.'
          : 'The requester has been notified.',
      );
      if (onFinished) onFinished();
      else router.back();
    } catch {
      toast.say('Could not submit', 'You may no longer be the approver for this step.');
      await load();
    } finally {
      setBusy(false);
    }
  }
  const decideRef = useRef(decide);
  decideRef.current = decide;

  // The button is a shortcut to the one on this screen, never a way round it:
  // the same canDecide the card below uses, and Approve still asks once, with
  // what is being approved in front of the approver.
  useEffect(() => {
    if (!askedAction || actionHandled.current || !request) return;
    actionHandled.current = true;
    const step = request.approvals.find((a) => a.decision === 'PENDING');
    const assessment = Boolean(step) && step!.kind !== 'APPROVAL';
    if (askedAction === 'approve') {
      if (request.canDecide && !assessment) {
        const items = request.items.map((i) => `${i.quantity} × ${i.description}`).join('\n');
        const who = request.requester ? personName(request.requester) : 'Someone';
        void (async () => {
          const ok = await confirm({
            title: `Approve ${request.requestNumber}?`,
            message: `${who} asked for:\n${items}`,
            confirmLabel: 'Approve',
            cancelLabel: 'Not now',
          });
          if (ok) await decideRef.current('APPROVED');
        })();
      } else {
        toast.say(
          'Nothing to approve',
          'This request is no longer waiting on your approval. It may already have been decided.',
        );
      }
    } else if (!request.canDecide && !request.canDecline) {
      toast.say(
        'Nothing to reject',
        'This request is no longer waiting on you. It may already have been decided.',
      );
    }
  }, [askedAction, request]);

  if (!request) {
    return (
      <DetailSkeleton />
    );
  }

  const tone = palette[REQUEST_STATUS_TOKENS[request.status].tone];
  const currentStep = request.approvals.find((a) => a.decision === 'PENDING') ?? null;
  const isAssessmentStage = Boolean(currentStep) && currentStep!.kind !== 'APPROVAL';
  // Same rule the web panel uses: the permission, and never on your own request.
  const canAssess =
    !!user?.permissions.includes(PERMISSIONS.REQUESTS_ASSESS) &&
    request.requester?.email !== user?.email;

  return (
    <Screen scroll fade>
      <Card style={{ marginBottom: spacing.xl }}>
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Text style={{ color: c.text, fontSize: 18, fontWeight: '800' }}>
            {request.requestNumber}
          </Text>
          <StatusPill
            label={
              request.approvals.find((a) => a.decision === 'PENDING')?.stepName ??
              REQUEST_STATUS_TOKENS[request.status].label
            }
            bg={tone.bg}
            fg={tone.fg}
          />
        </View>
        <View style={{ marginTop: spacing.md, gap: 8 }}>
          <Row label="Requested by" value={personName(request.requester)} />
          {request.beneficiary && request.beneficiary.email !== request.requester?.email ? (
            <Row label="For" value={personName(request.beneficiary)} />
          ) : null}
          <Row label="Priority" value={request.priority} />
          {request.estimatedCost ? (
            <Row
              label="Estimated cost"
              value={formatMoney(request.estimatedCost, request.currency)}
            />
          ) : null}
          {request.requiredBy ? (
            <Row label="Required by" value={new Date(request.requiredBy).toLocaleDateString()} />
          ) : null}
        </View>
      </Card>

      <SectionTitle>Reason</SectionTitle>
      <Card style={{ marginBottom: spacing.xl }}>
        <Text style={{ color: c.text, fontSize: 14, lineHeight: 21 }}>
          {request.businessReason}
        </Text>
      </Card>

      <SectionTitle>Items</SectionTitle>
      <Card style={{ padding: 0, marginBottom: spacing.xl }}>
        {request.items.map((item, i) => (
          <View
            key={item.id}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              paddingVertical: 14,
              borderBottomWidth: i === request.items.length - 1 ? 0 : 1,
              borderBottomColor: c.border,
            }}
          >
            <Text style={{ color: c.text, fontSize: 14, flex: 1 }}>
              {item.quantity > 1 ? `${item.quantity}× ` : ''}
              {item.description}
            </Text>
            {item.estimatedCost ? (
              <Text style={{ color: c.muted, fontSize: 13 }}>
                {formatMoney(item.estimatedCost, request.currency)}
              </Text>
            ) : null}
          </View>
        ))}
      </Card>

      <SectionTitle>Approval chain</SectionTitle>
      <Card style={{ marginBottom: spacing.xl }}>
        {request.approvals.map((step, i) => (
          <View
            key={step.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 10,
              borderBottomWidth: i === request.approvals.length - 1 ? 0 : 1,
              borderBottomColor: c.border,
            }}
          >
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                backgroundColor: decisionColor(step.decision, scheme),
              }}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>
                {step.stepName}
              </Text>
              {step.approver ? (
                <Text style={{ color: c.muted, fontSize: 12 }}>{personName(step.approver)}</Text>
              ) : null}
              {step.comment ? (
                <Text style={{ color: c.muted, fontSize: 12, fontStyle: 'italic' }}>
                  “{step.comment}”
                </Text>
              ) : null}
            </View>
            <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600' }}>
              {step.decision === 'PENDING' && step.reviewStartedAt
                ? `Under review${step.reviewStartedBy?.profile?.firstName ? ` · ${step.reviewStartedBy.profile.firstName}` : ''}`
                : decisionLabel(step.decision)}
            </Text>
          </View>
        ))}
      </Card>

      {/* v2.26 - what this step needs depends on what kind it is. An assessment
          stage is completed by recording an answer, so Approve is not offered:
          the server refuses it, and a button that always fails is worse than no
          button. Declining still applies - somebody has to be able to stop a
          request that should not go ahead. */}
      {currentStep && currentStep.kind === 'INVENTORY_CHECK' && canAssess ? (
        <Card style={{ marginBottom: spacing.xl }}>
          <Text style={{ color: c.text, fontWeight: '700', marginBottom: spacing.xs }}>
            Is this available in stock?
          </Text>
          <Text style={{ color: c.muted, fontSize: 12, marginBottom: spacing.md }}>
            Answering completes the step. Filling from stock closes the request without finance
            approval; needing a purchase sends it on to be costed.
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Button
              label="Yes — fill from stock"
              variant="secondary"
              onPress={() => void answerStock(false)}
              disabled={busy}
              style={{ flex: 1 }}
            />
            <Button
              label="No — must be bought"
              onPress={() => void answerStock(true)}
              loading={busy}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
      ) : canAssess ? (
        // Same gate as the web page: requests:assess, and never on your own
        // request. The full commercial form - product, prices, tax, shipping,
        // discount, note - with the total computed by the server.
        <ProcurementAssessment
          requestId={request.id}
          currency={request.currency}
          onSaved={() => void load()}
        />
      ) : null}

      {/*
        Two rights, not one (v2.27). Whoever staffs the step may stop the
        request; approving it additionally needs `requests:approve`. An
        Inventory Manager reaches this card with only the Decline button on it -
        and without "Mark as under review", whose endpoint they cannot call.
      */}
      {request.canDecide || request.canDecline ? (
        <Card style={{ marginBottom: spacing.xl }}>
          {request.canDecide &&
          !request.approvals.some((a) => a.decision === 'PENDING' && a.reviewStartedAt) ? (
            <Button
              label="Mark as under review"
              icon="eye-outline"
              variant="secondary"
              onPress={() => void startReview()}
              disabled={busy}
              style={{ marginBottom: spacing.md }}
            />
          ) : null}
          <Field
            label={
              askedAction === 'reject'
                ? 'Why are you rejecting it? (required)'
                : 'Comment (required to reject)'
            }
            placeholder={
              askedAction === 'reject' ? 'The requester sees this reason…' : 'Add a note…'
            }
            value={comment}
            onChangeText={setComment}
            multiline
            // Reject from the notification: the reason is the one thing left to do.
            autoFocus={askedAction === 'reject'}
          />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Button
              label={isAssessmentStage ? 'Decline request' : 'Reject'}
              variant="danger"
              onPress={() => void decide('REJECTED')}
              disabled={busy}
              style={{ flex: 1 }}
            />
            {isAssessmentStage || !request.canDecide ? null : (
              <Button
                label="Approve"
                icon="checkmark"
                onPress={() => void decide('APPROVED')}
                loading={busy}
                style={{ flex: 1 }}
              />
            )}
          </View>
        </Card>
      ) : null}

      <RequestAttachments
        requestId={request.id}
        attachments={request.attachments ?? []}
        onChanged={load}
      />

      <RequestConversation
        requestId={request.id}
        comments={request.comments ?? []}
        canInternal={!!user?.permissions.includes(PERMISSIONS.REQUESTS_APPROVE)}
        isOwnRequest={request.requester?.id === user?.id || request.beneficiary?.id === user?.id}
        onPosted={load}
      />
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: c.muted, fontSize: 14 }}>{label}</Text>
      <Text
        style={{
          color: c.text,
          fontWeight: '600',
          flexShrink: 1,
          textAlign: 'right',
          fontSize: 14,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function decisionColor(decision: ApprovalStep['decision'], scheme: Scheme): string {
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  if (decision === 'APPROVED') return palette.success.solid;
  if (decision === 'REJECTED') return palette.critical.solid;
  if (decision === 'PENDING') return palette.warning.solid;
  return palette.muted.solid;
}

function decisionLabel(decision: ApprovalStep['decision']): string {
  return decision.charAt(0) + decision.slice(1).toLowerCase();
}
