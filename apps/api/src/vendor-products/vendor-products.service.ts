import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type { AuthUser, CreateVendorProductInput, UpdateVendorProductInput, ReviewVendorProductInput } from '@techpioasset/contracts';
import {
  PERMISSIONS,
  calculateLandedCost,
  effectiveOfferStatus,
  imageSetProblem,
  youtubeVideoId,
  type OfferLifecycle,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { tenantFilter, vendorScopeFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Vendor catalogue (v2.42).
 *
 * Two rules run through everything here.
 *
 * ISOLATION. A supplier user may only ever touch its own vendor's rows. That is
 * enforced by composing vendorScopeFilter into every query rather than by
 * checking ownership after loading, because a check after loading is a check
 * somebody eventually forgets and a filter is not.
 *
 * PUBLICATION IS EARNED. A draft becomes visible to buyers only after it has an
 * image and passes internal review. Both gates live here, not in the UI, since
 * the mobile app and any future integration reach the same service.
 */
@Injectable()
export class VendorProductsService {
  private readonly logger = new Logger(VendorProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private static readonly LIST_FIELDS = {
    id: true,
    vendorId: true,
    name: true,
    brand: true,
    model: true,
    condition: true,
    status: true,
    currency: true,
    unitPrice: true,
    landedCost: true,
    availableQuantity: true,
    minOrderQuantity: true,
    availableFrom: true,
    availableUntil: true,
    leadTimeDays: true,
    warrantyMonths: true,
    categoryId: true,
    updatedAt: true,
  } as const;

  /**
   * The vendor a write belongs to.
   *
   * A supplier user may never name a vendor: whatever it sends, the answer is
   * its own. Internal staff must name one, because they act for whichever
   * supplier they are entering an offer on behalf of.
   */
  private resolveVendorId(actor: AuthUser, requested?: string): string {
    if (actor.vendorId) {
      if (requested && requested !== actor.vendorId) {
        throw AppError.forbidden('You may only publish products for your own company');
      }
      return actor.vendorId;
    }
    if (!requested) throw new AppError('VALIDATION_FAILED', 'Choose which vendor this offer is from');
    return requested;
  }

  private priceFrom(input: {
    unitPrice: number;
    gstPercent: number;
    discount: number;
    shippingCost: number;
    installationCost: number;
    otherCharges: number;
  }) {
    // Computed here and stored, never taken from the client: a landed cost the
    // caller supplies is a landed cost the caller chose.
    //
    // Named field by field rather than spread: the calculator rejects any key
    // that is not a finite number, and callers hand us the whole request body.
    const breakdown = calculateLandedCost({
      unitPrice: input.unitPrice,
      gstPercent: input.gstPercent,
      discount: input.discount,
      shippingCost: input.shippingCost,
      installationCost: input.installationCost,
      otherCharges: input.otherCharges,
    });
    return {
      unitPrice: new Prisma.Decimal(input.unitPrice),
      gstPercent: new Prisma.Decimal(input.gstPercent),
      discount: new Prisma.Decimal(input.discount),
      shippingCost: new Prisma.Decimal(input.shippingCost),
      installationCost: new Prisma.Decimal(input.installationCost),
      otherCharges: new Prisma.Decimal(input.otherCharges),
      landedCost: new Prisma.Decimal(breakdown.landedCost),
    };
  }

  async create(actor: AuthUser, input: CreateVendorProductInput) {
    const vendorId = this.resolveVendorId(actor, input.vendorId);

    const vendor = await this.prisma.client.vendor.findFirst({
      where: { id: vendorId, ...tenantFilter(actor), deletedAt: null },
      select: { id: true, isActive: true },
    });
    if (!vendor) throw AppError.notFound('Vendor', vendorId);
    if (!vendor.isActive) {
      throw new AppError('CONFLICT', 'This vendor is deactivated and cannot publish offers');
    }

    const category = await this.prisma.client.category.findFirst({
      where: { id: input.categoryId, ...tenantFilter(actor), deletedAt: null },
      select: { id: true },
    });
    if (!category) throw AppError.notFound('Category', input.categoryId);

    const videoId = this.videoIdOrThrow(input.youtubeUrl);
    const { vendorId: _ignored, youtubeUrl: _url, specs, ...rest } = input;

    const product = await this.prisma.client.vendorProduct.create({
      data: {
        ...rest,
        companyId: actor.companyId,
        vendorId,
        // Every offer starts as a draft. Publication is a separate, reviewed act.
        status: 'DRAFT',
        specs: specs ? (specs as Prisma.InputJsonValue) : Prisma.DbNull,
        youtubeVideoId: videoId,
        availableFrom: new Date(input.availableFrom),
        availableUntil: new Date(input.availableUntil),
        ...this.priceFrom(input),
        createdById: actor.id,
      },
      select: { ...VendorProductsService.LIST_FIELDS, specs: true, youtubeVideoId: true },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'VendorProduct',
      entityId: product.id,
      newValues: { name: product.name, vendorId, status: 'DRAFT' },
      reason: 'Vendor product created',
    });
    return product;
  }

  private videoIdOrThrow(url?: string): string | null {
    if (!url) return null;
    const id = youtubeVideoId(url);
    if (!id) {
      throw new AppError('VALIDATION_FAILED', 'That is not a YouTube video link', {
        detail: 'Paste a youtube.com/watch or youtu.be link. Embed code is not accepted.',
      });
    }
    return id;
  }

  /** A supplier may edit only while the offer is theirs to change. */
  private async loadForWrite(actor: AuthUser, id: string) {
    const product = await this.prisma.client.vendorProduct.findFirst({
      where: { id, ...vendorScopeFilter(actor), deletedAt: null },
      select: {
        id: true,
        vendorId: true,
        status: true,
        name: true,
        categoryId: true,
        specs: true,
        unitPrice: true,
        gstPercent: true,
        discount: true,
        shippingCost: true,
        installationCost: true,
        otherCharges: true,
        availableFrom: true,
        availableUntil: true,
        availableQuantity: true,
        _count: { select: { images: true } },
      },
    });
    if (!product) throw AppError.notFound('Vendor product', id);
    return product;
  }

  async update(actor: AuthUser, id: string, input: UpdateVendorProductInput) {
    const before = await this.loadForWrite(actor, id);

    // An approved offer that is edited has to be looked at again: the reviewer
    // approved a specification and a price, not a name on a row.
    const returnsToReview =
      actor.vendorId !== null &&
      ['APPROVED', 'ACTIVE', 'EXPIRING_SOON'].includes(before.status) &&
      this.touchesReviewedFields(input);

    const videoId = input.youtubeUrl === undefined ? undefined : this.videoIdOrThrow(input.youtubeUrl);
    const { youtubeUrl: _url, specs, ...rest } = input;

    const merged = {
      unitPrice: input.unitPrice ?? Number(before.unitPrice),
      gstPercent: input.gstPercent ?? Number(before.gstPercent),
      discount: input.discount ?? Number(before.discount),
      shippingCost: input.shippingCost ?? Number(before.shippingCost),
      installationCost: input.installationCost ?? Number(before.installationCost),
      otherCharges: input.otherCharges ?? Number(before.otherCharges),
    };

    const product = await this.prisma.client.vendorProduct.update({
      where: { id },
      data: {
        ...rest,
        ...(specs !== undefined ? { specs: specs as Prisma.InputJsonValue } : {}),
        ...(videoId !== undefined ? { youtubeVideoId: videoId } : {}),
        ...(input.availableFrom ? { availableFrom: new Date(input.availableFrom) } : {}),
        ...(input.availableUntil ? { availableUntil: new Date(input.availableUntil) } : {}),
        ...this.priceFrom(merged),
        ...(returnsToReview ? { status: 'PENDING_REVIEW' as const } : {}),
        updatedById: actor.id,
      },
      select: { ...VendorProductsService.LIST_FIELDS, specs: true, youtubeVideoId: true },
    });

    await this.audit.recordChange(
      {
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.SETTING_CHANGED,
        entityType: 'VendorProduct',
        entityId: id,
        ...(returnsToReview ? { reason: 'Edited after approval; returned for review' } : {}),
      },
      before as unknown as Record<string, unknown>,
      product as unknown as Record<string, unknown>,
      ['name', 'unitPrice', 'landedCost', 'availableQuantity', 'availableUntil', 'status'],
    );
    return product;
  }

  private touchesReviewedFields(input: UpdateVendorProductInput): boolean {
    return [
      'name',
      'brand',
      'model',
      'specs',
      'unitPrice',
      'gstPercent',
      'discount',
      'shippingCost',
      'installationCost',
      'otherCharges',
      'condition',
    ].some((field) => field in input);
  }

  /**
   * A draft goes for review, once it can actually be looked at.
   *
   * The image gate lives here rather than at publication because a reviewer
   * cannot judge a product they cannot see, and asking them to reject it for a
   * missing photo wastes a round trip.
   */
  async submitForReview(actor: AuthUser, id: string) {
    const product = await this.loadForWrite(actor, id);
    if (!['DRAFT', 'REJECTED', 'RETURNED_TO_VENDOR'].includes(product.status)) {
      throw new AppError('CONFLICT', `This offer is ${product.status.toLowerCase()} and is not a draft`);
    }
    const problem = imageSetProblem(product._count.images);
    if (problem) throw new AppError('VALIDATION_FAILED', problem);

    // A required field left blank reaches a buyer's comparison as "not stated",
    // which fails. Better to stop it here, where the supplier can still fix it,
    // than to let it be published and lose on a question nobody answered.
    const required = await this.prisma.client.categorySpecField.findMany({
      where: {
        categoryId: product.categoryId,
        ...tenantFilter(actor),
        deletedAt: null,
        isRequired: true,
      },
      select: { key: true, label: true },
      take: 200,
    });
    if (required.length > 0) {
      const specs = (product.specs ?? {}) as Record<string, string>;
      const blank = required.filter((f) => !String(specs[f.key] ?? '').trim());
      if (blank.length > 0) {
        throw new AppError('VALIDATION_FAILED', 'Some required specifications are missing', {
          detail: `Fill in: ${blank.map((f) => f.label).join(', ')}.`,
        });
      }
    }

    const updated = await this.prisma.client.vendorProduct.update({
      where: { id },
      data: { status: 'PENDING_REVIEW', updatedById: actor.id },
      select: VendorProductsService.LIST_FIELDS,
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'VendorProduct',
      entityId: id,
      previousValues: { status: product.status },
      newValues: { status: 'PENDING_REVIEW' },
    });
    return updated;
  }

  /** Internal decision on a submitted offer. Never available to the supplier. */
  async review(actor: AuthUser, id: string, input: ReviewVendorProductInput) {
    if (actor.vendorId) throw AppError.forbidden('A vendor cannot review its own products');

    const product = await this.prisma.client.vendorProduct.findFirst({
      where: { id, ...tenantFilter(actor), deletedAt: null },
      select: { id: true, status: true, _count: { select: { images: true } } },
    });
    if (!product) throw AppError.notFound('Vendor product', id);
    if (product.status !== 'PENDING_REVIEW') {
      throw new AppError('CONFLICT', 'Only an offer awaiting review can be decided');
    }
    if (input.decision === 'APPROVED') {
      const problem = imageSetProblem(product._count.images);
      if (problem) throw new AppError('VALIDATION_FAILED', problem);
    }

    const nextStatus =
      input.decision === 'APPROVED'
        ? ('APPROVED' as const)
        : input.decision === 'REJECTED'
          ? ('REJECTED' as const)
          : ('DRAFT' as const);

    const [, updated] = await this.prisma.client.$transaction([
      this.prisma.client.vendorProductReview.create({
        data: {
          companyId: actor.companyId,
          vendorProductId: id,
          decision: input.decision,
          comments: input.comments ?? null,
          reviewedById: actor.id,
        },
      }),
      this.prisma.client.vendorProduct.update({
        where: { id },
        data: { status: nextStatus, updatedById: actor.id },
        select: VendorProductsService.LIST_FIELDS,
      }),
    ]);

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'VendorProduct',
      entityId: id,
      previousValues: { status: 'PENDING_REVIEW' },
      newValues: { status: nextStatus, decision: input.decision },
      ...(input.comments ? { reason: input.comments } : {}),
    });
    return updated;
  }

  /**
   * The catalogue.
   *
   * A supplier sees its own rows in any state, because it needs to work on its
   * drafts. Everyone internal sees every vendor. Buyers looking to compare want
   * only what is live, which the caller asks for explicitly rather than getting
   * by accident.
   */
  async list(
    actor: AuthUser,
    query: { status?: string; categoryId?: string; vendorId?: string; liveOnly?: boolean; take?: number },
  ) {
    const take = Math.min(query.take ?? 50, 200);
    const products = await this.prisma.client.vendorProduct.findMany({
      where: {
        ...vendorScopeFilter(actor),
        deletedAt: null,
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        // Only meaningful for internal staff; a vendor's own filter is already applied.
        ...(query.vendorId && !actor.vendorId ? { vendorId: query.vendorId } : {}),
      },
      orderBy: [{ updatedAt: 'desc' }],
      take,
      select: {
        ...VendorProductsService.LIST_FIELDS,
        vendor: { select: { id: true, name: true } },
        images: {
          where: { isPrimary: true },
          select: { id: true },
          take: 1,
        },
      },
    });

    const now = new Date();
    const withStatus = products.map(({ images, ...p }) => ({
      ...p,
      // The id is all a client needs to request the bytes; the storage key is
      // an internal path and has no business leaving the server.
      primaryImageId: images[0]?.id ?? null,
      // What it is right now, not what was last written to the row.
      effectiveStatus: effectiveOfferStatus(
        {
          status: p.status as OfferLifecycle,
          availableFrom: p.availableFrom,
          availableUntil: p.availableUntil,
          availableQuantity: p.availableQuantity,
        },
        now,
      ),
    }));

    return query.liveOnly
      ? withStatus.filter((p) => ['ACTIVE', 'EXPIRING_SOON'].includes(p.effectiveStatus))
      : withStatus;
  }

  async findOne(actor: AuthUser, id: string) {
    const product = await this.prisma.client.vendorProduct.findFirst({
      where: { id, ...vendorScopeFilter(actor), deletedAt: null },
      select: {
        ...VendorProductsService.LIST_FIELDS,
        description: true,
        manufacturer: true,
        vendorSku: true,
        mpn: true,
        specs: true,
        youtubeVideoId: true,
        gstPercent: true,
        discount: true,
        shippingCost: true,
        installationCost: true,
        otherCharges: true,
        paymentTerms: true,
        vendor: { select: { id: true, name: true, contactEmail: true } },
        images: {
          orderBy: { sortOrder: 'asc' },
          // No storageKey: it is an internal path, and the id is all a client
          // needs to ask for the bytes.
          select: { id: true, isPrimary: true, sortOrder: true, mimeType: true, sizeBytes: true },
        },
        reviews: {
          orderBy: { createdAt: 'desc' },
          select: { decision: true, comments: true, createdAt: true },
        },
      },
    });
    if (!product) throw AppError.notFound('Vendor product', id);

    return {
      ...product,
      effectiveStatus: effectiveOfferStatus({
        status: product.status as OfferLifecycle,
        availableFrom: product.availableFrom,
        availableUntil: product.availableUntil,
        availableQuantity: product.availableQuantity,
      }),
    };
  }

  /** Withdrawing an offer keeps it readable: purchases made against it must stay explicable. */
  async remove(actor: AuthUser, id: string) {
    const product = await this.loadForWrite(actor, id);
    await this.prisma.client.vendorProduct.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DISCONTINUED', updatedById: actor.id },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'VendorProduct',
      entityId: id,
      previousValues: { name: product.name, status: product.status },
      newValues: { status: 'DISCONTINUED', deleted: true },
    });
    return { id, deleted: true };
  }

  /** Permission plus ownership, for the controller to assert before a write. */
  assertMayReview(actor: AuthUser): void {
    if (!actor.permissions.includes(PERMISSIONS.VENDOR_PRODUCTS_REVIEW)) {
      throw AppError.forbidden('Reviewing vendor products needs the review permission');
    }
  }
}
