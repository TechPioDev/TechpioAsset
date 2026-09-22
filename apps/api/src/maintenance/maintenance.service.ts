import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type {
  ApproveWorkOrderInput,
  AssignWorkOrderInput,
  AuthUser,
  ConsumePartInput,
  CreateMaintenanceInput,
  CreateMaintenanceScheduleInput,
  MaintenanceListQuery,
  UpdateMaintenanceScheduleInput,
} from '@techpioasset/contracts';
import {
  PERMISSIONS,
  advanceSchedule,
  assertTransition,
  maintenanceStatusMachine,
  repairRecommendation,
  signoffRefusal,
  type MaintenanceStatus,
  type SignoffAction,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { paginate } from '../common/paginate.js';
import { canSeeCost, tenantFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StockService } from '../stock/stock.service.js';
import { OPEN_MAINTENANCE } from '../dashboard/dashboard.service.js';

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly stock: StockService,
  ) {}

  async list(actor: AuthUser, query: MaintenanceListQuery) {
    const where: Prisma.MaintenanceRecordWhereInput = {
      asset: tenantFilter(actor),
      ...(query.status ? { status: query.status } : {}),
      ...(query.open ? { status: { in: [...OPEN_MAINTENANCE] } } : {}),
      ...(query.assetId ? { assetId: query.assetId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.technicianId ? { technicianId: query.technicianId } : {}),
    };

    const showCost = canSeeCost(actor);
    return paginate(query, {
      count: () => this.prisma.client.maintenanceRecord.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.maintenanceRecord.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            status: true,
            title: true,
            scheduledFor: true,
            completedAt: true,
            replacementRecommended: true,
            technicianId: true,
            acceptedAt: true,
            acceptedById: true,
            completedById: true,
            slaDueAt: true,
            escalatedAt: true,
            createdAt: true,
            // Cost is omitted from the query for actors without cost permission.
            serviceCost: showCost,
            currency: showCost,
            downtimeHours: showCost,
            asset: { select: { id: true, assetTag: true, name: true } },
            vendor: { select: { id: true, name: true } },
          },
        }),
    });
  }

  async findOne(actor: AuthUser, id: string) {
    const showCost = canSeeCost(actor);
    const record = await this.prisma.client.maintenanceRecord.findFirst({
      where: { id, asset: tenantFilter(actor) },
      select: {
        id: true,
        type: true,
        status: true,
        title: true,
        description: true,
        isInternal: true,
        scheduledFor: true,
        startedAt: true,
        completedAt: true,
        resolutionNotes: true,
        replacementRecommended: true,
        recommendationNote: true,
        technicianId: true,
        acceptedAt: true,
        acceptedById: true,
        completedById: true,
        approvedAt: true,
        approvedById: true,
        sendBackReason: true,
        restoreAssetOnApproval: true,
        slaDueAt: true,
        escalatedAt: true,
        diagnosis: true,
        serviceCost: showCost,
        currency: showCost,
        downtimeHours: showCost,
        createdAt: true,
        asset: {
          select: { id: true, assetTag: true, name: true, status: true, purchaseCost: showCost },
        },
        vendor: { select: { id: true, name: true } },
      },
    });
    if (!record) throw AppError.notFound('Maintenance record', id);

    // The parts drawn against this order, straight from the v2.4 ledger - the
    // movement rows ARE the consumption record, no second bookkeeping.
    const parts = await this.stock.partsForWorkOrder(actor.companyId, id);
    return { ...record, parts };
  }

  async create(actor: AuthUser, input: CreateMaintenanceInput) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id: input.assetId, ...tenantFilter(actor) },
      select: { id: true, status: true },
    });
    if (!asset) throw AppError.notFound('Asset', input.assetId);

    const record = await this.prisma.client.maintenanceRecord.create({
      data: {
        assetId: input.assetId,
        type: input.type,
        status: input.scheduledFor ? 'SCHEDULED' : 'REQUESTED',
        title: input.title,
        description: input.description ?? null,
        requestedById: actor.id,
        vendorId: input.vendorId ?? null,
        isInternal: input.isInternal,
        scheduledFor: input.scheduledFor ?? null,
        createdById: actor.id,
      },
      select: { id: true },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_UPDATED,
      entityType: 'MaintenanceRecord',
      entityId: record.id,
      newValues: { assetId: input.assetId, type: input.type, title: input.title },
    });

    return this.findOne(actor, record.id);
  }

  async schedule(actor: AuthUser, id: string, scheduledFor: Date) {
    const record = await this.loadForWrite(actor, id);
    assertTransition(maintenanceStatusMachine, record.status as MaintenanceStatus, 'SCHEDULED');

    await this.prisma.client.maintenanceRecord.update({
      where: { id },
      data: { status: 'SCHEDULED', scheduledFor, updatedById: actor.id },
    });

    // Tell whoever raised it that a date is set.
    if (record.requestedById) {
      await this.notifications.notify({
        companyId: actor.companyId,
        userId: record.requestedById,
        type: 'MAINTENANCE_DUE',
        title: `Maintenance scheduled: ${record.title}`,
        body: `Scheduled for ${scheduledFor.toDateString()}.`,
        linkPath: `/maintenance/${id}`,
        entityType: 'MaintenanceRecord',
        entityId: id,
      });
    }

    return this.findOne(actor, id);
  }

  /**
   * Starts work: moves the record IN_PROGRESS and takes the asset UNDER_REPAIR,
   * so the asset's own status reflects that it is out of service.
   */
  async start(actor: AuthUser, id: string) {
    const record = await this.loadForWrite(actor, id);
    if (record.status === 'AWAITING_APPROVAL') {
      // Reopening finished work is a manager's send-back, with a reason.
      throw AppError.conflict(
        'CONFLICT',
        'This work order is awaiting approval. Send it back to reopen it.',
      );
    }
    assertTransition(maintenanceStatusMachine, record.status as MaintenanceStatus, 'IN_PROGRESS');
    this.assertSignoff('start', record, actor);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.maintenanceRecord.update({
        where: { id },
        data: { status: 'IN_PROGRESS', startedAt: new Date(), updatedById: actor.id },
      });
      // Only move the asset if the transition is legal from its current status.
      const asset = await tx.asset.findUnique({
        where: { id: record.assetId },
        select: { status: true },
      });
      if (asset && asset.status !== 'UNDER_REPAIR') {
        try {
          const { assetStatusMachine, assertTransition: at } = await import('@techpioasset/domain');
          at(assetStatusMachine, asset.status, 'UNDER_REPAIR');
          await tx.asset.update({
            where: { id: record.assetId },
            data: { status: 'UNDER_REPAIR', updatedById: actor.id, version: { increment: 1 } },
          });
        } catch {
          // Asset cannot legally go under repair from its current state; leave it.
        }
      }
    });

    return this.findOne(actor, id);
  }

  /**
   * The technician finishes: records the outcome and sends the order for
   * sign-off (AWAITING_APPROVAL). The asset stays under repair until a manager
   * approves - the restore-to-service choice is kept and applied then.
   */
  async complete(
    actor: AuthUser,
    id: string,
    input: {
      serviceCost?: string | null;
      currency?: string | null;
      downtimeHours?: string | null;
      resolutionNotes?: string | null;
      replacementRecommended: boolean;
      recommendationNote?: string | null;
      restoreAsset: boolean;
    },
  ) {
    const record = await this.loadForWrite(actor, id);
    assertTransition(
      maintenanceStatusMachine,
      record.status as MaintenanceStatus,
      'AWAITING_APPROVAL',
    );

    await this.prisma.client.maintenanceRecord.update({
      where: { id },
      data: {
        status: 'AWAITING_APPROVAL',
        // When the work was done - repair-cycle figures measure this, not how
        // long the sign-off took.
        completedAt: new Date(),
        completedById: actor.id,
        serviceCost: input.serviceCost ? new Prisma.Decimal(input.serviceCost) : null,
        currency: input.currency ?? null,
        downtimeHours: input.downtimeHours ? new Prisma.Decimal(input.downtimeHours) : null,
        resolutionNotes: input.resolutionNotes ?? null,
        replacementRecommended: input.replacementRecommended,
        recommendationNote: input.recommendationNote ?? null,
        restoreAssetOnApproval: input.restoreAsset,
        updatedById: actor.id,
      },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_UPDATED,
      entityType: 'MaintenanceRecord',
      entityId: id,
      previousValues: { status: record.status },
      newValues: { status: 'AWAITING_APPROVAL', serviceCost: input.serviceCost ?? null },
    });

    await this.notifyApprovers(actor, { id, title: record.title });
    return this.findOne(actor, id);
  }

  /**
   * A manager signs the work off: COMPLETED (shown as "Closed"). The asset goes
   * back into service here, not at completion, because this is when the repair
   * is confirmed - a job that gets sent back must not have left a half-fixed
   * device AVAILABLE in the meantime.
   */
  async approve(actor: AuthUser, id: string, input: ApproveWorkOrderInput) {
    const record = await this.loadForWrite(actor, id);
    this.assertSignoff('approve', record, actor);
    assertTransition(maintenanceStatusMachine, record.status as MaintenanceStatus, 'COMPLETED');

    const restore = input.restoreAsset ?? record.restoreAssetOnApproval ?? true;
    await this.prisma.client.$transaction(async (tx) => {
      await tx.maintenanceRecord.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          approvedAt: new Date(),
          approvedById: actor.id,
          updatedById: actor.id,
        },
      });

      // Restore the asset if requested and legal - the rule completion used
      // to apply: only an asset that is UNDER_REPAIR. v2.75: back to the
      // person who still holds it (ASSIGNED), and to the shelf (AVAILABLE)
      // only when nobody does. It used to go AVAILABLE either way, which left
      // a laptop repaired at its holder's desk shown as available and
      // assigned in the same row; the database now refuses that row.
      if (restore) {
        const asset = await tx.asset.findUnique({
          where: { id: record.assetId },
          select: { status: true, assignedUserId: true },
        });
        if (asset?.status === 'UNDER_REPAIR') {
          await tx.asset.update({
            where: { id: record.assetId },
            data: {
              status: asset.assignedUserId ? 'ASSIGNED' : 'AVAILABLE',
              condition: 'GOOD',
              updatedById: actor.id,
              version: { increment: 1 },
            },
          });
        }
      }
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_UPDATED,
      entityType: 'MaintenanceRecord',
      entityId: id,
      previousValues: { status: record.status },
      newValues: { status: 'COMPLETED', approvedById: actor.id, restoreAsset: restore },
      reason: 'Work order approved',
    });

    await this.notifyDoer(actor, record, {
      type: 'WORK_ORDER_APPROVED',
      title: `Work order approved: ${record.title}`,
      body: 'Your work was signed off and the work order is closed.',
    });
    return this.findOne(actor, id);
  }

  /** A manager reopens completed work, with a reason the technician will see. */
  async sendBack(actor: AuthUser, id: string, reason: string) {
    const record = await this.loadForWrite(actor, id);
    this.assertSignoff('sendBack', record, actor);
    assertTransition(maintenanceStatusMachine, record.status as MaintenanceStatus, 'IN_PROGRESS');

    await this.prisma.client.maintenanceRecord.update({
      where: { id },
      data: {
        status: 'IN_PROGRESS',
        sendBackReason: reason,
        // Visible in the order's own history, the way a hold reason is.
        diagnosis: record.diagnosis
          ? `${record.diagnosis}\n[Sent back] ${reason}`
          : `[Sent back] ${reason}`,
        // The work is not finished after all; the next completion restamps
        // both (and so decides who may approve that attempt).
        completedAt: null,
        completedById: null,
        updatedById: actor.id,
      },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_UPDATED,
      entityType: 'MaintenanceRecord',
      entityId: id,
      previousValues: { status: record.status },
      newValues: { status: 'IN_PROGRESS', sendBackReason: reason },
      reason,
    });

    await this.notifyDoer(actor, record, {
      type: 'WORK_ORDER_SENT_BACK',
      title: `Work order sent back: ${record.title}`,
      body: reason,
    });
    return this.findOne(actor, id);
  }

  /**
   * The assigned technician takes the job on (the phone's "Acknowledge"). Work
   * cannot start on an assigned job until this is recorded.
   */
  async accept(actor: AuthUser, id: string) {
    const record = await this.loadForWrite(actor, id);
    this.assertSignoff('accept', record, actor);

    await this.prisma.client.maintenanceRecord.update({
      where: { id },
      data: { acceptedAt: new Date(), acceptedById: actor.id, updatedById: actor.id },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_UPDATED,
      entityType: 'MaintenanceRecord',
      entityId: id,
      newValues: { acceptedById: actor.id },
      reason: 'Work order accepted by the technician',
    });
    return this.findOne(actor, id);
  }

  async cancel(actor: AuthUser, id: string, reason?: string | null) {
    const record = await this.loadForWrite(actor, id);
    assertTransition(maintenanceStatusMachine, record.status as MaintenanceStatus, 'CANCELLED');
    await this.prisma.client.maintenanceRecord.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        ...(reason
          ? {
              diagnosis: record.diagnosis
                ? `${record.diagnosis}\n[Cancelled] ${reason}`
                : `[Cancelled] ${reason}`,
            }
          : {}),
        updatedById: actor.id,
      },
    });
    // Cancelling ends the job, so it is audited like every other transition.
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_UPDATED,
      entityType: 'MaintenanceRecord',
      entityId: id,
      previousValues: { status: record.status },
      newValues: { status: 'CANCELLED' },
      ...(reason ? { reason } : {}),
    });
    return this.findOne(actor, id);
  }

  /**
   * Repair-vs-replace guidance for one asset (spec section 14). Available only to
   * cost-permitted actors, since it exposes financial figures.
   */
  async repairAdvice(actor: AuthUser, assetId: string, repairCost: string) {
    if (!canSeeCost(actor)) throw AppError.forbidden('You may not view cost comparisons');
    const asset = await this.prisma.client.asset.findFirst({
      where: { id: assetId, ...tenantFilter(actor) },
      select: { purchaseCost: true, currentValue: true },
    });
    if (!asset) throw AppError.notFound('Asset', assetId);

    const replacement = asset.currentValue ?? asset.purchaseCost ?? new Prisma.Decimal(0);
    return repairRecommendation({ repairCost, replacementCost: replacement.toString() });
  }

  // ── v2.5 work orders (plan section H3) ─────────────────────────────────────

  /** Put a technician on the job, optionally with an SLA deadline. */
  async assign(actor: AuthUser, id: string, input: AssignWorkOrderInput) {
    const record = await this.loadForWrite(actor, id);
    if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(record.status)) {
      throw AppError.conflict('CONFLICT', 'This work order is closed and cannot be reassigned.');
    }
    if (record.status === 'AWAITING_APPROVAL') {
      // The work is done; a new technician would have nothing to accept.
      throw AppError.conflict(
        'CONFLICT',
        'This work order is awaiting approval. Send it back before reassigning it.',
      );
    }
    const technician = await this.prisma.client.user.findFirst({
      where: { id: input.technicianId, companyId: actor.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!technician) throw AppError.notFound('User', input.technicianId);

    await this.prisma.client.maintenanceRecord.update({
      where: { id },
      data: {
        technicianId: input.technicianId,
        // Acceptance belongs to a person: a different technician must accept
        // afresh. Re-saving the same technician (say, a new SLA) keeps it.
        ...(input.technicianId !== record.technicianId
          ? { acceptedAt: null, acceptedById: null }
          : {}),
        // A reassignment may bring a new deadline; a fresh SLA also re-arms
        // escalation (the old escalation belonged to the old deadline).
        ...(input.slaDueAt !== undefined
          ? { slaDueAt: input.slaDueAt, escalatedAt: null }
          : {}),
        updatedById: actor.id,
      },
    });

    await this.notifications.notify({
      companyId: actor.companyId,
      userId: input.technicianId,
      type: 'WORK_ORDER_ASSIGNED',
      title: `Work order assigned: ${record.title}`,
      body: input.slaDueAt
        ? `Due by ${new Date(input.slaDueAt).toDateString()}.`
        : 'No SLA deadline set.',
      linkPath: `/maintenance/${id}`,
      entityType: 'MaintenanceRecord',
      entityId: id,
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_UPDATED,
      entityType: 'MaintenanceRecord',
      entityId: id,
      newValues: { technicianId: input.technicianId, slaDueAt: input.slaDueAt ?? null },
    });
    return this.findOne(actor, id);
  }

  /** Record what the technician found. Editable while the order is open. */
  async setDiagnosis(actor: AuthUser, id: string, diagnosis: string) {
    const record = await this.loadForWrite(actor, id);
    if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(record.status)) {
      throw AppError.conflict('CONFLICT', 'This work order is closed.');
    }
    await this.prisma.client.maintenanceRecord.update({
      where: { id },
      data: { diagnosis, updatedById: actor.id },
    });
    return this.findOne(actor, id);
  }

  /** Pause in-progress work (waiting on a part, the user, a vendor). */
  async hold(actor: AuthUser, id: string, reason?: string | null) {
    const record = await this.loadForWrite(actor, id);
    assertTransition(maintenanceStatusMachine, record.status as MaintenanceStatus, 'ON_HOLD');
    await this.prisma.client.maintenanceRecord.update({
      where: { id },
      data: {
        status: 'ON_HOLD',
        ...(reason
          ? { diagnosis: record.diagnosis ? `${record.diagnosis}\n[On hold] ${reason}` : `[On hold] ${reason}` }
          : {}),
        updatedById: actor.id,
      },
    });
    return this.findOne(actor, id);
  }

  /** Resume held work. */
  async resume(actor: AuthUser, id: string) {
    const record = await this.loadForWrite(actor, id);
    assertTransition(maintenanceStatusMachine, record.status as MaintenanceStatus, 'IN_PROGRESS');
    if (record.status !== 'ON_HOLD') {
      // Only a held order resumes; starting fresh goes through start().
      throw AppError.conflict('CONFLICT', 'Only a held work order can resume.');
    }
    // Reassigned while held: the new technician accepts before work restarts.
    this.assertSignoff('resume', record, actor);
    await this.prisma.client.maintenanceRecord.update({
      where: { id },
      data: { status: 'IN_PROGRESS', updatedById: actor.id },
    });
    return this.findOne(actor, id);
  }

  /**
   * Draw a part from stock for this work order — the v2.4 guarded take with the
   * work-order reference on the ledger row. Refusals carry the honest numbers.
   */
  async consumePart(actor: AuthUser, id: string, input: ConsumePartInput) {
    const record = await this.loadForWrite(actor, id);
    if (!['IN_PROGRESS', 'ON_HOLD'].includes(record.status)) {
      throw AppError.conflict(
        'CONFLICT',
        'Parts can only be drawn while work is in progress or on hold.',
      );
    }
    const level = await this.stock.consumeForWorkOrder(actor, {
      inventoryItemId: input.inventoryItemId,
      stockLocationId: input.stockLocationId,
      quantity: input.quantity,
      workOrderId: id,
      note: input.note ?? null,
    });
    return { level, parts: await this.stock.partsForWorkOrder(actor.companyId, id) };
  }

  // ── preventive schedules ───────────────────────────────────────────────────

  async listSchedules(actor: AuthUser, assetId?: string) {
    return this.prisma.client.maintenanceSchedule.findMany({
      where: { companyId: actor.companyId, ...(assetId ? { assetId } : {}) },
      orderBy: { nextDueAt: 'asc' },
      include: { asset: { select: { id: true, assetTag: true, name: true } } },
    });
  }

  async createSchedule(actor: AuthUser, input: CreateMaintenanceScheduleInput) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id: input.assetId, ...tenantFilter(actor) },
      select: { id: true },
    });
    if (!asset) throw AppError.notFound('Asset', input.assetId);
    return this.prisma.client.maintenanceSchedule.create({
      data: {
        companyId: actor.companyId,
        assetId: input.assetId,
        title: input.title,
        intervalDays: input.intervalDays,
        nextDueAt:
          input.firstDueAt ?? new Date(Date.now() + input.intervalDays * 86_400_000),
        createdById: actor.id,
      },
    });
  }

  async updateSchedule(actor: AuthUser, id: string, input: UpdateMaintenanceScheduleInput) {
    const schedule = await this.prisma.client.maintenanceSchedule.findFirst({
      where: { id, companyId: actor.companyId },
    });
    if (!schedule) throw AppError.notFound('Maintenance schedule', id);
    return this.prisma.client.maintenanceSchedule.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.intervalDays !== undefined ? { intervalDays: input.intervalDays } : {}),
        ...(input.nextDueAt !== undefined ? { nextDueAt: input.nextDueAt } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  /**
   * Spawn work orders for due schedules. Called by the daily sweep; idempotent
   * because the due date advances (strictly future) in the same transaction as
   * the spawn — a re-run finds nothing due.
   */
  async spawnDueSchedules(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.client.maintenanceSchedule.findMany({
      where: { isActive: true, nextDueAt: { lte: now } },
      include: { asset: { select: { id: true, deletedAt: true } } },
    });
    let spawned = 0;
    for (const schedule of due) {
      if (schedule.asset.deletedAt) continue; // the asset is gone; leave the schedule to be deactivated
      await this.prisma.client.$transaction(async (tx) => {
        await tx.maintenanceRecord.create({
          data: {
            assetId: schedule.assetId,
            type: 'SCHEDULED',
            status: 'SCHEDULED',
            title: schedule.title,
            description: `Preventive maintenance (every ${schedule.intervalDays} day(s)).`,
            scheduledFor: schedule.nextDueAt,
            requestedById: schedule.createdById,
            createdById: schedule.createdById,
          },
        });
        await tx.maintenanceSchedule.update({
          where: { id: schedule.id },
          data: {
            lastCreatedAt: now,
            nextDueAt: advanceSchedule(schedule.nextDueAt, schedule.intervalDays, now),
          },
        });
      });
      spawned += 1;
    }
    return spawned;
  }

  /** The shared sign-off rules (packages/domain), raised as API errors. */
  private assertSignoff(
    action: SignoffAction,
    record: {
      status: string;
      technicianId: string | null;
      acceptedById: string | null;
      completedById: string | null;
    },
    actor: AuthUser,
  ) {
    const refusal = signoffRefusal(action, record, actor.id);
    if (!refusal) return;
    throw refusal.kind === 'forbidden'
      ? AppError.forbidden(refusal.message)
      : AppError.conflict('CONFLICT', refusal.message);
  }

  /**
   * Completion tells whoever can sign it off: the company's active maintenance
   * managers, minus the person who completed it (they may not approve).
   */
  private async notifyApprovers(actor: AuthUser, order: { id: string; title: string }) {
    const managers = await this.prisma.client.userRole.findMany({
      where: {
        role: {
          companyId: actor.companyId,
          permissions: { some: { permission: { key: PERMISSIONS.MAINTENANCE_MANAGE } } },
        },
        user: { deletedAt: null, status: 'ACTIVE' },
      },
      select: { userId: true },
      distinct: ['userId'],
      take: 50,
    });
    await this.notifications.notifyMany(
      managers.map((m) => m.userId).filter((userId) => userId !== actor.id),
      {
        companyId: actor.companyId,
        type: 'WORK_ORDER_AWAITING_APPROVAL',
        title: `Work order awaiting approval: ${order.title}`,
        body: 'The work is complete. Approve it to close the order, or send it back with a reason.',
        linkPath: `/maintenance/${order.id}`,
        entityType: 'MaintenanceRecord',
        entityId: order.id,
      },
    );
  }

  /** Approval and send-back tell the person who did the work (not the decider). */
  private async notifyDoer(
    actor: AuthUser,
    record: { id: string; completedById: string | null; technicianId: string | null },
    message: {
      type: 'WORK_ORDER_APPROVED' | 'WORK_ORDER_SENT_BACK';
      title: string;
      body: string;
    },
  ) {
    const recipients = new Set(
      [record.completedById, record.technicianId].filter(
        (userId): userId is string => userId !== null && userId !== actor.id,
      ),
    );
    await this.notifications.notifyMany([...recipients], {
      companyId: actor.companyId,
      ...message,
      linkPath: `/maintenance/${record.id}`,
      entityType: 'MaintenanceRecord',
      entityId: record.id,
    });
  }

  private async loadForWrite(actor: AuthUser, id: string) {
    const record = await this.prisma.client.maintenanceRecord.findFirst({
      where: { id, asset: tenantFilter(actor) },
    });
    if (!record) throw AppError.notFound('Maintenance record', id);
    return record;
  }
}
