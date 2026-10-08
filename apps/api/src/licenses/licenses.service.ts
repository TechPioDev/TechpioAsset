import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type {
  AddLicenseKeyInput,
  AssignSeatInput,
  AuthUser,
  BulkAssignInput,
  BulkRevokeInput,
  ReclaimSeatsInput,
  TransferSeatInput,
  CreateLicenseInput,
  CreateRenewalInput,
  LicenseListQuery,
  RevokeSeatInput,
  UpdateLicenseInput,
} from '@techpioasset/contracts';
import {
  PERMISSIONS,
  deriveLicenseStatus,
  resolveAssignmentPrincipal,
  seatLimitMessage,
  seatsAvailable,
  validatePoolAllocations,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { buildOrderBy, paginate } from '../common/paginate.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AppConfig } from '../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../integrations/webhooks.service.js';
import { decryptLicenseKey, encryptLicenseKey, maskLicenseKey } from './license-key.util.js';
import { strainedLicenses } from './strained-pools.js';

const SORTABLE = ['name', 'expiryDate', 'purchaseDate', 'createdAt', 'seatsPurchased'] as const;

/**
 * v2.3 License Management. The scarce resource is SeatPool.seatsReserved: every
 * assign is an atomic conditional increment whose WHERE clause is the hard
 * limit, so two admins racing for the last seat cannot both win (blueprint
 * §A.7). v2.3 operates on the auto-created default pool; the schema already
 * supports splitting a licence into delegated pools later.
 */
/** A principal as it arrives in a bulk request (echoed back in refusals). */
type BulkPrincipal = { userId?: string | null; assetId?: string | null };

@Injectable()
export class LicensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
    private readonly webhooks: WebhooksService,
  ) {}

  // ── reads ──────────────────────────────────────────────────────────────────

  async list(actor: AuthUser, query: LicenseListQuery) {
    // Resolved to ids because the 0.9 ratio compares two columns, which a
    // Prisma filter cannot do. Same helper the dashboard tile uses.
    const strainedIds = query.nearCapacity
      ? (await strainedLicenses(this.prisma.client, actor.companyId)).ids
      : null;
    const where: Prisma.SoftwareLicenseWhereInput = {
      companyId: actor.companyId,
      ...(strainedIds ? { id: { in: strainedIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.family ? { family: query.family } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.q
        ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { edition: { contains: query.q, mode: 'insensitive' } }] }
        : {}),
    };

    const result = await paginate(query, {
      count: () => this.prisma.client.softwareLicense.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.softwareLicense.findMany({
          where,
          skip,
          take,
          orderBy: buildOrderBy(query.sort, query.order, SORTABLE, 'createdAt'),
          select: {
            ...this.baseSelect(actor),
            pools: { select: { seatsAllocated: true, seatsReserved: true } },
          },
        }),
    });

    const now = new Date();
    return {
      ...result,
      data: result.data.map((l) => this.shape(l, now)),
    };
  }

  async findOne(actor: AuthUser, id: string) {
    const license = await this.prisma.client.softwareLicense.findFirst({
      where: { id, companyId: actor.companyId },
      select: {
        ...this.baseSelect(actor),
        notes: true,
        purchaseOrderNumber: true,
        invoiceId: true,
        pools: {
          select: { id: true, name: true, seatsAllocated: true, seatsReserved: true },
        },
        assignments: {
          orderBy: { assignedAt: 'desc' },
          take: 50,
          select: {
            id: true,
            status: true,
            assignedAt: true,
            revokedAt: true,
            reason: true,
            user: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
            asset: { select: { id: true, assetTag: true, name: true } },
          },
        },
        renewals: {
          orderBy: { renewedAt: 'desc' },
          select: this.renewalSelect(actor),
        },
        keys: { select: { id: true, keyLast4: true, note: true, createdAt: true } },
      },
    });
    if (!license) throw AppError.notFound('License', id);

    const { keys, ...rest } = license;
    return {
      ...this.shape(rest, new Date()),
      keys: keys.map((k) => ({ id: k.id, masked: maskLicenseKey(k.keyLast4), note: k.note, createdAt: k.createdAt })),
    };
  }

  /** The caller's own active seats — every role may see what they hold. */
  async mine(actor: AuthUser) {
    const assignments = await this.prisma.client.licenseAssignment.findMany({
      where: { companyId: actor.companyId, userId: actor.id, status: 'ACTIVE' },
      orderBy: { assignedAt: 'desc' },
      select: {
        id: true,
        assignedAt: true,
        license: {
          select: { id: true, name: true, family: true, edition: true, expiryDate: true, status: true },
        },
      },
    });
    return assignments;
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  async create(actor: AuthUser, input: CreateLicenseInput) {
    if (input.costAmount != null && !this.canSeeCost(actor)) {
      throw new AppError('FORBIDDEN', 'Only Finance can record licence cost');
    }
    if (input.vendorId) {
      const vendor = await this.prisma.client.vendor.findFirst({
        where: { id: input.vendorId, companyId: actor.companyId },
        select: { id: true },
      });
      if (!vendor) throw AppError.notFound('Vendor', input.vendorId);
    }

    const license = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.softwareLicense.create({
        data: {
          companyId: actor.companyId,
          name: input.name,
          family: input.family,
          subscriptionType: input.subscriptionType,
          edition: input.edition ?? null,
          vendorId: input.vendorId ?? null,
          purchaseDate: input.purchaseDate,
          expiryDate: input.expiryDate ?? null,
          renewalDate: input.renewalDate ?? null,
          autoRenewal: input.autoRenewal ?? false,
          seatsPurchased: input.seatsPurchased,
          unitOfAssignment: input.unitOfAssignment,
          costAmount: input.costAmount ? new Prisma.Decimal(input.costAmount) : null,
          costCurrency: input.costCurrency ?? null,
          costModel: input.costModel ?? 'PER_SEAT',
          invoiceId: input.invoiceId ?? null,
          purchaseOrderNumber: input.purchaseOrderNumber ?? null,
          status: deriveLicenseStatus(input.expiryDate ?? null, new Date()),
          notes: input.notes ?? null,
          createdById: actor.id,
          updatedById: actor.id,
        },
        select: { id: true },
      });
      // Single-pool model in v2.3: all purchased seats live in the default pool.
      await tx.seatPool.create({
        data: {
          companyId: actor.companyId,
          licenseId: created.id,
          name: 'Default Pool',
          seatsAllocated: input.seatsPurchased,
          createdById: actor.id,
        },
      });
      return created;
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LICENSE_CREATED,
      entityType: 'SoftwareLicense',
      entityId: license.id,
      newValues: { name: input.name, seatsPurchased: input.seatsPurchased },
    });
    return this.findOne(actor, license.id);
  }

  async update(actor: AuthUser, id: string, input: UpdateLicenseInput) {
    const existing = await this.prisma.client.softwareLicense.findFirst({
      where: { id, companyId: actor.companyId },
      select: {
        id: true,
        status: true,
        expiryDate: true,
        externalSource: true,
        name: true,
        edition: true,
        renewalDate: true,
      },
    });
    if (!existing) throw AppError.notFound('License', id);
    if (input.costAmount != null && !this.canSeeCost(actor)) {
      throw new AppError('FORBIDDEN', 'Only Finance can record licence cost');
    }
    // v3.12 - on a synced licence the name, edition, renewal date and retired
    // flag are Microsoft's to say. Accepting an edit to them would look saved
    // and be gone after the next sync, which is worse than refusing it.
    if (existing.externalSource) {
      // Only a real CHANGE is refused. A form that sends every field back
      // unchanged alongside a new cost is saving the cost, not renaming
      // anything, and must not be turned away for it.
      const changes: Record<'name' | 'edition' | 'renewalDate' | 'retired', boolean> = {
        name: input.name !== undefined && input.name !== existing.name,
        edition: input.edition !== undefined && (input.edition ?? null) !== existing.edition,
        renewalDate:
          input.renewalDate !== undefined &&
          (input.renewalDate?.getTime() ?? null) !== (existing.renewalDate?.getTime() ?? null),
        retired: input.retired !== undefined && input.retired !== (existing.status === 'RETIRED'),
      };
      const owned = (Object.keys(changes) as (keyof typeof changes)[]).filter((f) => changes[f]);
      if (owned.length > 0) {
        throw new AppError(
          'CONFLICT',
          `This licence is synced from Microsoft 365, which sets its ${owned.join(', ')}. Cost, vendor, notes and the order number can still be changed here.`,
        );
      }
    }

    await this.prisma.client.softwareLicense.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.edition !== undefined ? { edition: input.edition } : {}),
        ...(input.vendorId !== undefined ? { vendorId: input.vendorId } : {}),
        ...(input.renewalDate !== undefined ? { renewalDate: input.renewalDate } : {}),
        ...(input.autoRenewal !== undefined ? { autoRenewal: input.autoRenewal } : {}),
        ...(input.costAmount !== undefined
          ? { costAmount: input.costAmount ? new Prisma.Decimal(input.costAmount) : null }
          : {}),
        ...(input.costCurrency !== undefined ? { costCurrency: input.costCurrency } : {}),
        ...(input.costModel !== undefined ? { costModel: input.costModel } : {}),
        ...(input.purchaseOrderNumber !== undefined
          ? { purchaseOrderNumber: input.purchaseOrderNumber }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.retired !== undefined
          ? {
              status: input.retired
                ? 'RETIRED'
                : deriveLicenseStatus(existing.expiryDate, new Date()),
            }
          : {}),
        updatedById: actor.id,
      },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LICENSE_UPDATED,
      entityType: 'SoftwareLicense',
      entityId: id,
      newValues: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
    });
    return this.findOne(actor, id);
  }

  /** Soft delete. A licence with active seats cannot silently disappear. */
  async remove(actor: AuthUser, id: string) {
    await this.refuseIfSynced(actor, id, 'removing it');
    const license = await this.prisma.client.softwareLicense.findFirst({
      where: { id, companyId: actor.companyId },
      select: { id: true, name: true, _count: { select: { assignments: { where: { status: 'ACTIVE' } } } } },
    });
    if (!license) throw AppError.notFound('License', id);
    if (license._count.assignments > 0) {
      throw AppError.conflict(
        'CONFLICT',
        `Revoke the ${license._count.assignments} active seat(s) before deleting this licence`,
      );
    }
    await this.prisma.client.softwareLicense.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: actor.id },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LICENSE_UPDATED,
      entityType: 'SoftwareLicense',
      entityId: id,
      previousValues: { name: license.name },
      reason: 'License deleted',
    });
    return { id, deleted: true };
  }

  // ── the flagship: seat assignment ──────────────────────────────────────────

  async assign(actor: AuthUser, licenseId: string, input: AssignSeatInput) {
    await this.refuseIfSynced(actor, licenseId, 'assigning seats');
    const license = await this.prisma.client.softwareLicense.findFirst({
      where: { id: licenseId, companyId: actor.companyId },
      select: {
        id: true,
        name: true,
        status: true,
        unitOfAssignment: true,
        seatsPurchased: true,
        pools: { select: { id: true, seatsReserved: true }, orderBy: { createdAt: 'asc' }, take: 1 },
      },
    });
    if (!license) throw AppError.notFound('License', licenseId);
    if (license.status === 'RETIRED' || license.status === 'EXPIRED') {
      throw new AppError('ILLEGAL_STATE_TRANSITION', `A ${license.status.toLowerCase()} licence cannot be assigned`);
    }
    const pool = license.pools[0];
    if (!pool) throw AppError.notFound('Seat pool');

    const principal = resolveAssignmentPrincipal(license.unitOfAssignment, input);
    if (!principal.ok) throw new AppError('VALIDATION_FAILED', principal.message);

    // The principal must be a live row in this tenant.
    if (principal.field === 'userId') {
      const user = await this.prisma.client.user.findFirst({
        where: { id: principal.id, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!user) throw AppError.notFound('User', principal.id);
    } else {
      const asset = await this.prisma.client.asset.findFirst({
        where: { id: principal.id, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!asset) throw AppError.notFound('Asset', principal.id);
    }

    try {
      const assignment = await this.prisma.client.$transaction(async (tx) => {
        // Atomic conditional increment — the WHERE clause IS the hard limit.
        const affected = await tx.$executeRaw`
          UPDATE "seat_pools"
             SET "seatsReserved" = "seatsReserved" + 1
           WHERE "id" = ${pool.id}
             AND "companyId" = ${actor.companyId}
             AND "seatsReserved" + 1 <= "seatsAllocated"`;
        if (affected === 0) {
          throw new AppError(
            'SEAT_LIMIT_EXCEEDED',
            seatLimitMessage({ purchased: license.seatsPurchased, reserved: pool.seatsReserved }),
          );
        }
        return tx.licenseAssignment.create({
          data: {
            companyId: actor.companyId,
            licenseId: license.id,
            seatPoolId: pool.id,
            [principal.field]: principal.id,
            assignedById: actor.id,
            reason: input.reason ?? null,
          },
          select: { id: true, userId: true, assetId: true },
        });
      });

      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.LICENSE_ASSIGNED,
        entityType: 'SoftwareLicense',
        entityId: license.id,
        newValues: { assignmentId: assignment.id, [principal.field]: principal.id },
      });
      return this.findOne(actor, license.id);
    } catch (error) {
      if (error instanceof AppError && error.code === 'SEAT_LIMIT_EXCEEDED') {
        // The refused 11th seat leaves a trail (blueprint §A.7d).
        await this.audit.record({
          companyId: actor.companyId,
          actorId: actor.id,
          action: AuditAction.LICENSE_ASSIGN_BLOCKED,
          entityType: 'SoftwareLicense',
          entityId: license.id,
          newValues: {
            reason: 'License limit exceeded',
            purchased: license.seatsPurchased,
            [principal.field]: principal.id,
          },
        });
        // Blueprint A.7c: the refusal reaches the actor's inbox too, so a
        // blocked assign never passes silently even off-screen.
        await this.notifications.notify({
          companyId: actor.companyId,
          userId: actor.id,
          type: 'SEAT_LIMIT_REACHED',
          title: `License limit reached: ${license.name}`,
          body: error.message,
          linkPath: `/licenses/${license.id}`,
          entityType: 'SoftwareLicense',
          entityId: license.id,
        });
        // v2.24: the same refusal, pushed to subscribed systems - a full pool
        // is a purchasing signal, and the system that raises POs may not be
        // this one. Fire-and-forget: a webhook must never change the refusal.
        void this.webhooks.publish(actor.companyId, 'license.seat_blocked', {
          licenseId: license.id,
          licenseName: license.name,
          seatsPurchased: license.seatsPurchased,
          attemptedFor: { [principal.field]: principal.id },
          attemptedById: actor.id,
        });
        throw error;
      }
      // The partial unique index refuses a duplicate ACTIVE seat; translate it.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw AppError.conflict('CONFLICT', 'This principal already holds an active seat on this licence');
      }
      throw error;
    }
  }

  async revoke(actor: AuthUser, licenseId: string, input: RevokeSeatInput) {
    const assignment = await this.prisma.client.licenseAssignment.findFirst({
      where: { id: input.assignmentId, licenseId, companyId: actor.companyId, status: 'ACTIVE' },
      select: { id: true, seatPoolId: true, userId: true, assetId: true },
    });
    if (!assignment) throw AppError.notFound('Active assignment', input.assignmentId);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.licenseAssignment.update({
        where: { id: assignment.id },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedById: actor.id,
          ...(input.reason ? { reason: input.reason } : {}),
        },
      });
      // Guarded decrement: never below zero, whatever else happened.
      await tx.$executeRaw`
        UPDATE "seat_pools"
           SET "seatsReserved" = "seatsReserved" - 1
         WHERE "id" = ${assignment.seatPoolId}
           AND "companyId" = ${actor.companyId}
           AND "seatsReserved" > 0`;
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LICENSE_REVOKED,
      entityType: 'SoftwareLicense',
      entityId: licenseId,
      previousValues: { assignmentId: assignment.id, userId: assignment.userId, assetId: assignment.assetId },
      reason: input.reason ?? undefined,
    });
    return this.findOne(actor, licenseId);
  }

  // ── v2.7 R3: bulk operations & transfers ───────────────────────────────────

  /**
   * Assign many seats at once.
   *
   * PARTIAL takes exactly the seats that fit and reports every refusal with
   * its real reason. ATOMIC reserves all N in ONE conditional update — if the
   * pool cannot hold them, nothing at all happens. What must never exist is a
   * silent partial success: either mode tells the caller precisely what it did.
   */
  async bulkAssign(actor: AuthUser, licenseId: string, input: BulkAssignInput) {
    await this.refuseIfSynced(actor, licenseId, 'assigning seats');
    const license = await this.loadAssignableLicense(actor, licenseId);
    const pool = license.pools[0];
    if (!pool) throw AppError.notFound('Seat pool');

    // Resolve principals against the licence's unit before touching the pool -
    // a malformed batch should not consume seats on its way to failing.
    const resolved = input.principals.map((p) => ({
      input: p,
      principal: resolveAssignmentPrincipal(license.unitOfAssignment, p),
    }));
    const malformed = resolved.filter((r) => !r.principal.ok);
    if (malformed.length > 0 && input.mode === 'ATOMIC') {
      throw new AppError(
        'VALIDATION_FAILED',
        `${malformed.length} principal(s) do not match this licence's unit of assignment`,
      );
    }

    const assigned: { principal: BulkPrincipal; assignmentId: string }[] = [];
    const refused: { principal: BulkPrincipal; reason: string }[] = [];

    if (input.mode === 'ATOMIC') {
      const wanted = resolved.length;
      await this.prisma.client.$transaction(async (tx) => {
        // One conditional update for the whole batch: the WHERE clause is the
        // hard limit, so N seats appear together or not at all.
        const affected = await tx.$executeRaw`
          UPDATE "seat_pools"
             SET "seatsReserved" = "seatsReserved" + ${wanted}
           WHERE "id" = ${pool.id}
             AND "companyId" = ${actor.companyId}
             AND "seatsReserved" + ${wanted} <= "seatsAllocated"`;
        if (affected === 0) {
          throw new AppError(
            'SEAT_LIMIT_EXCEEDED',
            `Cannot assign ${wanted} seat(s): ${seatLimitMessage({
              purchased: license.seatsPurchased,
              reserved: pool.seatsReserved,
            })}`,
          );
        }
        for (const row of resolved) {
          const principal = row.principal as { ok: true; field: 'userId' | 'assetId'; id: string };
          const created = await tx.licenseAssignment.create({
            data: {
              companyId: actor.companyId,
              licenseId: license.id,
              seatPoolId: pool.id,
              [principal.field]: principal.id,
              assignedById: actor.id,
              reason: input.reason ?? null,
            },
            select: { id: true },
          });
          assigned.push({ principal: row.input, assignmentId: created.id });
        }
      });
    } else {
      for (const row of resolved) {
        if (!row.principal.ok) {
          refused.push({ principal: row.input, reason: row.principal.message });
          continue;
        }
        try {
          // Reuse the proven single-seat path: same guard, same audit trail,
          // same honest refusal - one seat at a time, so a full pool stops
          // exactly where it runs out instead of failing the whole batch.
          await this.assign(actor, licenseId, {
            ...(row.principal.field === 'userId'
              ? { userId: row.principal.id }
              : { assetId: row.principal.id }),
            reason: input.reason ?? null,
          } as AssignSeatInput);
          assigned.push({ principal: row.input, assignmentId: 'assigned' });
        } catch (error) {
          refused.push({
            principal: row.input,
            reason: error instanceof AppError ? error.message : 'Could not assign this seat',
          });
        }
      }
    }

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LICENSE_ASSIGNED,
      entityType: 'SoftwareLicense',
      entityId: license.id,
      newValues: { bulk: true, mode: input.mode, assigned: assigned.length, refused: refused.length },
      reason: input.reason ?? undefined,
    });

    return {
      mode: input.mode,
      requested: input.principals.length,
      assignedCount: assigned.length,
      refusedCount: refused.length,
      refused,
      license: await this.findOne(actor, license.id),
    };
  }

  /** Revoke many seats; unknown or already-revoked ids are reported, not fatal. */
  async bulkRevoke(actor: AuthUser, licenseId: string, input: BulkRevokeInput) {
    const revoked: string[] = [];
    const skipped: { assignmentId: string; reason: string }[] = [];
    for (const assignmentId of input.assignmentIds) {
      try {
        await this.revoke(actor, licenseId, { assignmentId, reason: input.reason ?? null });
        revoked.push(assignmentId);
      } catch (error) {
        skipped.push({
          assignmentId,
          reason: error instanceof AppError ? error.message : 'Could not revoke',
        });
      }
    }
    return {
      requested: input.assignmentIds.length,
      revokedCount: revoked.length,
      skippedCount: skipped.length,
      skipped,
      license: await this.findOne(actor, licenseId),
    };
  }

  /**
   * Move a seat from one principal to another.
   *
   * A transfer is a swap, not a purchase: the old assignment closes and the
   * new one opens on the SAME pool inside one transaction, and the pool
   * counter is never touched. That is the invariant - a transfer can never
   * create a seat, and a FULL licence can still transfer (there is no moment
   * where a free seat is needed).
   */
  async transfer(actor: AuthUser, licenseId: string, input: TransferSeatInput) {
    await this.refuseIfSynced(actor, licenseId, 'moving a seat');
    const license = await this.loadAssignableLicense(actor, licenseId);
    const assignment = await this.prisma.client.licenseAssignment.findFirst({
      where: { id: input.assignmentId, licenseId, companyId: actor.companyId, status: 'ACTIVE' },
      select: { id: true, seatPoolId: true, userId: true, assetId: true },
    });
    if (!assignment) throw AppError.notFound('Active assignment', input.assignmentId);

    const principal = resolveAssignmentPrincipal(license.unitOfAssignment, {
      userId: input.toUserId ?? null,
      assetId: input.toAssetId ?? null,
    });
    if (!principal.ok) throw new AppError('VALIDATION_FAILED', principal.message);
    if (
      (principal.field === 'userId' && principal.id === assignment.userId) ||
      (principal.field === 'assetId' && principal.id === assignment.assetId)
    ) {
      throw new AppError('VALIDATION_FAILED', 'The seat already belongs to that principal');
    }
    await this.assertPrincipalExists(actor, principal.field, principal.id);

    try {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.licenseAssignment.update({
          where: { id: assignment.id },
          data: {
            status: 'REVOKED',
            revokedAt: new Date(),
            revokedById: actor.id,
            reason: input.reason ?? 'Transferred',
          },
        });
        await tx.licenseAssignment.create({
          data: {
            companyId: actor.companyId,
            licenseId,
            seatPoolId: assignment.seatPoolId,
            [principal.field]: principal.id,
            assignedById: actor.id,
            reason: input.reason ?? 'Transferred',
          },
        });
        // Note the absence: seatsReserved is deliberately NOT touched.
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppError.conflict(
          'CONFLICT',
          'That principal already holds an active seat on this licence',
        );
      }
      throw error;
    }

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LICENSE_TRANSFERRED,
      entityType: 'SoftwareLicense',
      entityId: licenseId,
      previousValues: { userId: assignment.userId, assetId: assignment.assetId },
      newValues: { [principal.field]: principal.id },
      reason: input.reason ?? undefined,
    });
    return this.findOne(actor, licenseId);
  }

  /**
   * v2.7 R4 — seats held by people who are no longer here.
   *
   * A deactivated or suspended employee keeps consuming a paid seat until
   * somebody notices; this surfaces exactly those, tenant-wide, so the waste
   * is visible rather than discovered at renewal. It only ever REPORTS -
   * reclaiming is a deliberate act with a stated reason (see reclaim).
   */
  async reclaimable(actor: AuthUser, licenseId?: string) {
    const rows = await this.prisma.client.licenseAssignment.findMany({
      where: {
        companyId: actor.companyId,
        status: 'ACTIVE',
        ...(licenseId ? { licenseId } : {}),
        user: { OR: [{ status: { in: ['DEACTIVATED', 'SUSPENDED'] } }, { deletedAt: { not: null } }] },
      },
      orderBy: { assignedAt: 'asc' },
      select: {
        id: true,
        assignedAt: true,
        license: { select: { id: true, name: true } },
        user: {
          select: {
            id: true,
            email: true,
            status: true,
            deletedAt: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    return {
      count: rows.length,
      assignments: rows.map((r) => ({
        assignmentId: r.id,
        assignedAt: r.assignedAt,
        license: r.license,
        holder: {
          id: r.user!.id,
          email: r.user!.email,
          name: r.user!.profile
            ? `${r.user!.profile.firstName} ${r.user!.profile.lastName}`
            : r.user!.email,
          // Why it is reclaimable, in the response - no guessing at the UI.
          reason: r.user!.deletedAt ? 'DELETED' : r.user!.status,
        },
      })),
    };
  }

  /**
   * Reclaim seats from departed holders. Each is the ordinary guarded revoke
   * (so the counter can never drift) with a mandatory reason on the record.
   */
  async reclaim(actor: AuthUser, input: ReclaimSeatsInput) {
    const targets = await this.prisma.client.licenseAssignment.findMany({
      where: {
        id: { in: input.assignmentIds },
        companyId: actor.companyId,
        status: 'ACTIVE',
      },
      select: { id: true, licenseId: true },
    });
    const found = new Set(targets.map((t) => t.id));
    const skipped = input.assignmentIds
      .filter((id) => !found.has(id))
      .map((assignmentId) => ({ assignmentId, reason: 'No active assignment with that id' }));

    let reclaimed = 0;
    for (const target of targets) {
      await this.revoke(actor, target.licenseId, {
        assignmentId: target.id,
        reason: input.reason,
      });
      reclaimed += 1;
    }
    return {
      requested: input.assignmentIds.length,
      reclaimedCount: reclaimed,
      skippedCount: skipped.length,
      skipped,
    };
  }

  /** Shared loader: the licence must exist and be in an assignable state. */
  private async loadAssignableLicense(actor: AuthUser, licenseId: string) {
    const license = await this.prisma.client.softwareLicense.findFirst({
      where: { id: licenseId, companyId: actor.companyId },
      select: {
        id: true,
        name: true,
        status: true,
        unitOfAssignment: true,
        seatsPurchased: true,
        pools: { select: { id: true, seatsReserved: true }, orderBy: { createdAt: 'asc' }, take: 1 },
      },
    });
    if (!license) throw AppError.notFound('License', licenseId);
    if (license.status === 'RETIRED' || license.status === 'EXPIRED') {
      throw new AppError(
        'ILLEGAL_STATE_TRANSITION',
        `A ${license.status.toLowerCase()} licence cannot be assigned`,
      );
    }
    return license;
  }

  private async assertPrincipalExists(
    actor: AuthUser,
    field: 'userId' | 'assetId',
    id: string,
  ): Promise<void> {
    if (field === 'userId') {
      const user = await this.prisma.client.user.findFirst({
        where: { id, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!user) throw AppError.notFound('User', id);
    } else {
      const asset = await this.prisma.client.asset.findFirst({
        where: { id, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!asset) throw AppError.notFound('Asset', id);
    }
  }

  // ── renewals & keys ────────────────────────────────────────────────────────

  async renew(actor: AuthUser, licenseId: string, input: CreateRenewalInput) {
    await this.refuseIfSynced(actor, licenseId, 'renewing it or changing its seats');
    const license = await this.prisma.client.softwareLicense.findFirst({
      where: { id: licenseId, companyId: actor.companyId },
      select: {
        id: true,
        expiryDate: true,
        seatsPurchased: true,
        pools: { select: { id: true, seatsAllocated: true, seatsReserved: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!license) throw AppError.notFound('License', licenseId);

    const delta = input.seatsDelta ?? 0;
    const nextPurchased = license.seatsPurchased + delta;
    if (nextPurchased < 0) {
      throw new AppError('VALIDATION_FAILED', 'A renewal cannot reduce seats below zero');
    }
    const defaultPool = license.pools[0];
    if (!defaultPool) throw AppError.notFound('Seat pool');
    const nextAllocated = defaultPool.seatsAllocated + delta;
    if (nextAllocated < defaultPool.seatsReserved) {
      throw AppError.conflict(
        'CONFLICT',
        `Cannot shrink to ${nextAllocated} seat(s): ${defaultPool.seatsReserved} are currently assigned`,
      );
    }
    const otherAllocations = license.pools.slice(1).map((p) => p.seatsAllocated);
    const check = validatePoolAllocations(nextPurchased, [nextAllocated, ...otherAllocations]);
    if (!check.ok) throw new AppError('VALIDATION_FAILED', check.message ?? 'Invalid allocation');

    await this.prisma.client.$transaction(async (tx) => {
      await tx.softwareLicense.update({
        where: { id: licenseId },
        data: {
          seatsPurchased: nextPurchased,
          ...(input.newExpiry !== undefined && input.newExpiry !== null
            ? { expiryDate: input.newExpiry, status: deriveLicenseStatus(input.newExpiry, new Date()) }
            : {}),
          updatedById: actor.id,
        },
      });
      await tx.seatPool.update({
        where: { id: defaultPool.id },
        data: { seatsAllocated: nextAllocated },
      });
      await tx.licenseRenewal.create({
        data: {
          companyId: actor.companyId,
          licenseId,
          previousExpiry: license.expiryDate,
          newExpiry: input.newExpiry ?? license.expiryDate,
          seatsDelta: delta,
          costAmount: input.costAmount ? new Prisma.Decimal(input.costAmount) : null,
          costCurrency: input.costCurrency ?? null,
          notes: input.notes ?? null,
          createdById: actor.id,
        },
      });
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LICENSE_RENEWED,
      entityType: 'SoftwareLicense',
      entityId: licenseId,
      newValues: { seatsDelta: delta, newExpiry: input.newExpiry?.toISOString() ?? null },
    });
    return this.findOne(actor, licenseId);
  }

  async addKey(actor: AuthUser, licenseId: string, input: AddLicenseKeyInput) {
    const secret = this.keySecret();
    const license = await this.prisma.client.softwareLicense.findFirst({
      where: { id: licenseId, companyId: actor.companyId },
      select: { id: true },
    });
    if (!license) throw AppError.notFound('License', licenseId);

    const key = await this.prisma.client.licenseKey.create({
      data: {
        companyId: actor.companyId,
        licenseId,
        keyCiphertext: encryptLicenseKey(input.key, secret),
        keyLast4: input.key.slice(-4),
        note: input.note ?? null,
        createdById: actor.id,
      },
      select: { id: true, keyLast4: true },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LICENSE_UPDATED,
      entityType: 'SoftwareLicense',
      entityId: licenseId,
      reason: 'License key added',
    });
    return { id: key.id, masked: maskLicenseKey(key.keyLast4) };
  }

  /** Decrypts one key. Every reveal is audited — that is the deal. */
  async revealKey(actor: AuthUser, licenseId: string, keyId: string) {
    const secret = this.keySecret();
    const key = await this.prisma.client.licenseKey.findFirst({
      where: { id: keyId, licenseId, companyId: actor.companyId },
      select: { id: true, keyCiphertext: true },
    });
    if (!key) throw AppError.notFound('License key', keyId);

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LICENSE_KEY_REVEALED,
      entityType: 'SoftwareLicense',
      entityId: licenseId,
      newValues: { keyId },
    });
    return { id: key.id, key: decryptLicenseKey(key.keyCiphertext, secret) };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /**
   * A licence mirrored from Microsoft 365 is changed THERE (v3.12).
   *
   * Its seats, dates and seat counter are written by the sync. Assigning a
   * seat here would not give anyone the product - Microsoft decides who has
   * it - and it would move a counter the next sync puts straight back. Renewing
   * it here would record a renewal that did not happen, and removing it would
   * collide with the sync recreating it. So these are refused, with a sentence
   * that says where to go instead.
   *
   * Cost, vendor, notes and the invoice stay editable: Microsoft knows none of
   * those, and the sync never touches them.
   */
  private async refuseIfSynced(actor: AuthUser, licenseId: string, doing: string): Promise<void> {
    const license = await this.prisma.client.softwareLicense.findFirst({
      where: { id: licenseId, companyId: actor.companyId },
      select: { externalSource: true },
    });
    if (license?.externalSource) {
      throw new AppError(
        'CONFLICT',
        `This licence is synced from Microsoft 365, so ${doing} is done in the Microsoft 365 admin centre. The change appears here after the next sync.`,
      );
    }
  }

  private canSeeCost(actor: AuthUser): boolean {
    return actor.permissions.includes(PERMISSIONS.LICENSES_COST_READ);
  }

  private keySecret(): string {
    const secret = this.config.get('LICENSE_KEY_SECRET');
    if (!secret) {
      throw new AppError(
        'DEPENDENCY_UNAVAILABLE',
        'License keys are not configured: set LICENSE_KEY_SECRET on the server first',
      );
    }
    return secret;
  }

  private baseSelect(actor: AuthUser) {
    return {
      id: true,
      name: true,
      family: true,
      subscriptionType: true,
      edition: true,
      purchaseDate: true,
      expiryDate: true,
      renewalDate: true,
      autoRenewal: true,
      seatsPurchased: true,
      unitOfAssignment: true,
      status: true,
      vendor: { select: { id: true, name: true } },
      createdAt: true,
      // v3.12 - where the licence came from. Null for one entered by hand;
      // "M365" for one mirrored from Microsoft, whose seats and dates the sync
      // owns. Sent on every read so a screen can say so instead of offering
      // an Assign button the server would refuse.
      externalSource: true,
      externalSeatsUsed: true,
      externalStatus: true,
      externalSyncedAt: true,
      ...(this.canSeeCost(actor)
        ? { costAmount: true, costCurrency: true, costModel: true }
        : {}),
    } satisfies Prisma.SoftwareLicenseSelect;
  }

  private renewalSelect(actor: AuthUser) {
    return {
      id: true,
      renewedAt: true,
      previousExpiry: true,
      newExpiry: true,
      seatsDelta: true,
      notes: true,
      ...(this.canSeeCost(actor) ? { costAmount: true, costCurrency: true } : {}),
    } satisfies Prisma.LicenseRenewalSelect;
  }

  /** Derived numbers: reserved/available roll up from pools; status from dates. */
  private shape<T extends { pools: { seatsAllocated: number; seatsReserved: number }[]; seatsPurchased: number; status: string; expiryDate: Date | null }>(
    license: T,
    now: Date,
  ) {
    const reserved = license.pools.reduce((sum, p) => sum + p.seatsReserved, 0);
    return {
      ...license,
      seatsReserved: reserved,
      seatsAvailable: seatsAvailable(license.seatsPurchased, reserved),
      status:
        license.status === 'RETIRED' ? 'RETIRED' : deriveLicenseStatus(license.expiryDate, now),
    };
  }
}
