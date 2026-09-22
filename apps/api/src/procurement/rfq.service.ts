import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type {
  AuthUser,
  AwardQuoteInput,
  CreateRfqInput,
  DeclineQuoteInput,
  RecordQuoteInput,
} from '@techpioasset/contracts';
import { compareQuotes, quoteSubtotal } from '@techpioasset/domain';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { VendorNotificationsService } from '../vendor-products/vendor-notifications.service.js';

/**
 * v2.9 C3 — competitive quoting.
 *
 * The invariant this service exists to hold: **a losing quote can never become
 * a purchase order.** Two things enforce it, and neither trusts the other — the
 * award is an atomic conditional UPDATE that only matches while no quote has
 * won, and a CHECK constraint refuses to record an order against any quote the
 * database does not agree is AWARDED.
 */
@Injectable()
export class RfqService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly vendorNotifications: VendorNotificationsService,
  ) {}

  async create(actor: AuthUser, purchaseRequestId: string, input: CreateRfqInput) {
    const pr = await this.prisma.client.purchaseRequest.findFirst({
      where: { id: purchaseRequestId, companyId: actor.companyId },
      select: { id: true, prNumber: true, status: true, lines: { select: { id: true } } },
    });
    if (!pr) throw AppError.notFound('Purchase request', purchaseRequestId);
    // Quoting an unapproved request would put vendors to work on a purchase
    // nobody has agreed to make.
    if (pr.status !== 'APPROVED') {
      throw new AppError(
        'ILLEGAL_STATE_TRANSITION',
        `Quotes can only be requested for an APPROVED request (${pr.prNumber} is ${pr.status})`,
      );
    }
    const live = await this.prisma.client.quoteRequest.findFirst({
      where: { purchaseRequestId, status: 'SENT', deletedAt: null },
      select: { rfqNumber: true },
    });
    if (live) {
      throw AppError.conflict(
        'CONFLICT',
        `${live.rfqNumber} is already out for this request; cancel it first`,
      );
    }

    const vendorIds = [...new Set(input.vendorIds)];
    if (vendorIds.length < 2) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Ask at least two different vendors - one quote is not a comparison',
      );
    }
    const vendors = await this.prisma.client.vendor.findMany({
      where: { id: { in: vendorIds }, companyId: actor.companyId, deletedAt: null },
      select: { id: true, name: true },
    });
    const found = new Set(vendors.map((v) => v.id));
    for (const id of vendorIds) if (!found.has(id)) throw AppError.notFound('Vendor', id);

    const rfq = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`RFQ:${actor.companyId}`}))`;
      const rfqNumber = await this.nextRfqNumber(tx);
      return tx.quoteRequest.create({
        data: {
          companyId: actor.companyId,
          rfqNumber,
          purchaseRequestId,
          dueDate: input.dueDate ?? null,
          notes: input.notes ?? null,
          createdById: actor.id,
          quotes: {
            create: vendorIds.map((vendorId) => ({ companyId: actor.companyId, vendorId })),
          },
        },
        select: { id: true, rfqNumber: true },
      });
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.RFQ_CREATED,
      entityType: 'QuoteRequest',
      entityId: rfq.id,
      newValues: {
        rfqNumber: rfq.rfqNumber,
        purchaseRequest: pr.prNumber,
        vendors: vendors.map((v) => v.name),
      },
    });
    await this.tellVendors(actor, rfq, purchaseRequestId, input.dueDate ?? null, vendorIds);
    return this.find(actor, rfq.id);
  }

  /**
   * v2.78 - each supplier asked hears about its own request. One message per
   * supplier, built separately, so nothing about one can reach another.
   * Failures are logged by the notifier and never undo the RFQ.
   */
  private async tellVendors(
    actor: AuthUser,
    rfq: { id: string; rfqNumber: string },
    purchaseRequestId: string,
    dueDate: Date | string | null,
    vendorIds: string[],
  ) {
    const [lines, buyer, company] = await Promise.all([
      this.prisma.client.purchaseRequestLine.findMany({
        where: { purchaseRequestId },
        orderBy: { lineNumber: 'asc' },
        // Description and quantity only. The estimated price stays internal.
        select: { description: true, quantity: true },
      }),
      this.prisma.client.user.findUnique({
        where: { id: actor.id },
        select: { email: true, profile: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.client.company.findUnique({
        where: { id: actor.companyId },
        select: { name: true },
      }),
    ]);
    for (const vendorId of vendorIds) {
      await this.vendorNotifications.quoteRequested({
        companyId: actor.companyId,
        vendorId,
        rfqId: rfq.id,
        rfqNumber: rfq.rfqNumber,
        companyName: company?.name ?? 'A buyer',
        dueDate: dueDate ? new Date(dueDate) : null,
        lines: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) })),
        buyer: buyer
          ? {
              name: buyer.profile
                ? `${buyer.profile.firstName} ${buyer.profile.lastName}`.trim()
                : buyer.email,
              email: buyer.email,
            }
          : null,
      });
    }
  }

  async list(actor: AuthUser, purchaseRequestId?: string) {
    const rfqs = await this.prisma.client.quoteRequest.findMany({
      where: {
        companyId: actor.companyId,
        deletedAt: null,
        ...(purchaseRequestId ? { purchaseRequestId } : {}),
        // OWN-scope actors (employees) may hold procurement:pr:read for their
        // own PRs; vendor quotes and comparisons are buyer material, so they
        // see only RFQs raised from PRs they themselves requested.
        ...(actor.scope === 'OWN' ? { purchaseRequest: { requesterId: actor.id } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        rfqNumber: true,
        status: true,
        dueDate: true,
        awardedQuoteId: true,
        purchaseRequest: { select: { id: true, prNumber: true } },
        _count: { select: { quotes: true } },
      },
    });
    return rfqs;
  }

  /** One RFQ with its quotes and the comparison a buyer defends a choice with. */
  async find(actor: AuthUser, id: string) {
    const rfq = await this.prisma.client.quoteRequest.findFirst({
      where: {
        id,
        companyId: actor.companyId,
        deletedAt: null,
        ...(actor.scope === 'OWN' ? { purchaseRequest: { requesterId: actor.id } } : {}),
      },
      select: {
        id: true,
        rfqNumber: true,
        status: true,
        dueDate: true,
        notes: true,
        awardedQuoteId: true,
        awardReason: true,
        awardedAt: true,
        createdAt: true,
        purchaseRequest: {
          select: { id: true, prNumber: true, estimatedTotal: true, currency: true },
        },
        quotes: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            status: true,
            reference: true,
            currency: true,
            subtotal: true,
            total: true,
            leadTimeDays: true,
            validUntil: true,
            notes: true,
            receivedAt: true,
            convertedPoId: true,
            vendor: { select: { id: true, name: true } },
            lines: {
              orderBy: { lineNumber: 'asc' },
              select: {
                id: true,
                lineNumber: true,
                description: true,
                quantity: true,
                unitPrice: true,
                lineTotal: true,
                purchaseRequestLineId: true,
              },
            },
          },
        },
      },
    });
    if (!rfq) throw AppError.notFound('Quote request', id);

    const comparison = compareQuotes(
      rfq.quotes.map((q) => ({
        id: q.id,
        vendorName: q.vendor.name,
        total: q.total ? q.total.toString() : null,
        leadTimeDays: q.leadTimeDays,
        status: q.status,
      })),
    );
    return { ...rfq, comparison };
  }

  /** What a vendor came back with. Recording a response is not a decision. */
  async recordResponse(actor: AuthUser, quoteId: string, input: RecordQuoteInput) {
    const quote = await this.loadQuote(actor, quoteId);
    if (quote.quoteRequest.status !== 'SENT') {
      throw new AppError(
        'ILLEGAL_STATE_TRANSITION',
        `${quote.quoteRequest.rfqNumber} is ${quote.quoteRequest.status}; responses are no longer being recorded`,
      );
    }
    if (quote.status === 'AWARDED' || quote.status === 'LOST') {
      throw new AppError('ILLEGAL_STATE_TRANSITION', 'This quote has already been decided');
    }
    const subtotal = quoteSubtotal(
      input.lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })),
    );

    await this.prisma.client.$transaction(async (tx) => {
      // Re-recording replaces the vendor's numbers wholesale; a quote is one
      // statement of price, not an accumulating list.
      await tx.quoteLine.deleteMany({ where: { quoteId } });
      await tx.quote.update({
        where: { id: quoteId },
        data: {
          status: 'RECEIVED',
          reference: input.reference ?? null,
          currency: input.currency.toUpperCase(),
          subtotal: new Prisma.Decimal(subtotal.toFixed(2)),
          total: new Prisma.Decimal(subtotal.toFixed(2)),
          leadTimeDays: input.leadTimeDays ?? null,
          validUntil: input.validUntil ?? null,
          notes: input.notes ?? null,
          receivedAt: new Date(),
          lines: {
            create: input.lines.map((l, i) => ({
              lineNumber: i + 1,
              purchaseRequestLineId: l.purchaseRequestLineId ?? null,
              description: l.description,
              quantity: new Prisma.Decimal(l.quantity),
              unitPrice: new Prisma.Decimal(l.unitPrice),
              lineTotal: new Prisma.Decimal((Number(l.unitPrice) * l.quantity).toFixed(2)),
            })),
          },
        },
      });
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.RFQ_QUOTE_RECORDED,
      entityType: 'Quote',
      entityId: quoteId,
      newValues: {
        rfq: quote.quoteRequest.rfqNumber,
        vendor: quote.vendor.name,
        total: subtotal.toFixed(2),
        currency: input.currency.toUpperCase(),
      },
    });
    return this.find(actor, quote.quoteRequestId);
  }

  async decline(actor: AuthUser, quoteId: string, input: DeclineQuoteInput) {
    const quote = await this.loadQuote(actor, quoteId);
    if (quote.status === 'AWARDED') {
      throw new AppError('ILLEGAL_STATE_TRANSITION', 'The awarded quote cannot be declined');
    }
    await this.prisma.client.quote.update({
      where: { id: quoteId },
      data: { status: 'DECLINED', notes: input.reason ?? quote.notes },
    });
    return this.find(actor, quote.quoteRequestId);
  }

  /**
   * The decision. Guarded so it happens exactly once: the conditional UPDATE
   * only matches while the RFQ has no winner, so two buyers awarding different
   * vendors at the same moment cannot both succeed.
   */
  async award(actor: AuthUser, rfqId: string, input: AwardQuoteInput) {
    const rfq = await this.prisma.client.quoteRequest.findFirst({
      where: { id: rfqId, companyId: actor.companyId, deletedAt: null },
      select: {
        id: true,
        rfqNumber: true,
        status: true,
        awardedQuoteId: true,
        quotes: {
          select: { id: true, status: true, total: true, vendor: { select: { name: true } } },
        },
      },
    });
    if (!rfq) throw AppError.notFound('Quote request', rfqId);
    if (rfq.status === 'CANCELLED') {
      throw new AppError('ILLEGAL_STATE_TRANSITION', `${rfq.rfqNumber} was cancelled`);
    }

    const winner = rfq.quotes.find((q) => q.id === input.quoteId);
    if (!winner) throw AppError.notFound('Quote', input.quoteId);
    // Already decided: say THAT, rather than remarking that this quote is LOST,
    // which is a consequence of the decision and not a reason of its own.
    if (rfq.awardedQuoteId || winner.status === 'LOST') {
      const current = rfq.quotes.find((q) => q.id === rfq.awardedQuoteId);
      throw AppError.conflict(
        'CONFLICT',
        `${rfq.rfqNumber} has already been awarded to ${current?.vendor.name ?? 'another vendor'}`,
      );
    }
    // Awarding a vendor who never answered would record a price nobody quoted.
    if (winner.status !== 'RECEIVED') {
      throw new AppError(
        'VALIDATION_FAILED',
        `${winner.vendor.name} has not submitted a quote (status ${winner.status}), so it cannot win`,
      );
    }

    const awarded = await this.prisma.client.$transaction(async (tx) => {
      const won = await tx.$executeRaw`
        UPDATE "quote_requests"
           SET "awardedQuoteId" = ${input.quoteId},
               "awardReason" = ${input.reason},
               "awardedById" = ${actor.id},
               "awardedAt" = NOW(),
               "status" = 'AWARDED'::"QuoteRequestStatus",
               "updatedById" = ${actor.id},
               "updatedAt" = NOW()
         WHERE "id" = ${rfqId}
           AND "companyId" = ${actor.companyId}
           AND "awardedQuoteId" IS NULL`;
      if (won === 0) return false;

      await tx.quote.update({ where: { id: input.quoteId }, data: { status: 'AWARDED' } });
      // Everyone else loses, explicitly. A quote left INVITED would read as
      // "still open" on a request that has already been decided.
      await tx.quote.updateMany({
        where: { quoteRequestId: rfqId, id: { not: input.quoteId } },
        data: { status: 'LOST' },
      });
      return true;
    });
    if (!awarded) {
      const current = await this.prisma.client.quoteRequest.findUnique({
        where: { id: rfqId },
        select: { awardedQuote: { select: { vendor: { select: { name: true } } } } },
      });
      throw AppError.conflict(
        'CONFLICT',
        `${rfq.rfqNumber} has already been awarded to ${current?.awardedQuote?.vendor.name ?? 'another vendor'}`,
      );
    }

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.RFQ_AWARDED,
      entityType: 'QuoteRequest',
      entityId: rfqId,
      newValues: {
        rfqNumber: rfq.rfqNumber,
        vendor: winner.vendor.name,
        total: winner.total?.toFixed(2) ?? null,
        losing: rfq.quotes.filter((q) => q.id !== input.quoteId).map((q) => q.vendor.name),
      },
      reason: input.reason,
    });
    return this.find(actor, rfqId);
  }

  async cancel(actor: AuthUser, rfqId: string, reason?: string | null) {
    const rfq = await this.prisma.client.quoteRequest.findFirst({
      where: { id: rfqId, companyId: actor.companyId, deletedAt: null },
      select: { id: true, rfqNumber: true, status: true },
    });
    if (!rfq) throw AppError.notFound('Quote request', rfqId);
    if (rfq.status === 'AWARDED') {
      throw new AppError(
        'ILLEGAL_STATE_TRANSITION',
        'An awarded RFQ cannot be cancelled - the decision is on the record',
      );
    }
    await this.prisma.client.quoteRequest.update({
      where: { id: rfqId },
      data: { status: 'CANCELLED', notes: reason ?? null, updatedById: actor.id },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.RFQ_CANCELLED,
      entityType: 'QuoteRequest',
      entityId: rfqId,
      reason: reason ?? undefined,
      previousValues: { rfqNumber: rfq.rfqNumber },
    });
    return this.find(actor, rfqId);
  }

  // ── used by conversion ─────────────────────────────────────────────────────

  /**
   * What conversion is allowed to do with this request's quoting, if any.
   *
   * Returning the awarded quote rather than a boolean keeps the decision in one
   * place: procurement asks "what am I ordering from?", not "is quoting done?".
   */
  async awardStateFor(actor: AuthUser, purchaseRequestId: string) {
    const rfq = await this.prisma.client.quoteRequest.findFirst({
      where: {
        purchaseRequestId,
        companyId: actor.companyId,
        deletedAt: null,
        status: { not: 'CANCELLED' },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        rfqNumber: true,
        status: true,
        awardedQuoteId: true,
        quotes: {
          select: {
            id: true,
            status: true,
            currency: true,
            vendorId: true,
            vendor: { select: { name: true } },
            lines: {
              orderBy: { lineNumber: 'asc' },
              select: {
                lineNumber: true,
                description: true,
                quantity: true,
                unitPrice: true,
                lineTotal: true,
              },
            },
          },
        },
      },
    });
    if (!rfq) return null;
    const awardedQuote = rfq.quotes.find((q) => q.id === rfq.awardedQuoteId) ?? null;
    return { rfq, awardedQuote };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async loadQuote(actor: AuthUser, quoteId: string) {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: quoteId, companyId: actor.companyId },
      select: {
        id: true,
        status: true,
        notes: true,
        quoteRequestId: true,
        vendor: { select: { id: true, name: true } },
        quoteRequest: { select: { id: true, rfqNumber: true, status: true } },
      },
    });
    if (!quote) throw AppError.notFound('Quote', quoteId);
    return quote;
  }

  private async nextRfqNumber(tx: {
    quoteRequest: { findFirst: (args: object) => Promise<{ rfqNumber: string } | null> };
  }) {
    const full = `RFQ-${new Date().getFullYear()}-`;
    const latest = await tx.quoteRequest.findFirst({
      where: { rfqNumber: { startsWith: full } },
      orderBy: { rfqNumber: 'desc' },
      select: { rfqNumber: true },
    });
    const next = latest ? Number(latest.rfqNumber.slice(full.length)) + 1 : 1;
    return `${full}${String(next).padStart(6, '0')}`;
  }
}
