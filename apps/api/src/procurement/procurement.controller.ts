import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  awardQuoteSchema,
  createRfqSchema,
  declineQuoteSchema,
  recordQuoteSchema,
  convertPurchaseRequestSchema,
  createPurchaseRequestSchema,
  decidePurchaseRequestSchema,
  prListQuerySchema,
  receiveGrnSchema,
  qualityCheckSchema,
  type AuthUser,
  type ConvertPurchaseRequestInput,
  type CreatePurchaseRequestInput,
  type DecidePurchaseRequestInput,
  type AwardQuoteInput,
  type CreateRfqInput,
  type DeclineQuoteInput,
  type PrListQuery,
  type ReceiveGrnInput,
  type RecordQualityCheckInput,
  type RecordQuoteInput,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { z } from 'zod';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { ProcurementService } from './procurement.service.js';
import { QualityCheckService } from './quality-check.service.js';
import { MatchService } from './match.service.js';
import { RfqService } from './rfq.service.js';

/**
 * v2.4 Procurement. SoD is enforced in the service (a requester never decides
 * their own PR); above the Finance threshold the approver must also hold the
 * cost permission. Over-receipt is transactionally impossible.
 */
/** Free-text reason on cancel/close actions: validated and length-bound
 * rather than accepted raw (v2.12 audit). */
const reasonSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();

@ApiTags('procurement')
@Controller('procurement')
export class ProcurementController {
  constructor(
    private readonly procurement: ProcurementService,
    private readonly quality: QualityCheckService,
    private readonly match: MatchService,
    private readonly rfq: RfqService,
  ) {}

  // ── purchase requests ──────────────────────────────────────────────────────

