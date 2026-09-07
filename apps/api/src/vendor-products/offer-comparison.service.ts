import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type { AuthUser, CompareOffersInput } from '@techpioasset/contracts';
import {
  compareOffer,
  effectiveOfferStatus,
  isSelectable,
  rankOffers,
  type OfferLifecycle,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { denyVendorUsers, tenantFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SpecTemplatesService } from '../spec-templates/spec-templates.service.js';

/**
 * Comparing offers, and recording which one was chosen (v2.42).
 *
 * INTERNAL ONLY, twice over. Every method here refuses a supplier outright: how
 * an offer scored against a competitor's, and which offer the buyer went with,
 * are the competitor's information rather than the supplier's. The route
 * permission is the first barrier and denyVendorUsers is the second, because
 * suppliers legitimately hold vendor-products:manage for their own drafts - so
 * a permission gate alone would not keep them out.
 *
 * Employees are excluded by the same permission: they never see vendor pricing.
 *
 * The scoring is arithmetic, never a model. A buyer defending a purchase to
 * finance has to be able to reproduce the ranking by hand.
 */
@Injectable()
export class OfferComparisonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly templates: SpecTemplatesService,
  ) {}

  /**
   * Score several offers in one category against what was asked for.
   *
   * Offers outside the category are refused rather than silently dropped: a
   * comparison that quietly comes back with fewer rows than were asked for is a
   * comparison somebody will read as complete.
   */
  async compare(actor: AuthUser, input: CompareOffersInput) {
    denyVendorUsers(actor, 'compare offers');

    const fields = await this.templates.definitionsFor(actor, input.categoryId);

    const offers = await this.prisma.client.vendorProduct.findMany({
      where: {
        id: { in: input.vendorProductIds },
        categoryId: input.categoryId,
        ...tenantFilter(actor),
        deletedAt: null,
      },
      select: {
        id: true,
        vendorId: true,
        name: true,
        brand: true,
        model: true,
        status: true,
        currency: true,
        unitPrice: true,
        landedCost: true,
        availableFrom: true,
        availableUntil: true,
        availableQuantity: true,
        minOrderQuantity: true,
        leadTimeDays: true,
        warrantyMonths: true,
        specs: true,
        vendor: { select: { id: true, name: true } },
        images: {
          where: { isPrimary: true },
          select: { id: true },
          take: 1,
        },
      },
    });

    const missing = input.vendorProductIds.filter((id) => !offers.some((o) => o.id === id));
    if (missing.length > 0) {
      throw new AppError('VALIDATION_FAILED', 'Some offers are not in this category', {
        detail: `Not found in the chosen category: ${missing.join(', ')}`,
      });
    }

    const now = new Date();
    const rows = offers.map((offer) => {
      const specs = (offer.specs ?? {}) as Record<string, string>;
      const landedCost = Number(offer.landedCost);
      return {
        id: offer.id,
        vendorId: offer.vendorId,
        vendorName: offer.vendor.name,
        name: offer.name,
        brand: offer.brand,
        model: offer.model,
        currency: offer.currency,
        unitPrice: Number(offer.unitPrice),
        landedCost,
        effectiveStatus: effectiveOfferStatus(
          {
            status: offer.status as OfferLifecycle,
            availableFrom: offer.availableFrom,
            availableUntil: offer.availableUntil,
            availableQuantity: offer.availableQuantity,
          },
          now,
        ),
        availableUntil: offer.availableUntil,
        availableQuantity: offer.availableQuantity,
        minOrderQuantity: offer.minOrderQuantity,
        leadTimeDays: offer.leadTimeDays,
        warrantyMonths: offer.warrantyMonths,
        primaryImageId: offer.images[0]?.id ?? null,
        comparison: compareOffer(fields, input.requirements, specs),
      };
    });

    return {
      categoryId: input.categoryId,
      fields,
      // Ranked, but the caller still sees every row and why: the ranking is a
      // starting point for a person, not a decision.
      offers: rankOffers(rows),
      comparedAt: now,
    };
  }

  /**
   * Record that an offer was chosen, with everything it was chosen on.
   *
   * The snapshot is the point. A vendor may change its price or withdraw the
   * offer tomorrow, and an approval defended six months later has to show what
   * was true when the decision was made - not what the catalogue says now.
   */
  async select(
    actor: AuthUser,
    vendorProductId: string,
    input: { quantity: number; purchaseRequestId?: string; assetRequestId?: string },
  ) {
    denyVendorUsers(actor, 'choose offers');

    const offer = await this.prisma.client.vendorProduct.findFirst({
      where: { id: vendorProductId, ...tenantFilter(actor), deletedAt: null },
      select: {
        id: true,
        vendorId: true,
        name: true,
        brand: true,
        model: true,
        status: true,
        specs: true,
        currency: true,
        unitPrice: true,
        gstPercent: true,
        discount: true,
        shippingCost: true,
        installationCost: true,
        otherCharges: true,
        landedCost: true,
        warrantyMonths: true,
        minOrderQuantity: true,
        availableFrom: true,
        availableUntil: true,
        availableQuantity: true,
        images: { where: { isPrimary: true }, select: { storageKey: true }, take: 1 },
      },
    });
    if (!offer) throw AppError.notFound('Vendor product', vendorProductId);

    const state = {
      status: offer.status as OfferLifecycle,
      availableFrom: offer.availableFrom,
      availableUntil: offer.availableUntil,
      availableQuantity: offer.availableQuantity,
    };
    if (!isSelectable(state, input.quantity)) {
      const status = effectiveOfferStatus(state);
      throw new AppError('CONFLICT', `This offer cannot be chosen: it is ${status.toLowerCase().replace(/_/g, ' ')}`, {
        detail:
          status === 'EXPIRED'
            ? 'The vendor stopped honouring this price. Ask for a fresh offer.'
            : `Asked for ${input.quantity}; ${offer.availableQuantity} available.`,
      });
    }
    if (input.quantity < offer.minOrderQuantity) {
      throw new AppError('CONFLICT', `This vendor's minimum order is ${offer.minOrderQuantity}`);
    }

    if (input.purchaseRequestId) {
      const pr = await this.prisma.client.purchaseRequest.findFirst({
        where: { id: input.purchaseRequestId, ...tenantFilter(actor), deletedAt: null },
        select: { id: true },
      });
      if (!pr) throw AppError.notFound('Purchase request', input.purchaseRequestId);
    }

    // Held rather than re-derived: a total recomputed later from a price that
    // has since moved is not the total anybody approved.
    const totalCost = new Prisma.Decimal(offer.landedCost).mul(input.quantity);

    const selection = await this.prisma.client.procurementSelection.create({
      data: {
        companyId: actor.companyId,
        vendorProductId: offer.id,
        vendorId: offer.vendorId,
        ...(input.purchaseRequestId ? { purchaseRequestId: input.purchaseRequestId } : {}),
        ...(input.assetRequestId ? { assetRequestId: input.assetRequestId } : {}),
        quantity: input.quantity,
        currency: offer.currency,
        unitPrice: offer.unitPrice,
        gstPercent: offer.gstPercent,
        discount: offer.discount,
        shippingCost: offer.shippingCost,
        installationCost: offer.installationCost,
        otherCharges: offer.otherCharges,
        landedCost: offer.landedCost,
        totalCost,
        productName: offer.name,
        brand: offer.brand,
        model: offer.model,
        specsSnapshot: (offer.specs ?? Prisma.DbNull) as Prisma.InputJsonValue,
        warrantyMonths: offer.warrantyMonths,
        availableUntil: offer.availableUntil,
        primaryImageStorageKey: offer.images[0]?.storageKey ?? null,
        selectedById: actor.id,
      },
      select: {
        id: true,
        vendorProductId: true,
        vendorId: true,
        quantity: true,
        currency: true,
        landedCost: true,
        totalCost: true,
        productName: true,
        createdAt: true,
      },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'ProcurementSelection',
      entityId: selection.id,
      newValues: {
        vendorProductId: offer.id,
        vendorId: offer.vendorId,
        quantity: input.quantity,
        totalCost: totalCost.toString(),
        purchaseRequestId: input.purchaseRequestId ?? null,
      },
    });
    return selection;
  }

  /** What has been chosen, most recent first. Internal only, like the rest. */
  async listSelections(actor: AuthUser, filters: { purchaseRequestId?: string; take?: number }) {
    denyVendorUsers(actor, 'see what was chosen');
    return this.prisma.client.procurementSelection.findMany({
      where: {
        ...tenantFilter(actor),
        deselectedAt: null,
        ...(filters.purchaseRequestId ? { purchaseRequestId: filters.purchaseRequestId } : {}),
      },
      select: {
        id: true,
        vendorProductId: true,
        vendorId: true,
        purchaseRequestId: true,
        quantity: true,
        currency: true,
        unitPrice: true,
        landedCost: true,
        totalCost: true,
        productName: true,
        brand: true,
        model: true,
        warrantyMonths: true,
        availableUntil: true,
        createdAt: true,
        vendor: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filters.take ?? 50, 200),
    });
  }

  /**
   * Undo a choice.
   *
   * Kept as a row with a timestamp rather than deleted: that a vendor was
   * chosen and then dropped is exactly the kind of thing an audit asks about.
   */
  async deselect(actor: AuthUser, id: string) {
    denyVendorUsers(actor, 'change what was chosen');

    const existing = await this.prisma.client.procurementSelection.findFirst({
      where: { id, ...tenantFilter(actor), deselectedAt: null },
      select: { id: true, vendorId: true, vendorProductId: true },
    });
    if (!existing) throw AppError.notFound('Selection', id);

    await this.prisma.client.procurementSelection.update({
      where: { id },
      data: { deselectedAt: new Date(), deselectedById: actor.id },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'ProcurementSelection',
      entityId: id,
      previousValues: existing,
      newValues: { deselected: true },
    });
    return { id, deselected: true };
  }
}
