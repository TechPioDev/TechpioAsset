import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type { AuthUser, RecordQualityCheckInput } from '@techpioasset/contracts';
import { DISPOSITION_STATUS, qualityCheckProblem, qualityOutcome } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { tenantFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Quality check on receiving (v2.42).
 *
 * Receiving records that a box arrived; this records whether the contents pass.
 * It is also the step that makes a received asset available - before this,
 * assets created at the dock sat in RECEIVED until somebody edited each one by
 * hand.
 *
 * Additive by design. An uninspected line behaves exactly as it did, so nothing
 * already running on the live server changes because this shipped.
 */
@Injectable()
export class QualityCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The receipt line, with everything needed to judge and act on it. */
  private async lineForCheck(actor: AuthUser, goodsReceiptLineId: string) {
    const line = await this.prisma.client.goodsReceiptLine.findFirst({
      where: {
        id: goodsReceiptLineId,
        goodsReceipt: { ...tenantFilter(actor) },
      },
      select: {
        id: true,
        quantity: true,
        intake: true,
        inventoryItemId: true,
        stockLocationId: true,
        qualityCheck: { select: { id: true, inspectedAt: true } },
        assets: { select: { id: true, assetTag: true, status: true } },
        goodsReceipt: { select: { id: true, grnNumber: true, purchaseOrderId: true } },
      },
    });
    if (!line) throw AppError.notFound('Goods receipt line', goodsReceiptLineId);
    return line;
  }

  /**
   * Record an inspection.
   *
   * The quantities are checked against what the receipt says arrived rather
   * than against anything the caller sends, so an inspection cannot be recorded
   * over a quantity nobody received. The outcome is derived from the counts:
   * "passed" alongside two rejected units is a contradiction, not an input.
   */
  async record(actor: AuthUser, goodsReceiptLineId: string, input: RecordQualityCheckInput) {
    const line = await this.lineForCheck(actor, goodsReceiptLineId);

    if (line.qualityCheck) {
      throw new AppError('CONFLICT', 'This line has already been inspected', {
        detail: `Inspected on ${line.qualityCheck.inspectedAt.toISOString().slice(0, 10)}. A second opinion has to be a deliberate act.`,
      });
    }

    const received = Number(line.quantity);
    const problem = qualityCheckProblem({
      received,
      accepted: input.quantityAccepted,
      rejected: input.quantityRejected,
      reason: input.rejectionReason,
      disposition: input.disposition,
    });
    if (problem) throw new AppError('VALIDATION_FAILED', problem);

    const outcome = qualityOutcome(input.quantityAccepted, input.quantityRejected);

    // For an asset line the inspector names the units that failed, because they
    // are holding them. Anything else would condemn an arbitrary machine.
    const rejectedIds = new Set(input.rejectedAssetIds ?? []);
    if (line.intake === 'ASSET') {
      const known = new Set(line.assets.map((a) => a.id));
      const strangers = [...rejectedIds].filter((id) => !known.has(id));
      if (strangers.length > 0) {
        throw new AppError('VALIDATION_FAILED', 'Some rejected units did not come from this receipt line', {
          detail: `Not from this line: ${strangers.join(', ')}`,
        });
      }
      if (rejectedIds.size !== input.quantityRejected) {
        throw new AppError(
          'VALIDATION_FAILED',
          `${input.quantityRejected} unit(s) rejected but ${rejectedIds.size} named`,
          { detail: 'Name each unit that failed, so the right ones are held back.' },
        );
      }
    }

    const status = input.disposition ? DISPOSITION_STATUS[input.disposition] : null;

    const check = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.qualityCheck.create({
        data: {
          companyId: actor.companyId,
          goodsReceiptLineId,
          outcome,
          quantityInspected: new Prisma.Decimal(received),
          quantityAccepted: new Prisma.Decimal(input.quantityAccepted),
          quantityRejected: new Prisma.Decimal(input.quantityRejected),
          rejectionReason: input.rejectionReason ?? null,
          disposition: input.disposition ?? null,
          notes: input.notes ?? null,
          inspectedById: actor.id,
        },
        select: {
          id: true,
          outcome: true,
          quantityInspected: true,
          quantityAccepted: true,
          quantityRejected: true,
          disposition: true,
          inspectedAt: true,
        },
      });

      if (line.intake === 'ASSET') {
        // Passing units become available - this is the step that was missing.
        // Only from RECEIVED: an asset somebody has already moved on is not
        // dragged backwards by a late inspection.
        const passed = line.assets.filter((a) => !rejectedIds.has(a.id) && a.status === 'RECEIVED');
        if (passed.length > 0) {
          await tx.asset.updateMany({
            where: { id: { in: passed.map((a) => a.id) }, status: 'RECEIVED' },
            data: { status: 'AVAILABLE', updatedById: actor.id },
          });
        }
        if (rejectedIds.size > 0 && status) {
          await tx.asset.updateMany({
            where: { id: { in: [...rejectedIds] }, status: 'RECEIVED' },
            data: { status, updatedById: actor.id },
          });
        }
      } else if (input.quantityRejected > 0 && line.inventoryItemId && line.stockLocationId) {
        // Rejected stock was already counted in when the goods were received, so
        // it has to come back out - otherwise the shelf claims stock that is
        // waiting on the dock to go back to the supplier.
        const amount = new Prisma.Decimal(input.quantityRejected);
        await tx.stockMovement.create({
          data: {
            companyId: actor.companyId,
            inventoryItemId: line.inventoryItemId,
            stockLocationId: line.stockLocationId,
            type: 'ADJUST_DOWN',
            quantity: amount,
            refType: 'QualityCheck',
            refId: created.id,
            actorId: actor.id,
            reason: input.rejectionReason ?? 'Rejected at quality check',
          },
        });
        await tx.stockLevel.update({
          where: {
            inventoryItemId_stockLocationId: {
              inventoryItemId: line.inventoryItemId,
              stockLocationId: line.stockLocationId,
            },
          },
          data: { quantity: { decrement: amount } },
        });
        await tx.inventoryItem.update({
          where: { id: line.inventoryItemId },
          data: { quantityOnHand: { decrement: amount } },
        });
      }

      return created;
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'QualityCheck',
      entityId: check.id,
      newValues: {
        goodsReceiptLineId,
        grnNumber: line.goodsReceipt.grnNumber,
        outcome,
        accepted: input.quantityAccepted,
        rejected: input.quantityRejected,
        disposition: input.disposition ?? null,
        reason: input.rejectionReason ?? null,
      },
    });

    return {
      ...check,
      assetsMadeAvailable:
        line.intake === 'ASSET'
          ? line.assets.filter((a) => !rejectedIds.has(a.id) && a.status === 'RECEIVED').length
          : 0,
    };
  }

  /**
   * One receipt with everything an inspector needs in their hand: what each
   * line was, how much of it arrived, the units it created, and whether it has
   * already been looked at.
   *
   * Assembled here rather than left to the client to stitch together from three
   * calls - on a loading dock that is three chances to be holding a stale
   * answer.
   */
  async findReceipt(actor: AuthUser, goodsReceiptId: string) {
    const receipt = await this.prisma.client.goodsReceipt.findFirst({
      where: { id: goodsReceiptId, ...tenantFilter(actor) },
      select: {
        id: true,
        grnNumber: true,
        receivedAt: true,
        notes: true,
        purchaseOrder: { select: { id: true, poNumber: true, vendor: { select: { name: true } } } },
        lines: {
          select: {
            id: true,
            quantity: true,
            intake: true,
            note: true,
            purchaseOrderLine: { select: { lineNumber: true, description: true } },
            inventoryItem: { select: { id: true, name: true } },
            assets: {
              select: { id: true, assetTag: true, serialNumber: true, status: true },
              orderBy: { sourceUnitIndex: 'asc' },
            },
            qualityCheck: {
              select: {
                id: true,
                outcome: true,
                quantityAccepted: true,
                quantityRejected: true,
                rejectionReason: true,
                disposition: true,
                inspectedAt: true,
              },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!receipt) throw AppError.notFound('Goods receipt', goodsReceiptId);
    return receipt;
  }

  /** The inspections on one receipt, so a receiving screen can show them. */
  async listForReceipt(actor: AuthUser, goodsReceiptId: string) {
    const receipt = await this.prisma.client.goodsReceipt.findFirst({
      where: { id: goodsReceiptId, ...tenantFilter(actor) },
      select: { id: true },
    });
    if (!receipt) throw AppError.notFound('Goods receipt', goodsReceiptId);

    return this.prisma.client.qualityCheck.findMany({
      where: { ...tenantFilter(actor), goodsReceiptLine: { goodsReceiptId } },
      select: {
        id: true,
        goodsReceiptLineId: true,
        outcome: true,
        quantityInspected: true,
        quantityAccepted: true,
        quantityRejected: true,
        rejectionReason: true,
        disposition: true,
        notes: true,
        inspectedAt: true,
        inspectedBy: { select: { id: true, email: true } },
      },
      orderBy: { inspectedAt: 'desc' },
      // Bounded: a receipt with more lines than this is not a receipt.
      take: 200,
    });
  }
}
