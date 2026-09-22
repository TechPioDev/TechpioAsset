import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type PhysicalInventoryScanResult } from '@prisma/client';
import {
  offlineAssignPayloadSchema,
  offlineReassignPayloadSchema,
  offlineReturnPayloadSchema,
  offlineStockCountPayloadSchema,
  type AuthUser,
  type SyncBatchInput,
} from '@techpioasset/contracts';
import {
  PERMISSIONS,
  decideCustody,
  decideStockCount,
  orderOperationsForReplay,
  decideOperation,
  safeTimeZone,
  type CustodyDecision,
  type OfflineOperation,
  type OperationResult,
  type SyncResponse,
} from '@techpioasset/domain';
import { AssetsService } from '../assets/assets.service.js';
import { AppError } from '../common/errors/app-error.js';
import { tenantFilter } from '../common/scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StockService } from '../stock/stock.service.js';

/** v2.82 - the operations recorded offline that change custody or stock. */
const RECORDED_TYPES = new Set(['ASSET_ASSIGN', 'ASSET_REASSIGN', 'ASSET_RETURN', 'STOCK_COUNT']);
const NEEDS: Record<string, { permission: string; doing: string }> = {
  ASSET_ASSIGN: { permission: PERMISSIONS.ASSETS_ASSIGN, doing: 'hand over assets' },
  ASSET_REASSIGN: { permission: PERMISSIONS.ASSETS_ASSIGN, doing: 'hand over assets' },
  ASSET_RETURN: { permission: PERMISSIONS.ASSETS_RETURN, doing: 'record returns' },
  STOCK_COUNT: { permission: PERMISSIONS.INVENTORY_ADJUST, doing: 'correct stock counts' },
};

/**
 * Applies a batch of queued offline operations (spec section 16).
 *
 * The decision for each operation comes from the pure `decideOperation` in
 * packages/domain; this service supplies the server state it needs and performs
 * the write when the decision is APPLIED. Idempotency is real, not hopeful: the
 * clientGeneratedId is a unique column, so replaying a batch produces DUPLICATE
 * outcomes and zero extra rows.
 */
@Injectable()
export class MobileSyncService {
  private readonly logger = new Logger(MobileSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetsService,
    private readonly stock: StockService,
  ) {}

  async sync(actor: AuthUser, input: SyncBatchInput): Promise<SyncResponse> {
    const ordered = orderOperationsForReplay(
      input.operations as OfflineOperation<Record<string, unknown>>[],
    );

    const results: OperationResult[] = [];
    for (const op of ordered) {
      results.push(await this.applyOne(actor, op, input.sessionId));
    }

    // scannedCount reflects reality after the batch, for the session summary.
    if (input.sessionId) {
      const scanned = await this.prisma.client.physicalInventoryScan.count({
        where: { sessionId: input.sessionId },
      });
      await this.prisma.client.physicalInventorySession.updateMany({
        where: { id: input.sessionId, ...tenantFilter(actor) },
        data: { scannedCount: scanned },
      });
    }

    return { results, syncedAt: new Date().toISOString() };
  }

