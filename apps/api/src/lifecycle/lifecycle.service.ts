import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type { AuthUser } from '@techpioasset/contracts';
import { ASSET_STATUSES_BLOCKING_OFFBOARDING, type AssetStatus } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { tenantFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface OutstandingAsset {
  assetId: string;
  assetTag: string;
  name: string;
  status: AssetStatus;
  assignmentId: string | null;
}

/**
 * Onboarding and offboarding (spec section 13).
 *
 * The rule that shapes this module: "Offboarding cannot be marked fully completed
 * until every required asset has an outcome or approved exception." That is
 * enforced server-side at completion time, not merely surfaced as a checklist —
 * a UI hint would be bypassable by anyone calling the API directly.
 */
@Injectable()
export class LifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Onboarding
  // ───────────────────────────────────────────────────────────────────────────

  async startOnboarding(actor: AuthUser, subjectUserId: string, templateKey?: string) {
    // Validates existence and tenancy; the record itself is not needed here.
    await this.requireSubject(actor, subjectUserId);

    const template = templateKey
      ? await this.prisma.client.onboardingTemplate.findFirst({
          where: { companyId: actor.companyId, key: templateKey, isActive: true },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        })
      : null;

    if (templateKey && !template) throw AppError.notFound('Onboarding template', templateKey);

    const existing = await this.prisma.client.onboardingTask.findFirst({
      where: { companyId: actor.companyId, subjectUserId, direction: 'ONBOARDING', status: 'OPEN' },
    });
    if (existing) {
      throw new AppError('CONFLICT', 'This employee already has onboarding in progress');
    }

    const task = await this.prisma.client.onboardingTask.create({
      data: {
        companyId: actor.companyId,
        templateId: template?.id ?? null,
        subjectUserId,
        direction: 'ONBOARDING',
        status: 'OPEN',
        createdById: actor.id,
        checklistJson: template
          ? (template.items.map((item) => ({
              description: item.description,
              quantity: item.quantity.toString(),
              isRequired: item.isRequired,
              categoryId: item.categoryId,
              fulfilled: false,
            })) as Prisma.InputJsonValue)
          : ([] as unknown as Prisma.InputJsonValue),
      },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.USER_UPDATED,
      entityType: 'OnboardingTask',
      entityId: task.id,
      newValues: { direction: 'ONBOARDING', subjectUserId, template: templateKey ?? null },
    });

    return this.getTask(actor, task.id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Offboarding
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * What offboarding this person WOULD involve, without starting it (v2.85).
   *
   * Opening the screen used to start it: a row appeared, the person was told
   * to hand everything back, and there was no way to undo it. Looking is not
   * deciding, so the screen asks for this first and writes nothing.
   */
  async previewOffboarding(actor: AuthUser, subjectUserId: string) {
    await this.requireSubject(actor, subjectUserId);
    const open = await this.prisma.client.onboardingTask.findFirst({
      where: {
        companyId: actor.companyId,
        subjectUserId,
        direction: 'OFFBOARDING',
        status: 'OPEN',
      },
      select: { id: true },
    });
    return {
      task: open ? await this.getTask(actor, open.id) : null,
      outstanding: await this.outstandingAssets(actor, subjectUserId),
    };
  }

  /**
   * Calls off an offboarding that should not have been started (v2.85).
   *
   * The person was asked to hand their equipment back, so they are told it is
   * off again; nothing they returned in the meantime is undone, because those
   * returns are facts of their own. The row is kept as CANCELLED rather than
   * deleted - who started it, who called it off and why is the record.
   */
  async cancelOffboarding(actor: AuthUser, id: string, reason?: string) {
    const task = await this.prisma.client.onboardingTask.findFirst({
      where: { id, companyId: actor.companyId, direction: 'OFFBOARDING' },
      select: { id: true, status: true, subjectUserId: true },
    });
    if (!task) throw AppError.notFound('Offboarding', id);
    if (task.status !== 'OPEN') {
      throw new AppError(
        'ILLEGAL_STATE_TRANSITION',
        `This offboarding is already ${task.status.toLowerCase()}`,
        {
          detail: 'Only an offboarding that is still in progress can be called off.',
        },
      );
    }

    await this.prisma.client.onboardingTask.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
        exceptionReason: reason?.trim() || null,
      },
    });

    await this.notifications
      .notify({
        companyId: actor.companyId,
        userId: task.subjectUserId,
        type: 'RETURN_REQUIRED',
        title: 'Your offboarding was called off',
        body: reason?.trim()
          ? `You do not need to hand your equipment back. Reason: ${reason.trim()}`
          : 'You do not need to hand your equipment back.',
        linkPath: '/my-assets',
        entityType: 'OnboardingTask',
        entityId: id,
      })
      .catch(() => undefined);

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.USER_UPDATED,
      entityType: 'OnboardingTask',
      entityId: id,
      newValues: { status: 'CANCELLED', reason: reason?.trim() ?? null },
    });

    return { id, status: 'CANCELLED' as const };
  }

  async startOffboarding(actor: AuthUser, subjectUserId: string) {
    await this.requireSubject(actor, subjectUserId);

    const existing = await this.prisma.client.onboardingTask.findFirst({
      where: {
        companyId: actor.companyId,
        subjectUserId,
        direction: 'OFFBOARDING',
        status: 'OPEN',
      },
    });
    if (existing) return this.getTask(actor, existing.id);

    const outstanding = await this.outstandingAssets(actor, subjectUserId);

    const task = await this.prisma.client.onboardingTask.create({
      data: {
        companyId: actor.companyId,
        subjectUserId,
        direction: 'OFFBOARDING',
        status: 'OPEN',
        createdById: actor.id,
        checklistJson: outstanding as unknown as Prisma.InputJsonValue,
      },
    });

    // Everyone holding something is told what has to come back, rather than
    // discovering it on their last day.
    await this.notifications.notify({
      companyId: actor.companyId,
      userId: subjectUserId,
      type: 'RETURN_REQUIRED',
      title: 'Please return your equipment',
      body:
        outstanding.length > 0
          ? `${outstanding.length} item(s) are still assigned to you and must be returned.`
          : 'No equipment is currently assigned to you.',
      linkPath: '/my-assets',
      entityType: 'OnboardingTask',
      entityId: task.id,
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.USER_UPDATED,
      entityType: 'OnboardingTask',
      entityId: task.id,
      newValues: { direction: 'OFFBOARDING', subjectUserId, outstanding: outstanding.length },
    });

    return this.getTask(actor, task.id);
  }

  /**
   * Assets that still block completion.
   *
   * Anything in employee custody or in transit counts. A returned, retired or
   * disposed asset has an outcome and no longer blocks.
   */
  async outstandingAssets(actor: AuthUser, subjectUserId: string): Promise<OutstandingAsset[]> {
    const assets = await this.prisma.client.asset.findMany({
      where: {
        ...tenantFilter(actor),
        assignedUserId: subjectUserId,
        status: { in: ASSET_STATUSES_BLOCKING_OFFBOARDING as unknown as AssetStatus[] },
      },
      select: {
        id: true,
        assetTag: true,
        name: true,
        status: true,
        assignments: {
          where: { returnedAt: null },
          orderBy: { assignedAt: 'desc' },
          take: 1,
          select: { id: true },
        },
      },
    });

    return assets.map((asset) => ({
      assetId: asset.id,
      assetTag: asset.assetTag,
      name: asset.name,
      status: asset.status as AssetStatus,
      assignmentId: asset.assignments[0]?.id ?? null,
    }));
  }

  /**
   * Completes an offboarding task, refusing while anything is unresolved.
   *
   * This is the gate spec section 13 requires. An exception is permitted but must
   * be documented and attributed — "approved exception" means a person took
   * responsibility, so an empty reason is not accepted.
   */
  async completeOffboarding(actor: AuthUser, taskId: string, exceptionReason?: string) {
    const task = await this.prisma.client.onboardingTask.findFirst({
      where: { id: taskId, companyId: actor.companyId },
    });
    if (!task) throw AppError.notFound('Offboarding task', taskId);
    if (task.direction !== 'OFFBOARDING') {
      throw new AppError('VALIDATION_FAILED', 'This task is not an offboarding');
    }
    if (task.status === 'COMPLETED') return this.getTask(actor, taskId);

    const outstanding = await this.outstandingAssets(actor, task.subjectUserId);

    if (outstanding.length > 0 && !exceptionReason) {
      throw new AppError(
        'CONFLICT',
        'Offboarding cannot be completed while assets are unresolved',
        {
          detail:
            `${outstanding.length} asset(s) are still assigned: ` +
            `${outstanding.map((a) => a.assetTag).join(', ')}. ` +
            'Return them, or supply exceptionReason to record a documented exception.',
          internalContext: { outstanding: outstanding.map((a) => a.assetId) },
        },
      );
    }

    if (outstanding.length > 0 && exceptionReason && exceptionReason.trim().length < 10) {
      throw new AppError('VALIDATION_FAILED', 'Give a meaningful reason for the exception', {
        detail: 'An exception reason must be at least 10 characters.',
      });
    }

    await this.prisma.client.onboardingTask.update({
      where: { id: taskId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        exceptionReason: exceptionReason ?? null,
        exceptionApprovedById: exceptionReason ? actor.id : null,
        checklistJson: outstanding as unknown as Prisma.InputJsonValue,
      },
    });

    // Completing an offboarding means the person has left: disable their login so
    // a former employee can't sign in. Skipped only for the two cases where it
    // would be unsafe — disabling yourself, or removing the last active admin.
    const deactivated = await this.deactivateLeaver(actor, task.subjectUserId);

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.USER_UPDATED,
      entityType: 'OnboardingTask',
      entityId: taskId,
      newValues: {
        status: 'COMPLETED',
        outstandingAtCompletion: outstanding.length,
        exception: exceptionReason ?? null,
        accountDeactivated: deactivated,
      },
      reason: exceptionReason,
    });

    return this.getTask(actor, taskId);
  }

  /**
   * Deactivates a departing employee's account. Returns false without touching
   * anything when it would be unsafe: the actor offboarding themselves, or the
   * subject being the last active Super Admin (which would lock the company out).
   */
  private async deactivateLeaver(actor: AuthUser, subjectUserId: string): Promise<boolean> {
    if (subjectUserId === actor.id) return false;

    const subject = await this.prisma.client.user.findFirst({
      where: { id: subjectUserId, companyId: actor.companyId },
      select: { status: true, roles: { select: { role: { select: { key: true } } } } },
    });
    if (!subject || subject.status === 'DEACTIVATED') return false;

    const isSuperAdmin = subject.roles.some((r) => r.role.key === 'SUPER_ADMIN');
    if (isSuperAdmin) {
      const activeSuperAdmins = await this.prisma.client.user.count({
        where: {
          companyId: actor.companyId,
          status: 'ACTIVE',
          roles: { some: { role: { key: 'SUPER_ADMIN' } } },
        },
      });
      if (activeSuperAdmins <= 1) return false;
    }

    await this.prisma.client.user.update({
      where: { id: subjectUserId },
      data: { status: 'DEACTIVATED' },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.USER_UPDATED,
      entityType: 'User',
      entityId: subjectUserId,
      previousValues: { status: subject.status },
      newValues: { status: 'DEACTIVATED', reason: 'Offboarding completed' },
    });
    return true;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Reads
  // ───────────────────────────────────────────────────────────────────────────

  async getTask(actor: AuthUser, taskId: string) {
    const task = await this.prisma.client.onboardingTask.findFirst({
      where: { id: taskId, companyId: actor.companyId },
      include: {
        subjectUser: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true, jobTitle: true } },
          },
        },
        template: { select: { id: true, key: true, name: true } },
      },
    });
    if (!task) throw AppError.notFound('Task', taskId);

    const outstanding =
      task.direction === 'OFFBOARDING' && task.status !== 'COMPLETED'
        ? await this.outstandingAssets(actor, task.subjectUserId)
        : [];

    return {
      id: task.id,
      direction: task.direction,
      status: task.status,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      exceptionReason: task.exceptionReason,
      subject: task.subjectUser,
      template: task.template,
      checklist: task.checklistJson,
      outstandingAssets: outstanding,
      /** Convenience for the UI; the server re-checks on completion regardless. */
      canComplete: outstanding.length === 0,
    };
  }

  async listTasks(actor: AuthUser, direction?: 'ONBOARDING' | 'OFFBOARDING', status?: string) {
    return this.prisma.client.onboardingTask.findMany({
      where: {
        companyId: actor.companyId,
        ...(direction ? { direction } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: 100,
      include: {
        subjectUser: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
  }

  private async requireSubject(actor: AuthUser, subjectUserId: string) {
    const subject = await this.prisma.client.user.findFirst({
      where: { id: subjectUserId, companyId: actor.companyId },
      select: { id: true, email: true },
    });
    if (!subject) throw AppError.notFound('User', subjectUserId);
    return subject;
  }
}
