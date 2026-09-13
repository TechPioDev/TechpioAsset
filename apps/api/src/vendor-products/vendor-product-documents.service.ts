import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
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
import { AppConfig } from '../config/config.module.js';
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
    private readonly config: AppConfig,
  ) {}

  /** How long a download link works for. Long enough to tap, short enough to be useless if copied. */
  private static readonly LINK_TTL_SECONDS = 120;

  /**
   * The key download links are signed with.
   *
   * Derived from the access-token secret rather than reusing it, so a document
   * link can never be presented as a sign-in token or the other way round: they
   * are signed with different keys even though both come from one secret.
   */
  private linkKey(): Buffer {
    return createHash('sha256')
      .update(`vendor-document-link:${this.config.get('JWT_ACCESS_SECRET') as string}`)
      .digest();
  }

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


  /**
   * A short-lived link to one document that works without a sign-in header.
   *
   * For the phone. It can open a link in the system browser but has no way to
   * attach an authorisation header to that request, and the alternative - a
   * native file-handling module - means a new app build that every user has to
   * reinstall.
   *
   * The access check happens here, when the link is made, through the same
   * vendor scope as every other read: a supplier cannot mint a link to a
   * competitor's paperwork. The link then carries the document, the company and
   * an expiry, signed, and is good for two minutes.
   */
  async createLink(actor: AuthUser, productId: string, documentId: string) {
    await this.productForWrite(actor, productId);
    const document = await this.prisma.client.vendorProductDocument.findFirst({
      where: { id: documentId, vendorProductId: productId, deletedAt: null },
      select: { id: true },
    });
    if (!document) throw AppError.notFound('Product document', documentId);

    const expiresAt = Math.floor(Date.now() / 1000) + VendorProductDocumentsService.LINK_TTL_SECONDS;
    const payload = Buffer.from(
      JSON.stringify({ d: document.id, c: actor.companyId, e: expiresAt }),
    ).toString('base64url');
    const signature = createHmac('sha256', this.linkKey()).update(payload).digest('base64url');
    return {
      path: `/vendor-products/document-links/${payload}.${signature}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  /**
   * The bytes behind a signed link, for a request that carries no session.
   *
   * Everything this trusts comes from the signature: the document, the company
   * and the expiry. The company is filtered on explicitly rather than left to
   * row-level security, because a request with no session sets no tenant and
   * the policy is permissive when none is set.
   */
  async readByLink(token: string) {
    const [payload, signature] = token.split('.');
    const refuse = () => AppError.notFound('Product document', 'link');
    if (!payload || !signature) throw refuse();

    const expected = createHmac('sha256', this.linkKey()).update(payload).digest();
    const given = Buffer.from(signature, 'base64url');
    // Same length first: timingSafeEqual throws on a mismatch, and a thrown
    // error would tell a caller something a refusal does not.
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw refuse();

    let claims: { d?: unknown; c?: unknown; e?: unknown };
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw refuse();
    }
    if (typeof claims.d !== 'string' || typeof claims.c !== 'string' || typeof claims.e !== 'number') {
      throw refuse();
    }
    if (claims.e < Math.floor(Date.now() / 1000)) {
      throw new AppError('UNAUTHENTICATED', 'This download link has expired', {
        detail: 'Open the document again from the app to get a fresh link.',
      });
    }

    const document = await this.prisma.client.vendorProductDocument.findFirst({
      where: { id: claims.d, companyId: claims.c, deletedAt: null },
      select: { storageKey: true, mimeType: true, originalName: true },
    });
    if (!document) throw refuse();
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
