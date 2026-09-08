import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import type { AuthUser } from '@techpioasset/contracts';
import {
  PRODUCT_DOCUMENT_RULES,
  documentSetProblem,
  documentTitle,
  type ProductDocumentKind,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { vendorScopeFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageProvider } from '../providers/storage/storage.provider.js';
import { validateUpload } from '../providers/storage/file-validation.js';

/**
 * The paperwork a product comes with (v2.49).
 *
 * Datasheets, manuals, compliance certificates. Modelled on the image service
 * beside it and sharing its two rules: the vendor scope filter decides whose
 * product this is, and the bytes decide what the file is - never the name or
 * the declared type, which a caller chooses.
 *
 * Documents are soft-deleted. A compliance certificate that was on file when a
 * purchase was made is part of why that purchase was allowed, and removing the
 * row would take the answer with it.
 */
@Injectable()
export class VendorProductDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageProvider,
    private readonly audit: AuditService,
  ) {}

  /** The product, if this actor may touch it at all. */
  private async productForWrite(actor: AuthUser, productId: string) {
    const product = await this.prisma.client.vendorProduct.findFirst({
      where: { id: productId, ...vendorScopeFilter(actor), deletedAt: null },
      select: { id: true, vendorId: true, _count: { select: { documents: true } } },
    });
    if (!product) throw AppError.notFound('Vendor product', productId);
    return product;
  }

  async list(actor: AuthUser, productId: string) {
    // Through the product, so a supplier cannot read another's paperwork by
    // knowing a document id.
    await this.productForWrite(actor, productId);
    return this.prisma.client.vendorProductDocument.findMany({
      where: { vendorProductId: productId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      // No storageKey: it spells out the internal bucket layout and the caller
      // reaches the bytes through the id.
      select: {
        id: true,
        kind: true,
        title: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
      },
    });
  }

  async add(
    actor: AuthUser,
    productId: string,
    input: { kind: ProductDocumentKind; title?: string | null },
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    const product = await this.productForWrite(actor, productId);
    if (!file?.buffer?.length) throw new AppError('VALIDATION_FAILED', 'Choose a file to upload');

    const problem = documentSetProblem(product._count.documents);
    if (problem) throw new AppError('VALIDATION_FAILED', problem);

    const { sha256, contentType } = validateUpload({
      data: file.buffer,
      declaredMime: file.mimetype,
      allowedMimes: [...PRODUCT_DOCUMENT_RULES.mimes],
      maxBytes: PRODUCT_DOCUMENT_RULES.maxBytes,
    });

    const stored = await this.storage.put({
      prefix: `vendor-product-docs/${actor.companyId}/${productId}`,
      originalName: file.originalname,
      contentType,
      data: file.buffer,
    });

    const document = await this.prisma.client.vendorProductDocument.create({
      data: {
        companyId: actor.companyId,
        vendorProductId: productId,
        kind: input.kind,
        title: input.title?.trim() || null,
        storageKey: stored.key,
        originalName: file.originalname,
        mimeType: contentType,
        sizeBytes: stored.sizeBytes,
        sha256,
        uploadedById: actor.id,
      },
      select: {
        id: true,
        kind: true,
        title: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
      },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'VendorProductDocument',
      entityId: document.id,
      newValues: {
        vendorProductId: productId,
        kind: document.kind,
        title: documentTitle(document),
        sizeBytes: document.sizeBytes,
      },
      reason: 'Product document added',
    });
    return document;
  }

  /** The bytes, for a caller allowed to see the product they hang off. */
  async read(actor: AuthUser, productId: string, documentId: string) {
    await this.productForWrite(actor, productId);
    const document = await this.prisma.client.vendorProductDocument.findFirst({
      where: { id: documentId, vendorProductId: productId, deletedAt: null },
      select: { storageKey: true, mimeType: true, originalName: true },
    });
    if (!document) throw AppError.notFound('Product document', documentId);
    return { ...document, data: await this.storage.get(document.storageKey) };
  }

  async remove(actor: AuthUser, productId: string, documentId: string) {
    await this.productForWrite(actor, productId);
    const document = await this.prisma.client.vendorProductDocument.findFirst({
      where: { id: documentId, vendorProductId: productId, deletedAt: null },
      select: { id: true, kind: true, title: true },
    });
    if (!document) throw AppError.notFound('Product document', documentId);

    // Soft: the bytes stay too. A certificate that was on file when something
    // was bought is part of why buying it was allowed.
    await this.prisma.client.vendorProductDocument.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'VendorProductDocument',
      entityId: documentId,
      previousValues: { kind: document.kind, title: documentTitle(document) },
      reason: 'Product document removed',
    });
    return { id: documentId, removed: true };
  }
}
