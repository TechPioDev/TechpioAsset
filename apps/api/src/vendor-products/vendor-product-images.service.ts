import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import type { AuthUser } from '@techpioasset/contracts';
import { PRODUCT_IMAGE_RULES, imageSetProblem } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { vendorScopeFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageProvider } from '../providers/storage/storage.provider.js';
import { validateUpload } from '../providers/storage/file-validation.js';

/**
 * Product images (v2.42).
 *
 * Three rules, all enforced here rather than in the browser, because the mobile
 * app and any future integration reach the same service and a rule that lives in
 * one client is not a rule:
 *
 *  - one image at least, three at most
 *  - 500 KB each, judged on the bytes received
 *  - the type is decided by the file's signature, never by its name
 *
 * The last one is the security-relevant one. An executable renamed .jpg passes
 * every extension check ever written; it does not start with the PNG or JPEG
 * magic number.
 */
@Injectable()
export class VendorProductImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageProvider,
    private readonly audit: AuditService,
  ) {}

  /** The product, if this actor is allowed to touch it at all. */
  private async productForWrite(actor: AuthUser, productId: string) {
    const product = await this.prisma.client.vendorProduct.findFirst({
      where: { id: productId, ...vendorScopeFilter(actor), deletedAt: null },
      select: {
        id: true,
        vendorId: true,
        status: true,
        images: { select: { id: true, isPrimary: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!product) throw AppError.notFound('Vendor product', productId);
    return product;
  }

  async add(
    actor: AuthUser,
    productId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    const product = await this.productForWrite(actor, productId);

    if (product.images.length >= PRODUCT_IMAGE_RULES.max) {
      throw new AppError(
        'CONFLICT',
        `This product already has ${PRODUCT_IMAGE_RULES.max} images`,
        { detail: 'Delete one before adding another.' },
      );
    }

    // Signature first, size second - both before a single byte is stored.
    const { sha256, contentType } = validateUpload({
      data: file.buffer,
      declaredMime: file.mimetype,
      allowedMimes: [...PRODUCT_IMAGE_RULES.mimes],
      maxBytes: PRODUCT_IMAGE_RULES.maxBytes,
    });

    const stored = await this.storage.put({
      prefix: `vendor-products/${actor.companyId}/${productId}`,
      originalName: file.originalname,
      contentType,
      data: file.buffer,
    });

    // The first image to arrive is the primary one; a product is never left
    // without one, so a listing always has something to show.
    const isFirst = product.images.length === 0;
    const nextSort = product.images.reduce((max, i) => Math.max(max, i.sortOrder), -1) + 1;

    const image = await this.prisma.client.vendorProductImage.create({
      data: {
        companyId: actor.companyId,
        vendorProductId: productId,
        storageKey: stored.key,
        originalName: file.originalname,
        mimeType: contentType,
        sizeBytes: stored.sizeBytes,
        sha256,
        isPrimary: isFirst,
        sortOrder: nextSort,
        uploadedById: actor.id,
      },
      select: { id: true, storageKey: true, isPrimary: true, sortOrder: true, sizeBytes: true, mimeType: true },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'VendorProduct',
      entityId: productId,
      newValues: { imageAdded: image.id, bytes: image.sizeBytes, type: contentType },
    });
    return image;
  }

  /**
   * Remove one image, and never leave the product without a primary.
   *
   * Deleting the primary promotes the next by sort order. The alternative -
   * refusing to delete a primary - forces a vendor to add a fourth image they
   * are not allowed to have in order to remove the first.
   */
  async remove(actor: AuthUser, productId: string, imageId: string) {
    const product = await this.productForWrite(actor, productId);
    const image = product.images.find((i) => i.id === imageId);
    if (!image) throw AppError.notFound('Image', imageId);

    const stored = await this.prisma.client.vendorProductImage.findUnique({
      where: { id: imageId },
      select: { storageKey: true },
    });

    const remaining = product.images.filter((i) => i.id !== imageId);
    const published = !['DRAFT', 'REJECTED'].includes(product.status);
    if (published && imageSetProblem(remaining.length)) {
      // A published offer with no image is a listing nobody can read.
      throw new AppError('CONFLICT', 'A published product must keep at least one image', {
        detail: 'Add a replacement first, or return the offer to draft.',
      });
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.vendorProductImage.delete({ where: { id: imageId } });
      if (image.isPrimary && remaining.length > 0) {
        await tx.vendorProductImage.update({
          where: { id: remaining[0]!.id },
          data: { isPrimary: true },
        });
      }
    });

    if (stored) await this.storage.delete(stored.storageKey).catch(() => undefined);

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'VendorProduct',
      entityId: productId,
      previousValues: { imageId, wasPrimary: image.isPrimary },
      newValues: { imageDeleted: true, promoted: image.isPrimary ? (remaining[0]?.id ?? null) : null },
    });
    return { id: imageId, deleted: true, promoted: image.isPrimary ? (remaining[0]?.id ?? null) : null };
  }

  /** Choose which image leads. Exactly one stays primary, always. */
  async setPrimary(actor: AuthUser, productId: string, imageId: string) {
    const product = await this.productForWrite(actor, productId);
    if (!product.images.some((i) => i.id === imageId)) throw AppError.notFound('Image', imageId);

    await this.prisma.client.$transaction([
      this.prisma.client.vendorProductImage.updateMany({
        where: { vendorProductId: productId, isPrimary: true },
        data: { isPrimary: false },
      }),
      this.prisma.client.vendorProductImage.update({
        where: { id: imageId },
        data: { isPrimary: true },
      }),
    ]);

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'VendorProduct',
      entityId: productId,
      newValues: { primaryImage: imageId },
    });
    return { id: imageId, isPrimary: true };
  }

  /** The bytes, for display. Scoped like everything else. */
  async read(actor: AuthUser, productId: string, imageId: string) {
    const image = await this.prisma.client.vendorProductImage.findFirst({
      where: {
        id: imageId,
        vendorProductId: productId,
        vendorProduct: { ...vendorScopeFilter(actor), deletedAt: null },
      },
      select: { storageKey: true, mimeType: true, originalName: true },
    });
    if (!image) throw AppError.notFound('Image', imageId);
    return { ...image, data: await this.storage.get(image.storageKey) };
  }
}
