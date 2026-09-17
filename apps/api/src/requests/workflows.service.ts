import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type {
  AuthUser,
  CreateWorkflowStepInput,
  ReorderWorkflowStepsInput,
  SetAssessmentStagesInput,
  UpdateWorkflowStepInput,
} from '@techpioasset/contracts';
import { assessmentInsertIndex, isCompleteReorder, orderWorkflowSteps } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RETIRED_STEP_REASON } from '@techpioasset/domain';
import { RequestsService, type RetiredStepAdvance } from './requests.service.js';

/** Written on the skipped step of every request the change moved on. */
const RETIRED_REASON = RETIRED_STEP_REASON;

/**
 * Taking a step out of in-flight requests walks every request sitting on it,
 * so the transaction is given room: Prisma's 5s default was measured to fail
 * on a database with a few hundred of them.
 */
const RETIRE_TX = { timeout: 120_000, maxWait: 10_000 };

/**
 * Reading and editing the configured approval chains (v2.24, v2.28).
 *
 * The chains have been configurable in the data model since the beginning and
 * editable nowhere: `workflows:configure` was granted to Super Admin and
 * enforced by no route, so changing a cost threshold meant editing the
 * database by hand - no audit row, no way for the person who owns the process
 * to do it themselves.
 *
 * Each step is reported with the number of accounts that could actually decide
 * it, because a threshold is only half the question: a step that applies to
 * every request and has no eligible approver is worse than one that rarely
 * applies.
 *
 * v2.28 adds the structure itself - add, rename, remove, reorder and switch
 * off approval steps. A chain is snapshotted onto the request when it is
 * submitted, so adding, renaming and reordering reach only requests raised
 * afterwards. Taking a step away - switching it off or removing it - reaches
 * the requests still in approval as well, because the owner's rule is that a
 * step that no longer exists should not be waiting on anybody: queued copies
 * go, the one currently awaiting a decision is skipped and the chain moves
 * on (RequestsService.retireStepFromInFlight). The assessment stages are
 * never edited one at a time - they stay a pair and are re-placed by their
 * rule after every change, see @techpioasset/domain orderWorkflowSteps.
 */
