import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type { AuthUser, CreateVendorProductInput, UpdateVendorProductInput, ReviewVendorProductInput } from '@techpioasset/contracts';
import {
  PERMISSIONS,
  calculateLandedCost,
  normalizeSpecLabel,
  proposedSpecsProblem,
  DEFAULT_VENDOR_OFFER_POLICY,
  editReturnsToReview,
  formatProductCode,
  productCodeSequence,
  productCodeStem,
  effectiveOfferStatus,
  imageSetProblem,
  statusAfterSubmit,
  youtubeVideoId,
  type OfferLifecycle,
  type VendorOfferPolicy,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { tenantFilter, vendorScopeFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { VendorNotificationsService } from './vendor-notifications.service.js';

/** Same shape the other services use for a transaction handle. */
type Tx = Omit<
  PrismaService['client'],
  '$connect' | '$disconnect' | '$on' | '$use' | '$transaction' | '$extends'
>;

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
    private readonly vendorNotifications: VendorNotificationsService,
  ) {}

  private static readonly LIST_FIELDS = {
    id: true,
    vendorId: true,
    productCode: true,
    vendorSku: true,
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

  /**
   * Does this tenant review supplier offers before buyers see them?
   *
   * Read per call rather than cached: it is one indexed lookup on a row we
   * already hold, and a stale answer here would either publish something a
   * reviewer expected to see or queue something nobody is watching.
   */
  private async offerPolicy(actor: AuthUser): Promise<VendorOfferPolicy> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: actor.companyId },
      select: { vendorOfferPolicy: true },
    });
    return (company?.vendorOfferPolicy ?? DEFAULT_VENDOR_OFFER_POLICY) as VendorOfferPolicy;
  }

  /**
   * The next free code for this make and model, e.g. LAP-DELL-5420-003.
   *
   * Under an advisory lock keyed on the stem, which is how purchase order and
   * receipt numbers are already assigned here: two people adding the same
   * laptop at the same moment would otherwise read the same highest number and
   * both write it, and one of them would lose to the unique index.
   *
   * Scanning for the highest existing rather than counting rows, because a
   * withdrawn listing keeps its code and counting would hand it out twice.
   */
  private async nextProductCode(
    tx: Tx,
    companyId: string,
    parts: { categoryName?: string | null; brand?: string | null; model?: string | null },
  ): Promise<string> {
    const stem = productCodeStem(parts);
    await (tx as unknown as { $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<number> })
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vpcode:${companyId}:${stem}`}))`;

    // Matched on the exact stem followed by digits, not on a prefix. "LAP-"
    // is also the start of "LAP-DELL-5420-001", so a prefix search on the
    // shorter stem read a longer stem's number and handed back one that was
    // already taken. Ordered by length first so 1000 beats 999 rather than
    // losing to it alphabetically.
    const rows = await (
      tx as unknown as {
        $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<{ productCode: string }[]>;
      }
    ).$queryRaw`
      SELECT "productCode" FROM vendor_products
       WHERE "companyId" = ${companyId}
         AND "productCode" ~ ${`^${stem}-[0-9]+$`}
       ORDER BY length("productCode") DESC, "productCode" DESC
       LIMIT 1`;
    const highest = rows[0]?.productCode ? productCodeSequence(rows[0].productCode) : 0;
    return formatProductCode(stem, highest + 1);
  }

  /**
   * A supplier's SKU must be unique among that supplier's own listings.
   *
   * The unique index is the real guard; this exists so the answer is a sentence
   * naming the listing that already has it, rather than a constraint violation
   * the supplier cannot act on.
   */
  private async assertSkuFree(
    companyId: string,
    vendorId: string,
    vendorSku: string | null | undefined,
    exceptId?: string,
  ) {
    const sku = vendorSku?.trim();
    if (!sku) return;
    const clash = await this.prisma.client.vendorProduct.findFirst({
      where: {
        companyId,
        vendorId,
        vendorSku: sku,
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { name: true, productCode: true },
    });
    if (clash) {
      throw new AppError('CONFLICT', `You are already using the SKU ${sku}`, {
        detail: `It belongs to "${clash.name}"${clash.productCode ? ` (${clash.productCode})` : ''}. Give this one a different SKU, or leave it blank.`,
      });
    }
  }

  /** The policy, for clients that must label a button after what it does. */
  async policyFor(actor: AuthUser): Promise<{ policy: VendorOfferPolicy }> {
    return { policy: await this.offerPolicy(actor) };
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


  /**
   * Replace an offer's volunteered specifications.
   *
   * Rewritten wholesale rather than merged: the supplier is looking at the
   * complete list on screen, so anything they removed there must go here too,
   * and a merge would quietly resurrect it.
   */
  private async writeProposedSpecs(
    tx: Tx,
    actor: AuthUser,
    productId: string,
    categoryId: string,
    subcategoryId: string | null,
    proposals: { label: string; value: string }[],
  ) {
    // Checked against the questions this offer is actually asked, so a supplier
    // cannot answer the same thing twice - once compared and once not.
    const template = await tx.categorySpecField.findMany({
      where: {
        categoryId,
        companyId: actor.companyId,
        deletedAt: null,
        ...(subcategoryId
          ? { OR: [{ subcategoryId: null }, { subcategoryId }] }
          : { subcategoryId: null }),
      },
      select: { key: true, label: true },
    });
    // Both, because the supplier is looking at the labels. A field keyed
    // "ram_gb" and labelled "RAM" is duplicated by somebody typing "RAM", and
    // matching on the key alone would let that through.
    const asked = template.flatMap((f) => [f.key, normalizeSpecLabel(f.label)]);
    const problem = proposedSpecsProblem(proposals, asked);
    if (problem) throw new AppError('VALIDATION_FAILED', problem);

    await tx.vendorProposedSpec.deleteMany({ where: { vendorProductId: productId } });
    if (proposals.length === 0) return;
    await tx.vendorProposedSpec.createMany({
      data: proposals.map((proposal) => ({
        companyId: actor.companyId,
        vendorProductId: productId,
        label: proposal.label.trim(),
        normalizedKey: normalizeSpecLabel(proposal.label),
        value: proposal.value.trim(),
      })),
    });
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
      select: { id: true, name: true },
    });
    if (!category) throw AppError.notFound('Category', input.categoryId);

    await this.assertSkuFree(actor.companyId, vendorId, input.vendorSku);

    const videoId = this.videoIdOrThrow(input.youtubeUrl);
    const { vendorId: _ignored, youtubeUrl: _url, specs, proposedSpecs, ...rest } = input;

    // In a transaction with the code assignment, so the lock that keeps two
    // simultaneous creations off the same number is still held when the row
    // carrying that number is written.
    const product = await this.prisma.client.$transaction(async (tx) => {
      const productCode = await this.nextProductCode(tx, actor.companyId, {
        categoryName: category.name,
        brand: input.brand,
        model: input.model,
      });
      return tx.vendorProduct.create({
      data: {
        ...rest,
        companyId: actor.companyId,
        vendorId,
        productCode,
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
    });

    if (proposedSpecs?.length) {
      await this.prisma.client.$transaction((tx) =>
        this.writeProposedSpecs(
          tx,
          actor,
          product.id,
          input.categoryId,
          input.subcategoryId ?? null,
          proposedSpecs,
        ),
      );
    }

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

  /**
   * Copy an offer into a new draft (v2.46).
   *
   * Suppliers list variants - the same laptop at 16 GB and 32 GB, the same
   * monitor in two sizes - and retyping fifteen fields to change one of them is
   * how a catalogue stays small. The copy starts as a DRAFT and carries no
   * pictures: a variant is a different thing, and the supplier should
   * photograph the one they are actually selling rather than inherit a picture
   * of its sibling.
   */
  async duplicate(actor: AuthUser, id: string) {
    const source = await this.prisma.client.vendorProduct.findFirst({
      where: { id, ...vendorScopeFilter(actor), deletedAt: null },
      select: {
        vendorId: true,
        name: true,
        brand: true,
        model: true,
        manufacturer: true,
        vendorSku: true,
        mpn: true,
        category: { select: { name: true } },
        description: true,
        condition: true,
        categoryId: true,
        subcategoryId: true,
        specs: true,
        youtubeVideoId: true,
        currency: true,
        unitPrice: true,
        gstPercent: true,
        discount: true,
        shippingCost: true,
        installationCost: true,
        otherCharges: true,
        landedCost: true,
        minOrderQuantity: true,
        availableQuantity: true,
        paymentTerms: true,
        leadTimeDays: true,
        warrantyMonths: true,
        proposedSpecs: { select: { label: true, normalizedKey: true, value: true } },
      },
    });
    if (!source) throw AppError.notFound('Vendor product', id);

    const { proposedSpecs, specs, category, vendorSku: _sku, ...rest } = source;
    // Fresh dates rather than the original's: copying an offer that expires
    // next week to sell something for the next month is the usual case.
    const from = new Date();
    const until = new Date(Date.now() + 30 * 86_400_000);

    const copy = await this.prisma.client.$transaction(async (tx) => {
      // A copy is a different listing and gets an identity of its own: its own
      // code, and no SKU at all. Carrying the SKU over would collide with the
      // original on the very next save, and guessing a new one would invent a
      // number that means something in the supplier's own system.
      const productCode = await this.nextProductCode(tx, actor.companyId, {
        categoryName: category?.name,
        brand: source.brand,
        model: source.model,
      });
      return tx.vendorProduct.create({
      data: {
        ...rest,
        companyId: actor.companyId,
        productCode,
        vendorSku: null,
        name: `${source.name} (copy)`.slice(0, 180),
        specs: specs === null ? Prisma.DbNull : (specs as Prisma.InputJsonValue),
        status: 'DRAFT',
        availableFrom: from,
        availableUntil: until,
        createdById: actor.id,
        ...(proposedSpecs.length
          ? {
              proposedSpecs: {
                create: proposedSpecs.map((ps) => ({
                  companyId: actor.companyId,
                  label: ps.label,
                  normalizedKey: ps.normalizedKey,
                  value: ps.value,
                })),
              },
            }
          : {}),
      },
      select: { ...VendorProductsService.LIST_FIELDS, specs: true },
      });
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'VendorProduct',
      entityId: copy.id,
      newValues: { copiedFrom: id, name: copy.name, status: 'DRAFT', productCode: copy.productCode },
      reason: 'Vendor product duplicated',
    });
    return copy;
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
        subcategoryId: true,
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
    // With review switched off there is nothing to send it back to, and doing
    // so anyway would take a live offer off sale until a queue nobody works is
    // emptied.
    const returnsToReview =
      actor.vendorId !== null &&
      ['APPROVED', 'ACTIVE', 'EXPIRING_SOON'].includes(before.status) &&
      this.touchesReviewedFields(input) &&
      editReturnsToReview(await this.offerPolicy(actor));

    if (input.vendorSku !== undefined) {
      await this.assertSkuFree(actor.companyId, before.vendorId, input.vendorSku, id);
    }

    const videoId = input.youtubeUrl === undefined ? undefined : this.videoIdOrThrow(input.youtubeUrl);
    const { youtubeUrl: _url, specs, proposedSpecs, ...rest } = input;

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

    // Undefined means "not editing them"; an empty array means "I removed them all".
    if (proposedSpecs !== undefined) {
      await this.prisma.client.$transaction((tx) =>
        this.writeProposedSpecs(
          tx,
          actor,
          id,
          product.categoryId,
          input.subcategoryId ?? before.subcategoryId ?? null,
          proposedSpecs,
        ),
      );
    }

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
    // RETURNED_TO_VENDOR is a review decision, not a status a product can hold.
    if (!['DRAFT', 'REJECTED'].includes(product.status)) {
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
        // The category's shared questions, plus this offer's subcategory - a
        // mouse must not be held back for a laptop's missing RAM.
        ...(product.subcategoryId
          ? { OR: [{ subcategoryId: null }, { subcategoryId: product.subcategoryId }] }
          : { subcategoryId: null }),
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

    // The quality gate above runs under either policy - an offer with no
    // picture and blank required specs wastes a buyer's time, not just a
    // reviewer's. What the policy decides is only what happens next.
    const next = statusAfterSubmit(await this.offerPolicy(actor));
    const updated = await this.prisma.client.vendorProduct.update({
      where: { id },
      data: { status: next, updatedById: actor.id },
      select: VendorProductsService.LIST_FIELDS,
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'VendorProduct',
      entityId: id,
      previousValues: { status: product.status },
      newValues: { status: next },
    });
    return updated;
  }

  /** Internal decision on a submitted offer. Never available to the supplier. */
  async review(actor: AuthUser, id: string, input: ReviewVendorProductInput) {
    if (actor.vendorId) throw AppError.forbidden('A vendor cannot review its own products');

    const product = await this.prisma.client.vendorProduct.findFirst({
      where: { id, ...tenantFilter(actor), deletedAt: null },
      // vendorId, because the people to tell about the decision are the ones
      // linked to that supplier.
      select: { id: true, status: true, vendorId: true, _count: { select: { images: true } } },
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

    // Outside the transaction and never awaited into its failure path: the
    // decision has been made and recorded, and a mail server having a bad day
    // is not a reason to unmake it. The service swallows its own errors.
    const decided = { companyId: actor.companyId, vendorId: product.vendorId, id, name: updated.name };
    if (input.decision === 'APPROVED') {
      await this.vendorNotifications.approved(decided);
    } else {
      await this.vendorNotifications.rejected(decided, input.comments ?? null);
    }

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
        // v2.47 - how many physical units this listing has put into service.
        // A count, never the assets themselves: a supplier may see what it has
        // supplied, which is its own sales history, and nothing about where any
        // of it ended up.
        _count: { select: { assets: true } },
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
        proposedSpecs: {
          orderBy: { label: 'asc' },
          select: { id: true, label: true, normalizedKey: true, value: true },
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