  @Get('requests')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PR_READ)
  @ApiOperation({ summary: 'List purchase requests (pass mine=true for your own)' })
  listPrs(@CurrentUser() actor: AuthUser, @Query(zodBody(prListQuerySchema)) query: PrListQuery) {
    return this.procurement.listPrs(actor, query);
  }

  @Get('requests/:id')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PR_READ)
  @ApiOperation({ summary: 'One purchase request with its lines' })
  findPr(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.procurement.findPr(actor, id);
  }

  @Post('requests')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PR_CREATE)
  @ApiOperation({ summary: 'Draft a purchase request' })
  createPr(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createPurchaseRequestSchema)) body: CreatePurchaseRequestInput,
  ) {
    return this.procurement.createPr(actor, body);
  }

  @Post('requests/:id/submit')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PR_CREATE)
  @ApiOperation({ summary: 'Submit a draft for approval (requester only)' })
  submitPr(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.procurement.submitPr(actor, id);
  }

  @Post('requests/:id/cancel')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PR_READ)
  @ApiOperation({
    summary: 'Cancel a purchase request',
    description:
      'The requester or an approver may cancel. If the request was holding budget, cancelling ' +
      'gives it back in the same transaction - exactly once, however many times it is called.',
  })
  cancelPr(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(reasonSchema)) body: { reason?: string },
  ) {
    return this.procurement.cancelPr(actor, id, body?.reason ?? null);
  }

  @Post('requests/:id/decision')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PR_APPROVE)
  @ApiOperation({
    summary: 'Approve or reject a submitted purchase request',
    description:
      'SoD: the requester cannot decide their own PR. At or above the Finance threshold the ' +
      'approver must also hold the cost permission.',
  })
  decidePr(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(decidePurchaseRequestSchema)) body: DecidePurchaseRequestInput,
  ) {
    return this.procurement.decidePr(actor, id, body);
  }

  @Post('requests/:id/convert')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PR_CONVERT)
  @ApiOperation({ summary: 'Convert an approved PR into a draft purchase order' })
  convertPr(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(convertPurchaseRequestSchema)) body: ConvertPurchaseRequestInput,
  ) {
    return this.procurement.convertPr(actor, id, body);
  }

  // ── requests for quotation (v2.9 C3) ───────────────────────────────────────

  @Post('requests/:id/rfq')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_RFQ_MANAGE)
  @ApiOperation({
    summary: 'Ask vendors to quote for an approved request',
    description: 'At least two vendors - one quote is not a comparison. Each is invited as a quote to fill in.',
  })
  createRfq(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(createRfqSchema)) body: CreateRfqInput,
  ) {
    return this.rfq.create(actor, id, body);
  }

  @Get('rfqs')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PR_READ)
  @ApiOperation({ summary: 'Quote requests, newest first (filter by purchaseRequestId)' })
  listRfqs(@CurrentUser() actor: AuthUser, @Query('purchaseRequestId') purchaseRequestId?: string) {
    return this.rfq.list(actor, purchaseRequestId);
  }

  @Get('rfqs/:id')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PR_READ)
  @ApiOperation({
    summary: 'One quote request with every quote and the comparison',
    description: 'The comparison names the cheapest and the fastest, and says when they are different vendors.',
  })
  findRfq(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.rfq.find(actor, id);
  }

  @Post('quotes/:quoteId/response')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_RFQ_MANAGE)
  @ApiOperation({ summary: "Record what a vendor quoted (replaces any earlier response)" })
  recordQuote(
    @CurrentUser() actor: AuthUser,
    @Param('quoteId') quoteId: string,
    @Body(zodBody(recordQuoteSchema)) body: RecordQuoteInput,
  ) {
    return this.rfq.recordResponse(actor, quoteId, body);
  }

  @Post('quotes/:quoteId/decline')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_RFQ_MANAGE)
  @ApiOperation({ summary: 'Record that a vendor will not quote' })
  declineQuote(
    @CurrentUser() actor: AuthUser,
    @Param('quoteId') quoteId: string,
    @Body(zodBody(declineQuoteSchema)) body: DeclineQuoteInput,
  ) {
    return this.rfq.decline(actor, quoteId, body);
  }

  @Post('rfqs/:id/award')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_RFQ_MANAGE)
  @ApiOperation({
    summary: 'Award one quote, with a reason',
    description:
      'Exactly one quote can ever win; the rest are marked LOST. Only the awarded quote can ' +
      'become a purchase order, which the database enforces as well as the service.',
  })
  awardQuote(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(awardQuoteSchema)) body: AwardQuoteInput,
  ) {
    return this.rfq.award(actor, id, body);
  }

  @Post('rfqs/:id/cancel')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_RFQ_MANAGE)
  @ApiOperation({ summary: 'Abandon a quote request that has not been awarded' })
  cancelRfq(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(reasonSchema)) body: { reason?: string },
  ) {
    return this.rfq.cancel(actor, id, body?.reason ?? null);
  }

  // ── three-way match ────────────────────────────────────────────────────────

  @Get('match/:invoiceId')
  @RequirePermissions(PERMISSIONS.INVOICES_READ)
  @ApiOperation({ summary: 'The stored three-way-match verdict for an invoice' })
  getMatch(@CurrentUser() actor: AuthUser, @Param('invoiceId') invoiceId: string) {
    return this.match.get(actor, invoiceId);
  }

  @Post('match/:invoiceId/run')
  @RequirePermissions(PERMISSIONS.INVOICES_VERIFY)
  @ApiOperation({ summary: 'Recompute the match (clears any prior override)' })
  runMatch(@CurrentUser() actor: AuthUser, @Param('invoiceId') invoiceId: string) {
    return this.match.run(actor, invoiceId);
  }

  @Post('match/:invoiceId/override')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_MATCH_OVERRIDE)
  @ApiOperation({
    summary: 'Accept a mismatched invoice anyway',
    description: 'Requires a reason; the override is written to the audit log.',
  })
  overrideMatch(
    @CurrentUser() actor: AuthUser,
    @Param('invoiceId') invoiceId: string,
    @Body(zodBody(reasonSchema)) body: { reason?: string },
  ) {
    const reason = body?.reason?.trim();
    if (!reason || reason.length < 10) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Give a reason of at least 10 characters - it goes on the audit record',
      );
    }
    return this.match.override(actor, invoiceId, reason);
  }

  // ── purchase orders ────────────────────────────────────────────────────────

  @Get('orders')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDERS_READ)
  @ApiOperation({ summary: 'List purchase orders' })
  listPos(@CurrentUser() actor: AuthUser, @Query(zodBody(prListQuerySchema)) query: PrListQuery) {
    return this.procurement.listPos(actor, query);
  }

  @Get('orders/:id')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDERS_READ)
  @ApiOperation({ summary: 'One purchase order with lines and receipts' })
  findPo(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.procurement.findPo(actor, id);
  }

  @Post('orders/:id/issue')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PO_ISSUE)
  @ApiOperation({ summary: 'Issue a draft PO to its vendor' })
  issuePo(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.procurement.issuePo(actor, id);
  }

  @Post('orders/:id/cancel')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_PO_ISSUE)
  @ApiOperation({ summary: 'Cancel a PO that has received no goods' })
  cancelPo(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(reasonSchema)) body: { reason?: string },
  ) {
    return this.procurement.cancelPo(actor, id, body?.reason ?? null);
  }

  @Post('orders/:id/receive')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_RECEIVE)
  @ApiOperation({
    summary: 'Receive goods against an issued PO',
    description:
      'Partial deliveries accumulate; receiving more than the outstanding remainder on any line ' +
      'is refused with the honest numbers. STOCK intake posts to the ledger and stock levels.',
  })
  receive(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(receiveGrnSchema)) body: ReceiveGrnInput,
  ) {
    return this.procurement.receive(actor, id, body);
  }

  // ── Quality check ─────────────────────────────────────────────────────────

  @Post('receipt-lines/:lineId/quality-check')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_RECEIVE)
  @ApiOperation({
    summary: 'Inspect what arrived on a receipt line',
    description:
      'The counts are checked against what the receipt says arrived, and the outcome is derived ' +
      'from them rather than sent. Accepted asset units become AVAILABLE - this is the step that ' +
      'takes them out of RECEIVED. Rejected stock is taken back off the shelf.',
  })
  recordQualityCheck(
    @CurrentUser() actor: AuthUser,
    @Param('lineId') lineId: string,
    @Body(zodBody(qualityCheckSchema)) body: RecordQualityCheckInput,
  ) {
    return this.quality.record(actor, lineId, body);
  }

  @Get('receipts/:receiptId')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_RECEIVE)
  @ApiOperation({
    summary: 'One receipt, with its lines, the units they created and any inspection',
    description: 'What an inspector needs in one call, rather than three that can disagree.',
  })
  receipt(@CurrentUser() actor: AuthUser, @Param('receiptId') receiptId: string) {
    return this.quality.findReceipt(actor, receiptId);
  }

  @Get('receipts/:receiptId/quality-checks')
  @RequirePermissions(PERMISSIONS.PROCUREMENT_RECEIVE)
  @ApiOperation({ summary: 'The inspections recorded against one receipt' })
  qualityChecks(@CurrentUser() actor: AuthUser, @Param('receiptId') receiptId: string) {
    return this.quality.listForReceipt(actor, receiptId);
  }
}