@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly requests: RequestsService,
  ) {}

  /** The after-commit half of taking a step out of in-flight requests. */
  private async finishRetired(actor: AuthUser, advanced: RetiredStepAdvance[]): Promise<void> {
    for (const ctx of advanced) await this.requests.finishRetiredStep(actor, ctx);
  }

  async list(actor: AuthUser) {
    const definitions = await this.prisma.client.workflowDefinition.findMany({
      where: { companyId: actor.companyId },
      orderBy: [{ requestType: 'asc' }, { name: 'asc' }],
      take: 50,
      include: {
        steps: { orderBy: { stepOrder: 'asc' }, include: { approverRole: true } },
      },
    });

    // One query for every role's headcount rather than one per step.
    const roleIds = [
      ...new Set(
        definitions.flatMap((d) => d.steps.map((s) => s.approverRoleId).filter(Boolean)),
      ),
    ] as string[];
    const holders = roleIds.length
      ? await this.prisma.client.userRole.groupBy({
          by: ['roleId'],
          where: { roleId: { in: roleIds }, user: { deletedAt: null, status: 'ACTIVE' } },
          _count: { userId: true },
        })
      : [];
    const holderCount = new Map(holders.map((h) => [h.roleId, h._count.userId]));

    // A LINE_MANAGER step falls back to the Manager role when the requester has
    // no manager recorded, so that role's headcount is what it resolves to in
    // the general case - the same rule the request engine applies.
    const managerRole = await this.prisma.client.role.findFirst({
      where: { companyId: actor.companyId, key: 'MANAGER' },
      select: { id: true },
    });
    const managerHolders = managerRole
      ? await this.prisma.client.userRole.count({
          where: { roleId: managerRole.id, user: { deletedAt: null, status: 'ACTIVE' } },
        })
      : 0;

    return definitions.map((definition) => {
      const approvals = definition.steps.filter((s) => s.kind === 'APPROVAL');
      const enabledCount = approvals.filter((s) => s.isEnabled).length;
      // A chain must keep one enabled approval step, or every new request is
      // approved on submission. Removing a step that is already off never
      // threatens that; removing or switching off the last one on does.
      const lastOn = (step: (typeof approvals)[number]) => step.isEnabled && enabledCount <= 1;
      return {
        id: definition.id,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        requestType: definition.requestType,
        isActive: definition.isActive,
        steps: definition.steps.map((step) => ({
          id: step.id,
          stepOrder: step.stepOrder,
          name: step.name,
          approverType: step.approverType,
          approverRoleKey: step.approverRole?.key ?? null,
          approverRoleName: step.approverRole?.name ?? null,
          costThreshold: step.costThreshold ? step.costThreshold.toString() : null,
          kind: step.kind,
          isSkippable: step.isSkippable,
          slaHours: step.slaHours,
          eligibleApprovers:
            step.approverType === 'LINE_MANAGER'
              ? managerHolders
              : (holderCount.get(step.approverRoleId ?? '') ?? 0),
          isEnabled: step.isEnabled,
          // The stages leave only as a pair, via their own route, and are
          // never switched off - they hold the request until answered.
          canRemove: step.kind === 'APPROVAL' && approvals.length > 1 && !lastOn(step),
          canDisable: step.kind === 'APPROVAL' && step.isEnabled && !lastOn(step),
        })),
      };
    });
  }

  /**
   * Turn the two assessment stages on or off for one workflow (v2.25).
   *
   * They go in immediately before the first thresholded step, because that is
   * the step whose answer they exist to supply - the cost has to be known
   * before Finance can be told whether it is needed. With no thresholded step
   * they go at the end, where the work still has to happen before the request
   * is fulfilled.
   *
   * Removing them takes only the stages themselves; requests already in flight
   * carry their own snapshotted copy of the chain and are untouched.
   */
  async setAssessmentStages(
    actor: AuthUser,
    definitionId: string,
    input: SetAssessmentStagesInput,
  ) {
    const definition = await this.prisma.client.workflowDefinition.findFirst({
      where: { id: definitionId, companyId: actor.companyId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!definition) throw AppError.notFound('Workflow', definitionId);

    const existing = definition.steps.filter((s) => s.kind !== 'APPROVAL');

    if (!input.enabled) {
      if (existing.length === 0) return this.list(actor);
      await this.prisma.client.$transaction(async (tx) => {
        await tx.workflowStep.deleteMany({
          where: { id: { in: existing.map((step) => step.id) } },
        });
        await this.renumber(tx, definitionId);
      });
      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.SETTING_CHANGED,
        entityType: 'WorkflowDefinition',
        entityId: definitionId,
        previousValues: { assessmentStages: true },
        newValues: { assessmentStages: false, workflow: definition.name },
      });
      return this.list(actor);
    }

    if (existing.length > 0) return this.list(actor);

    const roleKey = input.roleKey ?? 'OFFICE_ADMIN';
    const role = await this.prisma.client.role.findFirst({
      where: { companyId: actor.companyId, key: roleKey },
      select: { id: true },
    });
    if (!role) throw AppError.notFound('Role', roleKey);

    // Before the first thresholded step: its answer is what the threshold is
    // measured against. The same rule re-places the pair after every later
    // add, remove or reorder.
    const firstThresholded = definition.steps[assessmentInsertIndex(definition.steps)];
    const insertAt = firstThresholded
      ? firstThresholded.stepOrder
      : (definition.steps.at(-1)?.stepOrder ?? 0) + 1;

    await this.prisma.client.$transaction(async (tx) => {
      // Two slots are needed, so everything at or after the insert point moves
      // down by two. Descending order avoids colliding with the unique
      // (definition, stepOrder) index on the way.
      for (const step of [...definition.steps].reverse()) {
        if (step.stepOrder < insertAt) continue;
        await tx.workflowStep.update({
          where: { id: step.id },
          data: { stepOrder: step.stepOrder + 2 },
        });
      }
      await tx.workflowStep.createMany({
        data: [
          {
            workflowDefinitionId: definitionId,
            stepOrder: insertAt,
            name: 'Inventory check',
            approverType: 'ROLE',
            approverRoleId: role.id,
            kind: 'INVENTORY_CHECK',
            slaHours: 48,
          },
          {
            workflowDefinitionId: definitionId,
            stepOrder: insertAt + 1,
            name: 'Cost assessment',
            approverType: 'ROLE',
            approverRoleId: role.id,
            kind: 'COST_ASSESSMENT',
            slaHours: 48,
          },
        ],
      });
      await this.renumber(tx, definitionId);
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'WorkflowDefinition',
      entityId: definitionId,
      previousValues: { assessmentStages: false },
      newValues: { assessmentStages: true, roleKey, workflow: definition.name },
    });

    return this.list(actor);
  }

  /**
   * Close the gaps a add or remove leaves in the ordering.
   *
   * Adding shifts later steps down by two and removing does not shift them
   * back, so without this a workflow toggled a few times ends up with its last
   * step at order 10 - harmless to sort, but it makes the configuration read
   * like something went wrong, and the insertion point is computed from those
   * numbers. Renumbering to 1..n after every change keeps them meaningful.
   *
   * Done in two passes because (definition, stepOrder) is unique: moving
   * everything into a range nothing occupies first means no intermediate state
   * collides.
   */
  private async renumber(
    tx: Pick<PrismaService['client'], 'workflowStep'>,
    definitionId: string,
  ): Promise<void> {
    const steps = await tx.workflowStep.findMany({
      where: { workflowDefinitionId: definitionId },
      orderBy: { stepOrder: 'asc' },
      select: { id: true },
    });
    await this.writeOrder(
      tx,
      steps.map((step) => step.id),
    );
  }

  /** Assign stepOrder 1..n in the order given; two passes, see renumber. */
  private async writeOrder(
    tx: Pick<PrismaService['client'], 'workflowStep'>,
    orderedIds: readonly string[],
  ): Promise<void> {
    const PARK = 1000;
    for (const [index, id] of orderedIds.entries()) {
      await tx.workflowStep.update({ where: { id }, data: { stepOrder: PARK + index } });
    }
    for (const [index, id] of orderedIds.entries()) {
      await tx.workflowStep.update({ where: { id }, data: { stepOrder: index + 1 } });
    }
  }

  /**
   * Write the whole chain from an approval order, with the assessment pair
   * re-placed by its rule. Every structural change ends here so the pair can
   * never be split or stranded by one of them.
   */
  private async applyOrder(
    tx: Pick<PrismaService['client'], 'workflowStep'>,
    definitionId: string,
    approvalIdsInOrder: readonly string[],
  ): Promise<void> {
    const steps = await tx.workflowStep.findMany({
      where: { workflowDefinitionId: definitionId },
      select: { id: true, kind: true, costThreshold: true },
    });
    const byId = new Map(steps.map((step) => [step.id, step]));
    const approvals = approvalIdsInOrder
      .map((id) => byId.get(id))
      .filter((step): step is NonNullable<typeof step> => Boolean(step))
      .map((step) => ({
        id: step.id,
        kind: step.kind,
        costThreshold: step.costThreshold ? step.costThreshold.toString() : null,
      }));
    const stages = steps
      .filter((step) => step.kind !== 'APPROVAL')
      .map((step) => ({ id: step.id, kind: step.kind, costThreshold: null }));
    await this.writeOrder(
      tx,
      orderWorkflowSteps(approvals, stages).map((step) => step.id),
    );
  }

  private async findDefinition(actor: AuthUser, definitionId: string) {
    const definition = await this.prisma.client.workflowDefinition.findFirst({
      where: { id: definitionId, companyId: actor.companyId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!definition) throw AppError.notFound('Workflow', definitionId);
    return definition;
  }

  /**
   * Add an approval step (v2.28).
   *
   * `position` counts among the approval steps only; the assessment pair then
   * lands wherever the rule puts it, which may be before the new step if it
   * is the first to carry a threshold. Reaches requests raised from now on -
   * nothing is inserted into a chain already in flight.
   */
  async addStep(actor: AuthUser, definitionId: string, input: CreateWorkflowStepInput) {
    const definition = await this.findDefinition(actor, definitionId);

    let approverRoleId: string | null = null;
    if (input.approverType === 'ROLE') {
      const role = await this.prisma.client.role.findFirst({
        where: { companyId: actor.companyId, key: input.approverRoleKey ?? '' },
        select: { id: true },
      });
      if (!role) throw AppError.notFound('Role', input.approverRoleKey);
      approverRoleId = role.id;
    }

    const approvalIds = definition.steps.filter((s) => s.kind === 'APPROVAL').map((s) => s.id);
    // Past the end reads as "last" rather than as an error: the page offers
    // "After: <step>", and a step removed by somebody else in the meantime
    // should not turn that into a refusal.
    const at = Math.min((input.position ?? approvalIds.length + 1) - 1, approvalIds.length);

    const created = await this.prisma.client.$transaction(async (tx) => {
      const step = await tx.workflowStep.create({
        data: {
          workflowDefinitionId: definitionId,
          // Parked clear of both the live range and renumber's own parking
          // lot; applyOrder assigns the real number.
          stepOrder: 5000 + definition.steps.length,
          name: input.name,
          kind: 'APPROVAL',
          approverType: input.approverType,
          approverRoleId,
          costThreshold: input.costThreshold ? new Prisma.Decimal(input.costThreshold) : null,
          slaHours: input.slaHours ?? null,
        },
      });
      approvalIds.splice(at, 0, step.id);
      await this.applyOrder(tx, definitionId, approvalIds);
      return step;
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'WorkflowStep',
      entityId: created.id,
      newValues: {
        workflow: definition.name,
        step: input.name,
        added: true,
        position: at + 1,
        approverType: input.approverType,
        approverRoleId,
        costThreshold: input.costThreshold ?? null,
        slaHours: input.slaHours ?? null,
      },
    });

    return this.list(actor);
  }

  /**
   * Remove an approval step (v2.28).
   *
   * Reaches the requests still in approval too: a queued copy of the step is
   * deleted, the copy currently awaiting a decision is skipped and the chain
   * moves on. Decided copies are history and stay.
   */
  async removeStep(actor: AuthUser, stepId: string) {
    const step = await this.prisma.client.workflowStep.findFirst({
      where: { id: stepId, workflowDefinition: { companyId: actor.companyId } },
      include: {
        workflowDefinition: {
          select: { id: true, name: true, steps: { orderBy: { stepOrder: 'asc' } } },
        },
      },
    });
    if (!step) throw AppError.notFound('Workflow step', stepId);

    if (step.kind !== 'APPROVAL') {
      throw new AppError(
        'VALIDATION_FAILED',
        'The inventory check and cost assessment leave together - use "Remove stages" on the workflow.',
      );
    }
    const remaining = step.workflowDefinition.steps.filter(
      (s) => s.kind === 'APPROVAL' && s.id !== step.id,
    );
    if (remaining.length === 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        'A workflow needs at least one approval step. Add another before removing this one.',
      );
    }
    if (step.isEnabled && !remaining.some((s) => s.isEnabled)) {
      throw new AppError(
        'VALIDATION_FAILED',
        'This is the only step still switched on. Switch another on before removing it.',
      );
    }

    const reach = await this.prisma.client.$transaction(async (tx) => {
      await tx.workflowStep.delete({ where: { id: step.id } });
      await this.applyOrder(
        tx,
        step.workflowDefinitionId,
        remaining.map((s) => s.id),
      );
      return this.requests.retireStepFromInFlight(tx, {
        companyId: actor.companyId,
        workflowDefinitionId: step.workflowDefinitionId,
        stepName: step.name,
        approverType: step.approverType,
        approverRoleId: step.approverRoleId,
        reason: RETIRED_REASON,
      });
    }, RETIRE_TX);
    await this.finishRetired(actor, reach.advanced);

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'WorkflowStep',
      entityId: step.id,
      previousValues: {
        workflow: step.workflowDefinition.name,
        step: step.name,
        stepOrder: step.stepOrder,
        approverType: step.approverType,
        approverRoleId: step.approverRoleId,
        costThreshold: step.costThreshold ? step.costThreshold.toString() : null,
      },
      // Says how far the change reached: the queued copies deleted and the
      // requests moved on past the step.
      newValues: {
        removed: true,
        inFlightRemoved: reach.removed,
        inFlightSkipped: reach.advanced.length,
      },
    });

    return this.list(actor);
  }

  /**
   * Reorder the approval steps (v2.28). The list must name every approval
   * step exactly once; the assessment pair follows its rule.
   */
  async reorderSteps(actor: AuthUser, definitionId: string, input: ReorderWorkflowStepsInput) {
    const definition = await this.findDefinition(actor, definitionId);
    const approvals = definition.steps.filter((s) => s.kind === 'APPROVAL');
    if (!isCompleteReorder(input.stepIds, approvals)) {
      throw new AppError(
        'VALIDATION_FAILED',
        'The order must name every approval step in this workflow exactly once.',
      );
    }

    await this.prisma.client.$transaction(async (tx) => {
      await this.applyOrder(tx, definitionId, input.stepIds);
    });

    const nameOf = new Map(definition.steps.map((s) => [s.id, s.name]));
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'WorkflowDefinition',
      entityId: definitionId,
      previousValues: { workflow: definition.name, order: approvals.map((s) => s.name) },
      newValues: { order: input.stepIds.map((id) => nameOf.get(id) ?? id) },
    });

    return this.list(actor);
  }

  async updateStep(actor: AuthUser, stepId: string, input: UpdateWorkflowStepInput) {
    // Scoped through the definition: a step id from another tenant must read as
    // missing, not as forbidden.
    const step = await this.prisma.client.workflowStep.findFirst({
      where: { id: stepId, workflowDefinition: { companyId: actor.companyId } },
      include: { workflowDefinition: { select: { name: true } } },
    });
    if (!step) throw AppError.notFound('Workflow step', stepId);

    const data: Prisma.WorkflowStepUpdateInput = {};
    // A rename reaches future requests only: the rows already in flight carry
    // the name they were built with, and rewriting history is not the job.
    if (input.name !== undefined) data.name = input.name;
    if (input.costThreshold !== undefined) {
      data.costThreshold =
        input.costThreshold === null ? null : new Prisma.Decimal(input.costThreshold);
    }
    if (input.isSkippable !== undefined) data.isSkippable = input.isSkippable;
    if (input.slaHours !== undefined) data.slaHours = input.slaHours;

    // The On/Off switch (v2.28). Off leaves the step out of the next chain
    // built AND takes it out of the requests still in approval; on reaches
    // new requests only - nothing is re-inserted. The stages are not
    // switchable - they hold the request until answered - and the last step
    // still on stays on.
    let switchingOff = false;
    if (input.isEnabled !== undefined && input.isEnabled !== step.isEnabled) {
      if (step.kind !== 'APPROVAL') {
        throw new AppError(
          'VALIDATION_FAILED',
          'The inventory check and cost assessment are added or removed together, not switched off.',
        );
      }
      if (!input.isEnabled) {
        const othersOn = await this.prisma.client.workflowStep.count({
          where: {
            workflowDefinitionId: step.workflowDefinitionId,
            kind: 'APPROVAL',
            isEnabled: true,
            id: { not: step.id },
          },
        });
        if (othersOn === 0) {
          throw new AppError(
            'VALIDATION_FAILED',
            'This is the only step still switched on. A workflow needs one, so switch another on first.',
          );
        }
        switchingOff = true;
      }
      data.isEnabled = input.isEnabled;
    }

    let newRoleId: string | null = null;
    if (input.approverRoleKey !== undefined) {
      const role = await this.prisma.client.role.findFirst({
        where: { companyId: actor.companyId, key: input.approverRoleKey },
        select: { id: true, key: true, name: true },
      });
      if (!role) throw AppError.notFound('Role', input.approverRoleKey);
      newRoleId = role.id;
      data.approverRole = { connect: { id: role.id } };
      // A step pointed at a role is a ROLE step, whatever it was before -
      // otherwise the resolver keeps reading it as LINE_MANAGER and ignores the
      // role that was just chosen.
      data.approverType = 'ROLE';
    }

    // The setting and its reach into in-flight requests commit together.
    const { updated, reach } = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.workflowStep.update({ where: { id: stepId }, data });
      const retired = switchingOff
        ? await this.requests.retireStepFromInFlight(tx, {
            companyId: actor.companyId,
            workflowDefinitionId: step.workflowDefinitionId,
            stepName: step.name,
            approverType: step.approverType,
            approverRoleId: step.approverRoleId,
            reason: RETIRED_REASON,
          })
        : { removed: 0, advanced: [] };
      return { updated: row, reach: retired };
    }, RETIRE_TX);
    await this.finishRetired(actor, reach.advanced);

    /**
     * Re-point the requests already in flight (v2.26).
     *
     * A chain is snapshotted when a request is submitted, so changing the
     * definition alone would only affect future requests - the ones already
     * waiting would keep pointing at the old role, and the person who was just
     * given the job still would not see them. That is precisely the confusion
     * this change exists to end.
     *
     * Only steps nobody has decided yet, only requests raised from THIS
     * workflow, and only those still carrying the role we are moving away from:
     * a chain somebody has already redirected by hand is left alone, and no
     * decision already taken is rewritten.
     */
    let movedInFlight = 0;
    if (newRoleId && step.approverRoleId !== newRoleId) {
      const moved = await this.prisma.client.requestApproval.updateMany({
        where: {
          stepName: step.name,
          decision: { in: ['WAITING', 'PENDING'] },
          approverRoleId: step.approverRoleId,
          request: {
            companyId: actor.companyId,
            workflowDefinitionId: step.workflowDefinitionId,
          },
        },
        data: { approverRoleId: newRoleId },
      });
      movedInFlight = moved.count;
    }

    // Changing who has to approve what is a governance change; it leaves the
    // same trail a role change does.
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'WorkflowStep',
      entityId: stepId,
      previousValues: {
        workflow: step.workflowDefinition.name,
        step: step.name,
        costThreshold: step.costThreshold ? step.costThreshold.toString() : null,
        isSkippable: step.isSkippable,
        isEnabled: step.isEnabled,
        slaHours: step.slaHours,
        approverRoleId: step.approverRoleId,
        approverType: step.approverType,
      },
      newValues: {
        step: updated.name,
        costThreshold: updated.costThreshold ? updated.costThreshold.toString() : null,
        isSkippable: updated.isSkippable,
        isEnabled: updated.isEnabled,
        slaHours: updated.slaHours,
        approverRoleId: updated.approverRoleId,
        approverType: updated.approverType,
        // Says how far the change reached, so the trail shows the requests it
        // moved and not just the setting it changed.
        inFlightRequestsMoved: movedInFlight,
        inFlightRemoved: reach.removed,
        inFlightSkipped: reach.advanced.length,
      },
    });

    return this.list(actor);
  }
}
