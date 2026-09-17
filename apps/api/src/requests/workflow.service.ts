import { Injectable, Logger } from '@nestjs/common';
import { ApprovalDecision, Prisma, type RequestType } from '@prisma/client';
import {
  canApproveStep,
  pendingStatusForApprover,
  resolveApplicableSteps,
  type ApproverType,
  type RequestStatus,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface MaterialisedStep {
  stepOrder: number;
  stepName: string;
  approverType: ApproverType;
  approverRoleId: string | null;
  approverRoleKey: string | null;
  approverId: string | null;
  slaDueAt: Date | null;
  /** Snapshotted onto the approval row so a later config change cannot
   *  re-decide a request already in flight. */
  costThreshold: string | null;
  /** What the step asks of its holder: a judgement, or the assessment work. */
  kind: 'APPROVAL' | 'INVENTORY_CHECK' | 'COST_ASSESSMENT';
}

/**
 * Turns a configured WorkflowDefinition into the concrete approval chain for one
 * request, and decides who may act on the current step.
 *
 * Spec section 11 requires Super Admins to configure steps, approvers,
 * thresholds and bypass rules, so none of that is hard-coded — this service only
 * interprets the configuration.
 */
@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds the definition for a request type, falling back to the catch-all
   * (requestType = null) so a newly added type is never left without a workflow.
   */
  async resolveDefinition(companyId: string, type: RequestType) {
    const specific = await this.prisma.client.workflowDefinition.findFirst({
      where: { companyId, requestType: type, isActive: true },
      include: { steps: { include: { approverRole: true }, orderBy: { stepOrder: 'asc' } } },
    });
    if (specific) return specific;

    return this.prisma.client.workflowDefinition.findFirst({
      where: { companyId, requestType: null, isActive: true },
      include: { steps: { include: { approverRole: true }, orderBy: { stepOrder: 'asc' } } },
    });
  }

  /** Steps that apply once thresholds are taken into account. */
  async materialise(
    companyId: string,
    type: RequestType,
    estimatedCost: Prisma.Decimal | string | null,
  ): Promise<{ definitionId: string | null; steps: MaterialisedStep[] }> {
    const definition = await this.resolveDefinition(companyId, type);
    if (!definition) {
      this.logger.warn(`No workflow definition for ${type} in company ${companyId}`);
      return { definitionId: null, steps: [] };
    }

    // v2.28 - a step switched off is not part of the process for anything
    // raised from now on. Filtered here, at the snapshot, so a request already
    // in flight keeps the step it was submitted with.
    const enabled = definition.steps.filter((step) => step.isEnabled);

    const applicable = resolveApplicableSteps(
      enabled.map((step) => ({
        stepOrder: step.stepOrder,
        approverType: step.approverType as ApproverType,
        approverRoleKey: step.approverRole?.key ?? null,
        approverUserId: step.approverUserId,
        costThreshold: step.costThreshold ? step.costThreshold.toString() : null,
        isSkippable: step.isSkippable,
        name: step.name,
        approverRoleId: step.approverRoleId,
        slaHours: step.slaHours,
        kind: step.kind,
      })),
      estimatedCost === null ? null : estimatedCost.toString(),
    );

    return {
      definitionId: definition.id,
      steps: applicable.map((step) => ({
        stepOrder: step.stepOrder,
        stepName: step.name,
        approverType: step.approverType,
        approverRoleId: step.approverRoleId,
        approverRoleKey: step.approverRoleKey,
        approverId: step.approverUserId ?? null,
        slaDueAt: step.slaHours ? new Date(Date.now() + step.slaHours * 3_600_000) : null,
        costThreshold: step.costThreshold ?? null,
        kind: step.kind,
      })),
    };
  }

  /** Status the request should sit in while the given step is pending. */
  statusForStep(step: MaterialisedStep): RequestStatus {
    return pendingStatusForApprover({
      approverType: step.approverType,
      approverRoleKey: step.approverRoleKey,
    });
  }

  /**
   * Non-throwing counterpart to assertCanDecide, for telling the UI whether to
   * offer the approve/reject controls.
   *
   * The client cannot work this out for itself: whether someone may act depends
   * on the step's approver type and, for a line-manager step, on the requester's
   * manager. Without this the UI shows an Approve button to every holder of
   * `requests:approve` and lets them discover the 403 by clicking it.
   */
  async canDecide(input: {
    requestId: string;
    actorId: string;
    actorRoleKeys: readonly string[];
  }): Promise<boolean> {
    try {
      await this.assertCanDecide(input);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Authorises a decision on the current step.
   *
   * Holding `requests:approve` is necessary but not sufficient: the actor must
   * also match *this* step's approver. Otherwise any approver could sign off any
   * stage, and the configured chain would be decorative.
   */
  async assertCanDecide(input: {
    requestId: string;
    actorId: string;
    actorRoleKeys: readonly string[];
  }) {
    const approval = await this.prisma.client.requestApproval.findFirst({
      where: { requestId: input.requestId, decision: ApprovalDecision.PENDING },
      orderBy: { stepOrder: 'asc' },
      include: {
        request: {
          include: { requester: { include: { profile: { include: { department: true } } } } },
        },
      },
    });

    if (!approval) {
      throw new AppError(
        'ILLEGAL_STATE_TRANSITION',
        'This request has no step awaiting a decision',
      );
    }

    const role = approval.approverRoleId
      ? await this.prisma.client.role.findUnique({ where: { id: approval.approverRoleId } })
      : null;

    const ctx = {
      step: {
        stepOrder: approval.stepOrder,
        approverType: approval.approverType as ApproverType,
        approverRoleKey: role?.key ?? null,
        approverUserId: approval.approverId,
        isSkippable: false,
      },
      requesterId: approval.request.requester.id,
      requesterManagerId: approval.request.requester.profile?.managerId ?? null,
      // v2.2 Workstream D — resolve the requester's department head so
      // DEPARTMENT_HEAD steps are approvable (were hardcoded null / un-approvable).
      requesterDepartmentHeadId: approval.request.requester.profile?.department?.headId ?? null,
    } as const;

    // Direct: the actor is the step's approver.
    if (canApproveStep({ ...ctx, actorId: input.actorId, actorRoleKeys: input.actorRoleKeys })) {
      return approval;
    }

    // Deadlock breaker (v2.15). A role step whose role has NO members can be
    // decided by nobody - found in production, where the default workflow's
    // first step targeted a Manager role with zero holders and two requests
    // sat undecidable with nobody notified. When (and only when) the approver
    // set is provably empty, a user-manager may decide: they could grant
    // themselves the role anyway, so this removes ceremony, not a control.
    // The requester-must-not-approve rule still applies above all.
    if (
      approval.approverRoleId &&
      !approval.approverId &&
      input.actorId !== approval.request.requester.id
    ) {
      const holderCount = await this.prisma.client.userRole.count({
        where: { roleId: approval.approverRoleId },
      });
      if (holderCount === 0) {
        const actorIsUserManager = await this.prisma.client.userRole.findFirst({
          where: {
            userId: input.actorId,
            role: { permissions: { some: { permission: { key: 'users:manage' } } } },
          },
          select: { userId: true },
        });
        if (actorIsUserManager) return approval;
      }
    }

    // v2.2 Workstream D — delegated: the actor may act for anyone who has an
    // active delegation to them. SoD is preserved because canApproveStep rejects
    // `actorId === requesterId`, so a delegate can never approve the delegator's
    // (or their own) request.
    for (const delegatorId of await this.activeDelegatorsFor(
      input.actorId,
      approval.request.companyId,
    )) {
      const delegatorRoleKeys = (
        await this.prisma.client.userRole.findMany({
          where: { userId: delegatorId },
          select: { role: { select: { key: true } } },
        })
      ).map((r) => r.role.key);
      if (canApproveStep({ ...ctx, actorId: delegatorId, actorRoleKeys: delegatorRoleKeys })) {
        return approval;
      }
    }

    throw AppError.forbidden(
      `This request is awaiting "${approval.stepName}", which you are not the approver for`,
    );
  }

  /** User ids that have an active (in-window, un-revoked) delegation to `actorId`. */
  private async activeDelegatorsFor(actorId: string, companyId: string): Promise<string[]> {
    const now = new Date();
    const rows = await this.prisma.client.approvalDelegation.findMany({
      where: {
        delegateId: actorId,
        companyId,
        revokedAt: null,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      select: { delegatorId: true },
    });
    return rows.map((r) => r.delegatorId);
  }
}
