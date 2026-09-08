import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import type {
  AuthUser,
  ConvertPurchaseRequestInput,
  CreatePurchaseRequestInput,
  DecidePurchaseRequestInput,
  PrListQuery,
  ReceiveGrnInput,
} from '@techpioasset/contracts';
import {
  PERMISSIONS,
  canApprovePurchaseRequest,
  canTransitionPurchaseRequest,
  needsFinanceApproval,
  losingQuoteMessage,
  overReceiptMessage,
  rollupPurchaseOrderStatus,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { buildOrderBy, paginate } from '../common/paginate.js';
import { AuditService } from '../audit/audit.service.js';
import { BudgetsService } from '../budgets/budgets.service.js';
import { RfqService } from './rfq.service.js';
import { StockService } from '../stock/stock.service.js';
import { AppConfig } from '../config/config.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService, type TenantTxClient } from '../prisma/prisma.service.js';

const SORTABLE = ['createdAt', 'prNumber', 'status'] as const;

/**
 * v2.4 Procurement: PR lifecycle -> PO -> GRN. The over-receipt guard is the
 * seat-pool pattern applied to purchase-order lines: an atomic conditional
 * increment of receivedQuantity whose WHERE clause is the hard limit, backed by
 * the DB CHECK. Receipts are append-only facts.
 */
@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
    private readonly budgets: BudgetsService,
    private readonly rfq: RfqService,
    private readonly stock: StockService,
  ) {}

  // ── purchase requests ──────────────────────────────────────────────────────

  /**
   * OWN-scope actors (employees) see only purchase requests they raised -
   * before this, procurement:pr:read exposed every PR in the company, with
   * estimated totals and requester identities, to any employee (v2.12
   * least-privilege audit, G1). ANDed like every other scope filter so no
   * query parameter can widen it.
   */
  private prScope(actor: AuthUser): Prisma.PurchaseRequestWhereInput {
    return actor.scope === 'OWN' ? { requesterId: actor.id } : {};
  }

  async listPrs(actor: AuthUser, query: PrListQuery) {
    const where: Prisma.PurchaseRequestWhereInput = {
      AND: [
        { companyId: actor.companyId },
        this.prScope(actor),
        {
          ...(query.status ? { status: query.status } : {}),
          ...(query.mine ? { requesterId: actor.id } : {}),
          ...(query.q ? { OR: [{ prNumber: { contains: query.q, mode: 'insensitive' } }, { justification: { contains: query.q, mode: 'insensitive' } }] } : {}),
        },
      ],
    };
    return paginate(query, {
      count: () => this.prisma.client.purchaseRequest.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.purchaseRequest.findMany({
          where,
          skip,
          take,
          orderBy: buildOrderBy(query.sort, query.order, SORTABLE, 'createdAt'),
          select: this.prSelect(),
        }),
    });
  }

  async findPr(actor: AuthUser, id: string) {
    const pr = await this.prisma.client.purchaseRequest.findFirst({
      // Scoped like the list: someone else's PR reads as 404 for an
      // OWN-scope actor, never as data.
      where: { AND: [{ id, companyId: actor.companyId }, this.prScope(actor)] },
      select: { ...this.prSelect(), lines: { orderBy: { lineNumber: 'asc' }, select: { id: true, lineNumber: true, description: true, quantity: true, estimatedUnitPrice: true, inventoryItemId: true } } },
    });
    if (!pr) throw AppError.notFound('Purchase request', id);
    return pr;
  }

  async createPr(actor: AuthUser, input: CreatePurchaseRequestInput) {
    // v2.9 C2: charging is optional. A company with no cost centres keeps the
    // v2.4 behaviour exactly - budgets are additive, not a rewrite.
    if (input.costCentreId) await this.budgets.assertChargeable(actor, input.costCentreId);
    const estimatedTotal = input.lines.reduce(
      (sum, l) => sum + (l.estimatedUnitPrice ? Number(l.estimatedUnitPrice) * l.quantity : 0),
      0,
    );
    const pr = await this.withNumberedTransaction(actor.companyId, 'purchaseRequest', 'PR', (tx, prNumber) =>
      tx.purchaseRequest.create({
      data: {
        companyId: actor.companyId,
        prNumber,
        requesterId: actor.id,
        justification: input.justification,
        neededBy: input.neededBy ?? null,
        currency: input.currency ?? null,
        costCentreId: input.costCentreId ?? null,
        estimatedTotal: estimatedTotal > 0 ? new Prisma.Decimal(estimatedTotal.toFixed(2)) : null,
        createdById: actor.id,
        updatedById: actor.id,
        lines: {
          create: input.lines.map((l, i) => ({
            lineNumber: i + 1,
            description: l.description,
            quantity: new Prisma.Decimal(l.quantity),
            estimatedUnitPrice: l.estimatedUnitPrice ? new Prisma.Decimal(l.estimatedUnitPrice) : null,
            inventoryItemId: l.inventoryItemId ?? null,
          })),
        },
      },
      select: { id: true },
      }),
    );
    return this.findPr(actor, pr.id);
  }

  async submitPr(actor: AuthUser, id: string) {
    const pr = await this.loadPr(actor, id);
    // Only the requester progresses their own draft.
    if (pr.requesterId !== actor.id) throw AppError.forbidden('Only the requester can submit this PR');
    this.assertTransition(pr.status, 'SUBMITTED');
    await this.prisma.client.purchaseRequest.update({
      where: { id },
      data: { status: 'SUBMITTED', submittedAt: new Date(), updatedById: actor.id },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.PR_SUBMITTED,
      entityType: 'PurchaseRequest',
      entityId: id,
    });
    return this.findPr(actor, id);
  }

  async decidePr(actor: AuthUser, id: string, input: DecidePurchaseRequestInput) {
    const pr = await this.loadPr(actor, id);
    // SoD: the requester never approves their own purchase (hard block).
    if (!canApprovePurchaseRequest(actor.id, pr.requesterId)) {
      throw AppError.forbidden('You cannot decide your own purchase request');
    }
    const target = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    this.assertTransition(pr.status, target);

    // Above the Finance threshold the approver must also hold the cost
    // permission (the standing Finance + Super Admin rule).
    if (
      input.decision === 'APPROVE' &&
      needsFinanceApproval(pr.estimatedTotal?.toString() ?? null, this.config.get('PR_FINANCE_THRESHOLD')) &&
      !actor.permissions.includes(PERMISSIONS.ASSETS_COST_READ)
    ) {
      throw AppError.forbidden(
        'This request is at or above the Finance threshold - a Finance approver must decide it',
      );
    }

    // v2.9 C2 — approving a charged request commits its estimate against the
    // budget. The commitment and the approval it pays for are one transaction:
    // an approval that outlived a failed commit would be spend with no cover.
    const charge =
      target === 'APPROVED' && pr.costCentreId
        ? { costCentreId: pr.costCentreId, requested: this.estimateForBudget(pr) }
        : null;
    const committed = await this.prisma.client.$transaction(async (tx) => {
      const budget = charge ? await this.budgets.commit(tx, actor, { ...charge, when: new Date() }) : null;
      await tx.purchaseRequest.update({
        where: { id },
        data: {
          status: target,
          ...(target === 'APPROVED'
            ? { approvedById: actor.id, approvedAt: new Date() }
            : { rejectedReason: input.reason ?? null }),
          ...(budget && charge
            ? { budgetId: budget.id, committedAmount: charge.requested, committedAt: new Date() }
            : {}),
          updatedById: actor.id,
        },
      });
      return budget && charge ? { budget, amount: charge.requested } : null;
    });
    if (committed) {
      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.BUDGET_COMMITTED,
        entityType: 'Budget',
        entityId: committed.budget.id,
        newValues: {
          purchaseRequestId: id,
          amount: committed.amount.toFixed(2),
          budget: committed.budget.name,
          currency: committed.budget.currency,
        },
      });
    }
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: target === 'APPROVED' ? AuditAction.PR_APPROVED : AuditAction.PR_REJECTED,
      entityType: 'PurchaseRequest',
      entityId: id,
      reason: input.reason ?? undefined,
    });
    return this.findPr(actor, id);
  }

  /** APPROVED -> CONVERTED: spawns a draft PO carrying the PR's lines. */
  /**
   * v2.9 C2 — cancelling gives the money back.
   *
   * A budget that only ever goes up is a budget nobody can correct, so the
   * release is part of the same transaction as the cancellation and is guarded
   * so it can happen exactly once.
   */
  async cancelPr(actor: AuthUser, id: string, reason?: string | null) {
    const pr = await this.loadPr(actor, id);
    // Requesters cancel their own; approvers cancel anyone's.
    if (pr.requesterId !== actor.id && !actor.permissions.includes(PERMISSIONS.PROCUREMENT_PR_APPROVE)) {
      throw AppError.forbidden('Only the requester or an approver can cancel this request');
    }
    this.assertTransition(pr.status, 'CANCELLED');

    const released = await this.prisma.client.$transaction(async (tx) => {
      // The cancellation itself is a guarded conditional update: two people
      // cancelling at once both read APPROVED, and only one may act on it.
      const cancelled = await tx.$executeRaw`
        UPDATE "purchase_requests"
           SET "status" = 'CANCELLED'::"PurchaseRequestStatus",
               "rejectedReason" = ${reason ?? null},
               "updatedById" = ${actor.id},
               "updatedAt" = NOW()
         WHERE "id" = ${id}
           AND "companyId" = ${actor.companyId}
           AND "status" <> 'CANCELLED'::"PurchaseRequestStatus"
           AND "status" <> 'CONVERTED'::"PurchaseRequestStatus"`;
      if (cancelled === 0) {
        throw new AppError(
          'ILLEGAL_STATE_TRANSITION',
          'This purchase request has already been cancelled or converted',
        );
      }
      // Only the winner gives the money back - and release is itself guarded,
      // so even that cannot credit the budget twice.
      return this.budgets.release(tx, actor.companyId, id);
    });
    if (released) await this.recordRelease(actor, id, released, 'purchase request cancelled');
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.PR_CANCELLED,
      entityType: 'PurchaseRequest',
      entityId: id,
      reason: reason ?? undefined,
    });
    return this.findPr(actor, id);
  }

  private async recordRelease(
    actor: AuthUser,
    purchaseRequestId: string,
    released: { budgetId: string; amount: Prisma.Decimal },
    why: string,
  ) {
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.BUDGET_RELEASED,
      entityType: 'Budget',
      entityId: released.budgetId,
      previousValues: { purchaseRequestId, amount: released.amount.toFixed(2) },
      reason: why,
    });
  }

  async convertPr(actor: AuthUser, id: string, input: ConvertPurchaseRequestInput) {
    const pr = await this.prisma.client.purchaseRequest.findFirst({
      where: { id, companyId: actor.companyId },
      select: { id: true, status: true, currency: true, requesterId: true, lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!pr) throw AppError.notFound('Purchase request', id);
    this.assertTransition(pr.status, 'CONVERTED');

    // v2.9 C3 — if this request went out to quote, the quoting decides what is
    // ordered. This is where "a losing quote can never become a PO" is enforced
    // for the ordinary path; the CHECK constraint is what enforces it for every
    // other path.
    const quoting = await this.rfq.awardStateFor(actor, id);
    if (quoting && !quoting.awardedQuote) {
      throw AppError.conflict(
        'CONFLICT',
        `${quoting.rfq.rfqNumber} is out for quotes on this request. Award one (with a reason) before ordering.`,
      );
    }
    const awarded = quoting?.awardedQuote ?? null;
    if (awarded && input.quoteId && input.quoteId !== awarded.id) {
      const attempted = quoting!.rfq.quotes.find((q) => q.id === input.quoteId);
      throw AppError.conflict(
        'CONFLICT',
        losingQuoteMessage({ vendorName: attempted?.vendor.name ?? 'That vendor' }, { vendorName: awarded.vendor.name }),
      );
    }
    if (awarded && input.vendorId && input.vendorId !== awarded.vendorId) {
      throw AppError.conflict(
        'CONFLICT',
        `This request was awarded to ${awarded.vendor.name}; the order cannot go to a different vendor.`,
      );
    }

    const vendorId = awarded?.vendorId ?? input.vendorId;
    if (!vendorId) {
      throw new AppError('VALIDATION_FAILED', 'Pick the vendor the order goes to');
    }
    const vendor = await this.prisma.client.vendor.findFirst({
      where: { id: vendorId, companyId: actor.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!vendor) throw AppError.notFound('Vendor', vendorId);

    // Awarded prices beat estimates: the order must match what the vendor quoted.
    const orderLines = awarded?.lines.length
      ? awarded.lines.map((l) => ({
          lineNumber: l.lineNumber,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        }))
      : pr.lines.map((l) => ({
          lineNumber: l.lineNumber,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.estimatedUnitPrice ?? new Prisma.Decimal(0),
          lineTotal: new Prisma.Decimal((Number(l.estimatedUnitPrice ?? 0) * Number(l.quantity)).toFixed(2)),
        }));
    const currency = awarded?.currency ?? input.currency ?? pr.currency ?? 'USD';

    // v2.47 - name the catalogue listing each line is buying, where it can be
    // known for certain rather than guessed.
    //
    // A selection already records which offer was chosen for this request, so
    // nothing new has to be asked of anybody. A line is linked when its
    // description is exactly the product that was selected, and otherwise only
    // when there is one selection and one line, which cannot be ambiguous. A
    // line that matches neither is left unlinked: a wrong provenance is worse
    // than a missing one, and the asset screen can set it by hand later.
    const selections = await this.prisma.client.procurementSelection.findMany({
      where: { companyId: actor.companyId, purchaseRequestId: id, deselectedAt: null },
      select: { vendorProductId: true, productName: true },
    });
    const byName = new Map(
      selections.map((sel) => [sel.productName.trim().toLowerCase(), sel.vendorProductId]),
    );
    const linkedLines = orderLines.map((line) => {
      const exact = byName.get(line.description.trim().toLowerCase());
      const unambiguous =
        selections.length === 1 && orderLines.length === 1 ? selections[0]!.vendorProductId : null;
      const vendorProductId = exact ?? unambiguous ?? null;
      return vendorProductId ? { ...line, vendorProductId } : line;
    });

    const subtotal = orderLines.reduce((sum, l) => sum + Number(l.lineTotal), 0);

    const po = await this.withNumberedTransaction(actor.companyId, 'purchaseOrder', 'PO', async (tx, poNumber) => {
      const created = await tx.purchaseOrder.create({
        data: {
          companyId: actor.companyId,
          poNumber,
          vendorId: vendor.id,
          currency,
          subtotal: new Prisma.Decimal(subtotal.toFixed(2)),
          total: new Prisma.Decimal(subtotal.toFixed(2)),
          createdById: actor.id,
          updatedById: actor.id,
          lines: { create: linkedLines },
        },
        select: { id: true, poNumber: true },
      });
      await tx.purchaseRequest.update({
        where: { id },
        data: { status: 'CONVERTED', convertedPoId: created.id, updatedById: actor.id },
      });
      if (awarded) {
        // The link that answers "why this vendor at this price?" from the order
        // itself. The CHECK constraint refuses this write for any quote the
        // database does not agree is AWARDED.
        await tx.quote.update({ where: { id: awarded.id }, data: { convertedPoId: created.id } });
      }
      return created;
    });

    return { purchaseRequestId: id, purchaseOrderId: po.id, poNumber: po.poNumber };
  }

  // ── purchase orders ────────────────────────────────────────────────────────

  async issuePo(actor: AuthUser, id: string) {
    const po = await this.loadPo(actor, id);
    if (po.status !== 'DRAFT') {
      throw new AppError('ILLEGAL_STATE_TRANSITION', `Only a draft PO can be issued (this one is ${po.status})`);
    }
    if (po.lines.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'Add at least one line before issuing');
    }
    await this.prisma.client.purchaseOrder.update({
      where: { id },
      data: { status: 'ISSUED', issuedDate: new Date(), updatedById: actor.id },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.PO_ISSUED,
      entityType: 'PurchaseOrder',
      entityId: id,
    });
    // The requester whose PR became this PO hears their order went out.
    const sourcePr = await this.prisma.client.purchaseRequest.findFirst({
      where: { convertedPoId: id },
      select: { requesterId: true },
    });
    if (sourcePr) {
      await this.notifications.notify({
        companyId: actor.companyId,
        userId: sourcePr.requesterId,
        type: 'ASSET_ORDERED',
        title: `Ordered: ${po.poNumber}`,
        body: 'Your approved purchase request has been ordered from the vendor.',
        linkPath: `/procurement/orders/${id}`,
        entityType: 'PurchaseOrder',
        entityId: id,
      });
    }
    return this.loadPo(actor, id);
  }

  async cancelPo(actor: AuthUser, id: string, reason?: string | null) {
    const po = await this.loadPo(actor, id);
    if (po.status !== 'DRAFT' && po.status !== 'ISSUED') {
      throw new AppError('ILLEGAL_STATE_TRANSITION', `A ${po.status} PO cannot be cancelled`);
    }
    const receipts = await this.prisma.client.goodsReceipt.count({ where: { purchaseOrderId: id } });
    if (receipts > 0) {
      throw AppError.conflict('CONFLICT', 'Goods were already received against this PO - close it instead');
    }
    // v2.9 C2 — no goods, no spend: give the originating request's commitment
    // back. Without this a cancelled order would hold its budget forever.
    const sourceRequests = await this.prisma.client.purchaseRequest.findMany({
      where: { convertedPoId: id, companyId: actor.companyId, committedAmount: { not: null } },
      select: { id: true },
    });
    const released = await this.prisma.client.$transaction(async (tx) => {
      const backs: { id: string; budgetId: string; amount: Prisma.Decimal }[] = [];
      for (const request of sourceRequests) {
        const back = await this.budgets.release(tx, actor.companyId, request.id);
        if (back) backs.push({ id: request.id, ...back });
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'CANCELLED', updatedById: actor.id },
      });
      return backs;
    });
    for (const back of released) {
      await this.recordRelease(actor, back.id, back, `purchase order ${po.poNumber} cancelled`);
    }
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.PO_CANCELLED,
      entityType: 'PurchaseOrder',
      entityId: id,
      reason: reason ?? undefined,
    });
    return this.loadPo(actor, id);
  }

  // ── goods receipts (the guarded intake) ────────────────────────────────────

  async receive(actor: AuthUser, purchaseOrderId: string, input: ReceiveGrnInput) {
    const po = await this.loadPo(actor, purchaseOrderId);
    if (po.status !== 'ISSUED' && po.status !== 'PARTIALLY_RECEIVED') {
      throw new AppError('ILLEGAL_STATE_TRANSITION', `A ${po.status} PO cannot receive goods`);
    }
    const lineById = new Map(po.lines.map((l) => [l.id, l]));
    for (const line of input.lines) {
      const poLine = lineById.get(line.purchaseOrderLineId);
      if (!poLine) throw AppError.notFound('PO line', line.purchaseOrderLineId);
      if (line.intake === 'STOCK' && (!line.stockLocationId || !line.inventoryItemId)) {
        throw new AppError('VALIDATION_FAILED', 'STOCK intake needs a location and an inventory item');
      }
      if (line.intake === 'STOCK' && line.inventoryItemId) {
        // v2.9 C4: a lot-tracked item cannot arrive anonymously, or nothing
        // downstream could tell one batch from another.
        const tracking = await this.stock.batchTrackingFor(actor.companyId, line.inventoryItemId);
        if (tracking?.batchTracked && !line.batchNumber) {
          throw new AppError(
            'VALIDATION_FAILED',
            `${tracking.name} is lot-tracked, so this receipt needs the batch number from the box`,
          );
        }
      }
      if (line.intake === 'ASSET') {
        if (!line.categoryId) {
          throw new AppError('VALIDATION_FAILED', 'ASSET intake needs a category - every asset is filed under one');
        }
        // Half a laptop cannot be an asset. Fractions belong to STOCK intake.
        if (!Number.isInteger(Number(line.quantity))) {
          throw new AppError(
            'VALIDATION_FAILED',
            `ASSET intake must be a whole number of units, not ${line.quantity}`,
          );
        }
        for (const [field, values] of [
          ['serialNumbers', line.serialNumbers],
          ['assetTags', line.assetTags],
        ] as const) {
          if (!values?.length) continue;
          if (values.length > Number(line.quantity)) {
            throw new AppError(
              'VALIDATION_FAILED',
              `${values.length} ${field} given for ${line.quantity} unit(s) - there is nothing to attach the extras to`,
            );
          }
          if (new Set(values).size !== values.length) {
            throw new AppError('VALIDATION_FAILED', `Two units cannot share the same ${field.slice(0, -1)}`);
          }
        }
      }
    }
    await this.assertAssetIntakeIsReceivable(actor, input.lines);
    // Validate stock refs inside the tenant before mutating anything.
    for (const line of input.lines.filter((l) => l.intake === 'STOCK')) {
      const [location, item] = await Promise.all([
        this.prisma.client.stockLocation.findFirst({
          where: { id: line.stockLocationId!, companyId: actor.companyId, deletedAt: null },
          select: { id: true },
        }),
        this.prisma.client.inventoryItem.findFirst({
          where: { id: line.inventoryItemId!, companyId: actor.companyId, deletedAt: null },
          select: { id: true },
        }),
      ]);
      if (!location) throw AppError.notFound('Stock location', line.stockLocationId!);
      if (!item) throw AppError.notFound('Inventory item', line.inventoryItemId!);
    }

    // Concurrent receivers can race the sequential GRN number; the unique
    // constraint catches the loser, and we retry the whole (rolled-back)
    // transaction with a fresh number rather than surfacing a 500.
    const grn = await this.withGrnNumberRetry(async (grnNumber) =>
      this.prisma.client.$transaction(async (tx) => {
      // 1. Guarded increments - the WHERE clause is the over-receipt limit.
      for (const line of input.lines) {
        const poLine = lineById.get(line.purchaseOrderLineId)!;
        const affected = await tx.$executeRaw`
          UPDATE "purchase_order_lines"
             SET "receivedQuantity" = "receivedQuantity" + ${new Prisma.Decimal(line.quantity)}
           WHERE "id" = ${line.purchaseOrderLineId}
             AND "receivedQuantity" + ${new Prisma.Decimal(line.quantity)} <= "quantity"`;
        if (affected === 0) {
          throw AppError.conflict(
            'CONFLICT',
            overReceiptMessage(
              { quantity: poLine.quantity.toString(), receivedQuantity: poLine.receivedQuantity.toString() },
              line.quantity,
            ),
          );
        }
      }

      // 2. The receipt itself - an append-only fact. Lines are created one at a
      // time rather than nested, so each stored line stays paired with the input
      // that produced it; steps 3 and 3b both need that pairing.
      const created = await tx.goodsReceipt.create({
        data: {
          companyId: actor.companyId,
          grnNumber,
          purchaseOrderId,
          receivedById: actor.id,
          notes: input.notes ?? null,
        },
        select: { id: true, grnNumber: true },
      });
      const receiptLines: { input: (typeof input.lines)[number]; id: string; quantity: Prisma.Decimal }[] = [];
      for (const l of input.lines) {
        const stored = await tx.goodsReceiptLine.create({
          data: {
            goodsReceiptId: created.id,
            purchaseOrderLineId: l.purchaseOrderLineId,
            quantity: new Prisma.Decimal(l.quantity),
            intake: l.intake,
            stockLocationId: l.stockLocationId ?? null,
            inventoryItemId: l.inventoryItemId ?? null,
            note: l.note ?? null,
          },
          select: { id: true, quantity: true },
        });
        receiptLines.push({ input: l, id: stored.id, quantity: stored.quantity });
      }

      // Declared per attempt, for the same reason as createdAssets below.
      const batchesReceived: { batchId: string; batchNumber: string }[] = [];
      // 3. STOCK intake posts to the ledger and bumps the caches.
      for (const { input: inputLine, id, quantity } of receiptLines) {
        const grnLine = {
          id,
          quantity,
          intake: inputLine.intake,
          stockLocationId: inputLine.stockLocationId ?? null,
          inventoryItemId: inputLine.inventoryItemId ?? null,
        };
        if (grnLine.intake !== 'STOCK') continue;
        await tx.stockMovement.create({
          data: {
            companyId: actor.companyId,
            inventoryItemId: grnLine.inventoryItemId!,
            stockLocationId: grnLine.stockLocationId!,
            type: 'RECEIPT',
            quantity: grnLine.quantity,
            refType: 'GoodsReceiptLine',
            refId: grnLine.id,
            actorId: actor.id,
          },
        });
        await tx.stockLevel.upsert({
          where: {
            inventoryItemId_stockLocationId: {
              inventoryItemId: grnLine.inventoryItemId!,
              stockLocationId: grnLine.stockLocationId!,
            },
          },
          create: {
            companyId: actor.companyId,
            inventoryItemId: grnLine.inventoryItemId!,
            stockLocationId: grnLine.stockLocationId!,
            quantity: grnLine.quantity,
          },
          update: { quantity: { increment: grnLine.quantity } },
        });
        if (inputLine.batchNumber) {
          // The batch and the receipt that created it cannot exist without each
          // other: same transaction, and the lot carries the line that brought
          // it in, so "where did this come from?" survives.
          const batchId = await this.stock.receiveIntoBatch(tx, actor, {
            inventoryItemId: grnLine.inventoryItemId!,
            stockLocationId: grnLine.stockLocationId!,
            quantity: grnLine.quantity,
            batchNumber: inputLine.batchNumber,
            expiryDate: inputLine.expiryDate ?? null,
            sourceGrnLineId: grnLine.id,
          });
          batchesReceived.push({ batchId, batchNumber: inputLine.batchNumber });
          await tx.stockMovement.updateMany({
            where: { refType: 'GoodsReceiptLine', refId: grnLine.id },
            data: { stockBatchId: batchId },
          });
        }
        await tx.inventoryItem.update({
          where: { id: grnLine.inventoryItemId! },
          data: { quantityOnHand: { increment: grnLine.quantity }, lastPurchaseDate: new Date() },
        });
      }

      // 3b. ASSET intake brings the things themselves into existence - v2.9 C1.
      // Before this, receiving a laptop recorded that a laptop had arrived and
      // then left somebody to re-type it into the asset register by hand.
      // Declared per attempt: withGrnNumberRetry rolls the whole transaction
      // back and runs it again, and a list that outlived that would double.
      const createdAssets: { id: string; assetTag: string; name: string; serialNumber: string | null }[] = [];
      const assetLines = receiptLines.filter((l) => l.input.intake === 'ASSET');
      if (assetLines.length) {
        const detail = await tx.purchaseOrder.findUniqueOrThrow({
          where: { id: purchaseOrderId },
          select: {
            poNumber: true,
            vendorId: true,
            currency: true,
            lines: {
              select: {
                id: true,
                lineNumber: true,
                description: true,
                unitPrice: true,
                // v2.47 - carried onto every unit this line brings in, so a
                // laptop on somebody's desk can be traced back to the listing
                // it was bought from.
                vendorProductId: true,
                vendorProduct: { select: { brand: true, model: true, specs: true } },
              },
            },
          },
        });
        const poLineById = new Map(detail.lines.map((l) => [l.id, l]));
        const receivedAt = new Date();
        for (const line of assetLines) {
          const poLine = poLineById.get(line.input.purchaseOrderLineId)!;
          const units = Number(line.quantity);
          for (let unit = 0; unit < units; unit += 1) {
            createdAssets.push(
              await tx.asset.create({
                data: {
                  companyId: actor.companyId,
                  // A provisional label that says where the thing came from; the
                  // completion step renames it to whatever is on the sticker.
                  assetTag: line.input.assetTags?.[unit] ?? `${grnNumber}-${poLine.lineNumber}-${unit + 1}`,
                  name: poLine.description,
                  categoryId: line.input.categoryId!,
                  subcategoryId: line.input.subcategoryId ?? null,
                  serialNumber: line.input.serialNumbers?.[unit] ?? null,
                  // The chain: vendor -> product -> order line -> this unit.
                  vendorProductId: poLine.vendorProductId,
                  // Inherited from the listing rather than retyped. The order
                  // line carries a description agreed in writing; the make and
                  // model of the thing are the supplier's own facts about it,
                  // and leaving them blank here is what left the register full
                  // of assets nobody could identify.
                  brand: poLine.vendorProduct?.brand ?? null,
                  model: poLine.vendorProduct?.model ?? null,
                  qrToken: ulid(),
                  // Received, not available: it is in the building but nobody has
                  // checked, configured or tagged it yet.
                  status: 'RECEIVED',
                  purchaseDate: receivedAt,
                  purchaseCost: poLine.unitPrice,
                  currency: detail.currency,
                  vendorId: detail.vendorId,
                  purchaseOrderNumber: detail.poNumber,
                  sourceGrnLineId: line.id,
                  sourceUnitIndex: unit + 1,
                  createdById: actor.id,
                },
                select: { id: true, assetTag: true, name: true, serialNumber: true },
              }),
            );
          }
        }
      }

      // 4. The PO status its lines now imply.
      const lines = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId },
        select: { quantity: true, receivedQuantity: true },
      });
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          status: rollupPurchaseOrderStatus(
            lines.map((l) => ({ quantity: l.quantity.toString(), receivedQuantity: l.receivedQuantity.toString() })),
          ),
          updatedById: actor.id,
        },
      });
        return { ...created, assets: createdAssets, batches: batchesReceived };
      }),
    );

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.GRN_RECEIVED,
      entityType: 'PurchaseOrder',
      entityId: purchaseOrderId,
      newValues: {
        grnNumber: grn.grnNumber,
        lines: input.lines.length,
        assetsCreated: grn.assets.length,
        ...(grn.batches.length ? { lots: grn.batches.map((b) => b.batchNumber) } : {}),
      },
    });
    // One row per asset, so "where did this laptop come from?" is answerable
    // from the asset's own history rather than only from the receipt's.
    for (const asset of grn.assets) {
      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.ASSET_CREATED,
        entityType: 'Asset',
        entityId: asset.id,
        newValues: {
          assetTag: asset.assetTag,
          name: asset.name,
          serialNumber: asset.serialNumber,
          source: `Goods receipt ${grn.grnNumber}`,
        },
      });
    }
    if (po.createdById && po.createdById !== actor.id) {
      await this.notifications.notify({
        companyId: actor.companyId,
        userId: po.createdById,
        type: 'ASSET_RECEIVED',
        title: `Goods received: ${grn.grnNumber}`,
        body: grn.assets.length
          ? `${input.lines.length} line(s) received against ${po.poNumber}; ${grn.assets.length} asset(s) created.`
          : `${input.lines.length} line(s) received against ${po.poNumber}.`,
        linkPath: `/procurement/orders/${purchaseOrderId}`,
        entityType: 'PurchaseOrder',
        entityId: purchaseOrderId,
      });
    }
    // Additive: callers that only read the PO are unaffected, and the receiving
    // screen can now show what it just brought into existence.
    return {
      ...(await this.loadPo(actor, purchaseOrderId)),
      grnNumber: grn.grnNumber,
      assetsCreated: grn.assets,
      batchesReceived: grn.batches,
    };
  }

  async listPos(actor: AuthUser, query: PrListQuery) {
    const where: Prisma.PurchaseOrderWhereInput = {
      companyId: actor.companyId,
      ...(query.q ? { poNumber: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    return paginate(query, {
      count: () => this.prisma.client.purchaseOrder.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.purchaseOrder.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            poNumber: true,
            status: true,
            issuedDate: true,
            currency: true,
            total: true,
            vendor: { select: { id: true, name: true } },
            _count: { select: { receipts: true } },
          },
        }),
    });
  }

  async findPo(actor: AuthUser, id: string) {
    const po = await this.prisma.client.purchaseOrder.findFirst({
      where: { id, companyId: actor.companyId },
      select: {
        id: true,
        poNumber: true,
        status: true,
        issuedDate: true,
        expectedDate: true,
        currency: true,
        subtotal: true,
        total: true,
        notes: true,
        vendor: { select: { id: true, name: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          select: { id: true, lineNumber: true, description: true, quantity: true, unitPrice: true, lineTotal: true, receivedQuantity: true },
        },
        receipts: {
          orderBy: { receivedAt: 'desc' },
          select: {
            id: true,
            grnNumber: true,
            receivedAt: true,
            receivedById: true,
            notes: true,
            lines: { select: { id: true, purchaseOrderLineId: true, quantity: true, intake: true } },
          },
        },
      },
    });
    if (!po) throw AppError.notFound('Purchase order', id);
    return po;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private assertTransition(from: string, to: string) {
    if (!canTransitionPurchaseRequest(from as never, to as never)) {
      throw new AppError('ILLEGAL_STATE_TRANSITION', `A ${from} purchase request cannot become ${to}`);
    }
  }

  private async loadPr(actor: AuthUser, id: string) {
    const pr = await this.prisma.client.purchaseRequest.findFirst({
      where: { id, companyId: actor.companyId },
      select: {
        id: true,
        status: true,
        requesterId: true,
        estimatedTotal: true,
        costCentreId: true,
        prNumber: true,
      },
    });
    if (!pr) throw AppError.notFound('Purchase request', id);
    return pr;
  }

  /**
   * v2.9 C2 — what a charged request holds against its budget.
   *
   * A request with no estimate cannot commit: reserving zero would let an
   * unpriced purchase pass a limit it has not been measured against, which is
   * exactly the hole a budget exists to close.
   */
  private estimateForBudget(pr: { estimatedTotal: Prisma.Decimal | null; prNumber: string }) {
    if (pr.estimatedTotal === null || pr.estimatedTotal.lessThanOrEqualTo(0)) {
      throw new AppError(
        'VALIDATION_FAILED',
        `${pr.prNumber} is charged to a cost centre, so it needs an estimated cost before approval`,
      );
    }
    return pr.estimatedTotal;
  }

  /**
   * v2.9 C1 — everything an ASSET line needs, checked before the receipt starts.
   * A receipt that fails halfway is worse than one refused up front: the goods
   * are physically on the dock either way, and the clerk needs to know now.
   */
  private async assertAssetIntakeIsReceivable(actor: AuthUser, lines: ReceiveGrnInput['lines']) {
    const assetLines = lines.filter((l) => l.intake === 'ASSET');
    if (!assetLines.length) return;

    const categoryIds = [...new Set(assetLines.map((l) => l.categoryId!))];
    const subcategoryIds = [...new Set(assetLines.flatMap((l) => (l.subcategoryId ? [l.subcategoryId] : [])))];
    const [categories, subcategories] = await Promise.all([
      this.prisma.client.category.findMany({
        where: { id: { in: categoryIds }, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      }),
      subcategoryIds.length
        ? // Subcategories are scoped through their category, not directly.
          this.prisma.client.subcategory.findMany({
            where: { id: { in: subcategoryIds }, deletedAt: null, category: { companyId: actor.companyId } },
            select: { id: true, categoryId: true },
          })
        : Promise.resolve([] as { id: string; categoryId: string }[]),
    ]);
    const foundCategories = new Set(categories.map((c) => c.id));
    for (const id of categoryIds) if (!foundCategories.has(id)) throw AppError.notFound('Category', id);
    const parentOf = new Map(subcategories.map((s) => [s.id, s.categoryId]));
    for (const line of assetLines) {
      if (!line.subcategoryId) continue;
      const parent = parentOf.get(line.subcategoryId);
      if (!parent) throw AppError.notFound('Subcategory', line.subcategoryId);
      if (parent !== line.categoryId) {
        throw new AppError('VALIDATION_FAILED', 'That subcategory belongs to a different category');
      }
    }

    // Serials and tags are unique per company. The database enforces it, but a
    // constraint violation mid-receipt is a 409 with no useful detail, so say
    // which value clashes with which existing asset while we still can.
    const serials = assetLines.flatMap((l) => l.serialNumbers ?? []);
    const tags = assetLines.flatMap((l) => l.assetTags ?? []);
    for (const [label, values] of [
      ['Serial number', serials],
      ['Asset tag', tags],
    ] as const) {
      if (new Set(values).size !== values.length) {
        throw new AppError('VALIDATION_FAILED', `The same ${label.toLowerCase()} appears on two lines of this receipt`);
      }
    }
    const clashes = await this.prisma.client.asset.findMany({
      where: {
        companyId: actor.companyId,
        deletedAt: null,
        OR: [
          ...(serials.length ? [{ serialNumber: { in: serials } }] : []),
          ...(tags.length ? [{ assetTag: { in: tags } }] : []),
        ],
      },
      select: { assetTag: true, serialNumber: true },
      take: 5,
    });
    if (clashes.length) {
      const clash = clashes[0]!;
      const isSerial = clash.serialNumber !== null && serials.includes(clash.serialNumber);
      throw AppError.conflict(
        'CONFLICT',
        isSerial
          ? `Serial number ${clash.serialNumber} is already recorded on asset ${clash.assetTag}`
          : `Asset tag ${clash.assetTag} is already in use`,
      );
    }
  }

  private async loadPo(actor: AuthUser, id: string) {
    const po = await this.prisma.client.purchaseOrder.findFirst({
      where: { id, companyId: actor.companyId },
      select: {
        id: true,
        poNumber: true,
        status: true,
        createdById: true,
        lines: { select: { id: true, quantity: true, receivedQuantity: true } },
      },
    });
    if (!po) throw AppError.notFound('Purchase order', id);
    return po;
  }

  private prSelect() {
    return {
      id: true,
      prNumber: true,
      status: true,
      justification: true,
      estimatedTotal: true,
      currency: true,
      neededBy: true,
      submittedAt: true,
      approvedAt: true,
      rejectedReason: true,
      convertedPoId: true,
      createdAt: true,
      // v2.9 C2 - what it is charged to and what it is holding. The estimate is
      // already on this payload, so the commitment adds no new class of data.
      costCentre: { select: { id: true, code: true, name: true } },
      budgetId: true,
      committedAmount: true,
      committedAt: true,
      requester: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
    } satisfies Prisma.PurchaseRequestSelect;
  }

  /** Retries a GRN-numbered operation when the sequential number collides. */
  private async withGrnNumberRetry<T>(fn: (grnNumber: string) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const grnNumber = await this.nextNumber('goodsReceipt', 'GRN');
      try {
        return await fn(grnNumber);
      } catch (error) {
        const unique =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!unique || attempt >= 4) throw error;
      }
    }
  }

  /** `PR-2026-000042`-style numbers, per entity, unique per company. */
  /**
   * v2.9 C2 — allocates a document number and runs `fn` in one transaction,
   * holding an advisory lock on the company's series for the whole of it.
   *
   * The numbers are a max()+1 scan, so without this two people raising a
   * request in the same instant both read the same latest number and one is
   * refused with "a record with these values already exists" - a database
   * detail leaking out as a failure the user can do nothing about. The lock is
   * per company and per series, so it never serialises unrelated work.
   */
  private async withNumberedTransaction<T>(
    companyId: string,
    entity: 'purchaseRequest' | 'purchaseOrder',
    prefix: string,
    fn: (tx: TenantTxClient, documentNumber: string) => Promise<T>,
  ): Promise<T> {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${prefix}:${companyId}`}))`;
      return fn(tx, await this.nextNumber(entity, prefix, tx));
    });
  }

  private async nextNumber(
    entity: 'purchaseRequest' | 'purchaseOrder' | 'goodsReceipt',
    prefix: string,
    tx?: TenantTxClient,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const full = `${prefix}-${year}-`;
    const field = entity === 'purchaseRequest' ? 'prNumber' : entity === 'purchaseOrder' ? 'poNumber' : 'grnNumber';
    const client = (tx ?? this.prisma.client)[entity] as unknown as {
      findFirst: (args: object) => Promise<Record<string, string> | null>;
    };
    const latest = await client.findFirst({
      where: { [field]: { startsWith: full } },
      orderBy: { [field]: 'desc' },
      select: { [field]: true },
    });
    const next = latest ? Number(latest[field]!.slice(full.length)) + 1 : 1;
    return `${full}${String(next).padStart(6, '0')}`;
  }
}