  private async applyOne(
    actor: AuthUser,
    op: OfflineOperation<Record<string, unknown>>,
    sessionId?: string,
  ): Promise<OperationResult> {
    if (RECORDED_TYPES.has(op.type)) return this.applyRecorded(actor, op);
    // The original offline types were stock-take work; they keep the right
    // the whole endpoint used to require.
    if (!actor.permissions.includes(PERMISSIONS.INVENTORY_ADJUST)) {
      return {
        clientGeneratedId: op.clientGeneratedId,
        outcome: 'REJECTED',
        message: 'You do not have permission to record stock-take changes.',
      };
    }
    // v2.82 - a scan carries its own stock-take, so a queue flushed from
    // anywhere (not only the stock-take screen) still knows where it belongs.
    sessionId ??= op.payload.sessionId ? String(op.payload.sessionId) : undefined;
    // Server state for the decision. The idempotency check is a lookup on the
    // unique clientGeneratedId across the tables that carry it.
    const existingScan =
      op.type === 'INVENTORY_SCAN'
        ? await this.prisma.client.physicalInventoryScan.findUnique({
            where: { clientGeneratedId: op.clientGeneratedId },
            select: { id: true },
          })
        : null;

    const entity =
      op.entityId !== null
        ? await this.prisma.client.asset.findFirst({
            where: { id: op.entityId, ...tenantFilter(actor) },
            select: { id: true, version: true },
          })
        : null;

    const decision = decideOperation(op, {
      alreadyApplied: existingScan !== null,
      existingServerId: existingScan?.id,
      currentVersion: entity?.version,
      entityExists: op.entityId === null || entity !== null,
    });

    if (decision.outcome !== 'APPLIED') return decision;

    try {
      const serverId = await this.persist(actor, op, sessionId);
      return { ...decision, serverId };
    } catch (error) {
      // A late unique-constraint clash (two devices, same id, racing) collapses
      // to DUPLICATE rather than failing the whole batch.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { clientGeneratedId: op.clientGeneratedId, outcome: 'DUPLICATE' };
      }
      this.logger.error(
        `Failed to apply ${op.type} ${op.clientGeneratedId}: ${(error as Error).message}`,
      );
      return {
        clientGeneratedId: op.clientGeneratedId,
        outcome: 'REJECTED',
        message: 'The server could not apply this change.',
      };
    }
  }

  private async persist(
    actor: AuthUser,
    op: OfflineOperation<Record<string, unknown>>,
    sessionId?: string,
  ): Promise<string | undefined> {
    switch (op.type) {
      case 'INVENTORY_SCAN': {
        if (!sessionId) throw new Error('INVENTORY_SCAN requires a sessionId');
        const scannedCode = String(op.payload.scannedCode ?? op.payload.code ?? '');
        // Classify the scan against the register, so the reconciliation report
        // can show expected vs unexpected vs unknown.
        const asset = op.entityId
          ? await this.prisma.client.asset.findFirst({
              where: { id: op.entityId, ...tenantFilter(actor) },
              select: { id: true, roomId: true },
            })
          : await this.prisma.client.asset.findFirst({
              where: {
                OR: [{ qrToken: scannedCode }, { barcode: scannedCode }],
                ...tenantFilter(actor),
              },
              select: { id: true, roomId: true },
            });

        const foundRoomId = op.payload.foundRoomId ? String(op.payload.foundRoomId) : null;
        const result: PhysicalInventoryScanResult = !asset
          ? 'NOT_IN_REGISTER'
          : foundRoomId && asset.roomId && foundRoomId !== asset.roomId
            ? 'UNEXPECTED_LOCATION'
            : 'EXPECTED';

        const scan = await this.prisma.client.physicalInventoryScan.create({
          data: {
            sessionId,
            assetId: asset?.id ?? null,
            scannedCode,
            result,
            foundRoomId,
            condition: op.payload.condition ? (op.payload.condition as never) : null,
            note: op.payload.note ? String(op.payload.note) : null,
            clientGeneratedId: op.clientGeneratedId,
            scannedAt: new Date(op.capturedAt),
            scannedById: actor.id,
          },
        });
        return scan.id;
      }

      case 'CONDITION_UPDATE': {
        if (!op.entityId) throw new Error('CONDITION_UPDATE requires an entityId');
        await this.prisma.client.asset.update({
          where: { id: op.entityId },
          data: {
            condition: op.payload.condition as never,
            updatedById: actor.id,
            version: { increment: 1 },
          },
        });
        await this.prisma.client.assetConditionLog.create({
          data: {
            assetId: op.entityId,
            newCondition: op.payload.condition as never,
            reason: 'Mobile offline update',
            createdById: actor.id,
          },
        });
        return op.entityId;
      }

      case 'LOCATION_UPDATE': {
        if (!op.entityId) throw new Error('LOCATION_UPDATE requires an entityId');
        await this.prisma.client.asset.update({
          where: { id: op.entityId },
          data: {
            roomId: op.payload.roomId ? String(op.payload.roomId) : null,
            updatedById: actor.id,
            version: { increment: 1 },
          },
        });
        return op.entityId;
      }

      case 'NOTE': {
        if (!op.entityId) return undefined;
        await this.prisma.client.asset.update({
          where: { id: op.entityId },
          data: {
            notes: String(op.payload.note ?? ''),
            updatedById: actor.id,
            version: { increment: 1 },
          },
        });
        return op.entityId;
      }

      case 'ASSET_PHOTO':
        // The photo bytes upload through the storage route separately; the queued
        // op only records the intent, which is a no-op server-side here.
        return op.entityId ?? undefined;

      default:
        return undefined;
    }
  }

  // ── v2.82 (Phase 6): custody and stock recorded offline ─────────────────────

  /**
   * A handover, return or stock count the phone recorded with no signal.
   *
   * Each is applied through the same service the online screen calls, so every
   * rule that holds online holds here too; the only extra question is whether
   * the thing it acted on is still as the phone saw it (decideCustody /
   * decideStockCount). Applied and already-done operations leave a receipt, so
   * a retried upload is a DUPLICATE and never a second handover.
   */
  private async applyRecorded(
    actor: AuthUser,
    op: OfflineOperation<Record<string, unknown>>,
  ): Promise<OperationResult> {
    const id = op.clientGeneratedId;
    const receipt = await this.prisma.client.offlineOperationReceipt.findUnique({
      where: { clientGeneratedId: id },
      select: { serverId: true },
    });
    if (receipt) {
      return {
        clientGeneratedId: id,
        outcome: 'DUPLICATE',
        serverId: receipt.serverId ?? undefined,
      };
    }

    const need = NEEDS[op.type]!;
    if (!actor.permissions.includes(need.permission)) {
      return {
        clientGeneratedId: id,
        outcome: 'REJECTED',
        message: `You no longer have permission to ${need.doing}.`,
      };
    }

    try {
      const decision = await (op.type === 'STOCK_COUNT'
        ? this.countStock(actor, op)
        : this.moveCustody(actor, op));
      if (decision.outcome === 'CONFLICT') {
        return { clientGeneratedId: id, outcome: 'CONFLICT', message: decision.message };
      }
      const message = decision.outcome === 'ALREADY_DONE' ? decision.message : undefined;
      await this.prisma.client.offlineOperationReceipt.create({
        data: {
          companyId: actor.companyId,
          userId: actor.id,
          clientGeneratedId: id,
          type: op.type,
          outcome: decision.outcome,
          serverId: op.entityId ?? null,
          message: message ?? null,
          capturedAt: new Date(op.capturedAt),
        },
      });
      return {
        clientGeneratedId: id,
        outcome: decision.outcome === 'APPLY' ? 'APPLIED' : 'DUPLICATE',
        serverId: op.entityId ?? undefined,
        ...(message ? { message } : {}),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { clientGeneratedId: id, outcome: 'DUPLICATE' };
      }
      // The same refusal the online screen would have shown: a status the
      // asset cannot move to, a person who has left, a location that is gone.
      if (error instanceof AppError) {
        return {
          clientGeneratedId: id,
          outcome: 'REJECTED',
          message: error.detail ?? error.message,
        };
      }
      if (error instanceof OfflinePayloadError) {
        return { clientGeneratedId: id, outcome: 'REJECTED', message: error.message };
      }
      this.logger.error(`Failed to apply ${op.type} ${id}: ${(error as Error).message}`);
      return {
        clientGeneratedId: id,
        outcome: 'REJECTED',
        message: 'The server could not apply this change.',
      };
    }
  }

  private async moveCustody(
    actor: AuthUser,
    op: OfflineOperation<Record<string, unknown>>,
  ): Promise<CustodyDecision> {
    if (!op.entityId)
      throw new OfflinePayloadError('This change does not say which asset it is for.');
    const asset = await this.prisma.client.asset.findFirst({
      where: { id: op.entityId, deletedAt: null, ...tenantFilter(actor) },
      select: {
        assignedUserId: true,
        assignedUser: {
          select: { email: true, profile: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!asset) throw new OfflinePayloadError('The asset no longer exists.');
    const holderName = asset.assignedUser
      ? asset.assignedUser.profile
        ? `${asset.assignedUser.profile.firstName} ${asset.assignedUser.profile.lastName}`
        : asset.assignedUser.email
      : null;
    const current = { holderId: asset.assignedUserId, holderName };
    const note = await this.offlineNote(actor, op.capturedAt);

    if (op.type === 'ASSET_RETURN') {
      const { seenHolderId, ...input } = parse(offlineReturnPayloadSchema, op.payload);
      const decision = decideCustody('ASSET_RETURN', { seenHolderId }, current);
      if (decision.outcome === 'APPLY') {
        await this.assets.return(actor, op.entityId, {
          ...input,
          notes: withNote(input.notes, note),
        });
      }
      return decision;
    }
    if (op.type === 'ASSET_REASSIGN') {
      const { seenHolderId, ...input } = parse(offlineReassignPayloadSchema, op.payload);
      const decision = decideCustody(
        'ASSET_REASSIGN',
        { seenHolderId, targetUserId: input.userId },
        current,
      );
      if (decision.outcome === 'APPLY') {
        await this.assets.reassign(actor, op.entityId, {
          ...input,
          notes: withNote(input.notes, note),
        });
      }
      return decision;
    }
    const { seenHolderId, ...input } = parse(offlineAssignPayloadSchema, op.payload);
    const decision = decideCustody(
      'ASSET_ASSIGN',
      { seenHolderId, targetUserId: input.userId },
      current,
    );
    if (decision.outcome === 'APPLY') {
      await this.assets.assign(actor, op.entityId, {
        ...input,
        notes: withNote(input.notes, note),
      });
    }
    return decision;
  }

  private async countStock(
    actor: AuthUser,
    op: OfflineOperation<Record<string, unknown>>,
  ): Promise<CustodyDecision> {
    const input = parse(offlineStockCountPayloadSchema, op.payload);
    const level = await this.prisma.client.stockLevel.findFirst({
      where: {
        companyId: actor.companyId,
        inventoryItemId: input.inventoryItemId,
        stockLocationId: input.stockLocationId,
      },
      select: { quantity: true },
    });
    const decision = decideStockCount(input, { quantity: Number(level?.quantity ?? 0) });
    if (decision.outcome === 'APPLY') {
      await this.stock.countCorrection(actor, {
        inventoryItemId: input.inventoryItemId,
        stockLocationId: input.stockLocationId,
        countedQuantity: input.countedQuantity,
      });
    }
    return decision;
  }

  /** "Recorded offline on the phone at 22 Sep 2026, 10:42" - in the company's own time. */
  private async offlineNote(actor: AuthUser, capturedAt: string): Promise<string> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: actor.companyId },
      select: { timezone: true },
    });
    const when = new Date(capturedAt).toLocaleString('en-GB', {
      timeZone: safeTimeZone(company?.timezone),
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return `Recorded offline on the phone at ${when}.`;
  }
}

class OfflinePayloadError extends Error {}

function parse<T>(
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new OfflinePayloadError(
      'This change was recorded by an older version of the app and cannot be applied.',
    );
  }
  return parsed.data;
}

function withNote(notes: string | null | undefined, note: string): string {
  return notes ? `${notes}\n${note}` : note;
}
