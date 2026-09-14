import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { signDownloadLink, verifyDownloadLink } from '../common/signed-download-link.js';
import { AppConfig } from '../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageProvider } from '../providers/storage/storage.provider.js';
import { InvoicesService } from './invoices.service.js';

/**
 * Two-minute download links for invoice documents (v2.56), for the phone.
 *
 * The web review page fetches /storage/preview/:documentId with its bearer
 * token and shows the blob. The phone can only hand a URL to the system
 * browser, which carries no header - so, like vendor product documents, access
 * is checked when the link is made (invoices:read and the same invoice read the
 * review page uses) and the link then names only that one document.
 */
@Injectable()
export class InvoiceDocumentLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageProvider,
    private readonly config: AppConfig,
    private readonly invoices: InvoicesService,
  ) {}

  async createLink(actor: AuthUser, invoiceId: string, documentId: string) {
    // The route already requires it; repeated because the preview route does.
    if (!actor.permissions.includes(PERMISSIONS.INVOICES_READ)) {
      throw AppError.forbidden('You may not view invoice documents');
    }
    const invoice = await this.invoices.findOne(actor, invoiceId); // tenant gate + 404
    const document = invoice.documents.find((d) => d.id === documentId);
    if (!document) throw AppError.notFound('Document', documentId);

    const { token, expiresAt } = signDownloadLink(
      this.config.get('JWT_ACCESS_SECRET') as string,
      'invoice-document-link',
      { fileId: document.id, companyId: actor.companyId },
    );
    return { path: `/invoices/document-links/${token}`, expiresAt };
  }

  /** The bytes behind a signed link. The company comes from the signature and is filtered on explicitly. */
  async readByLink(token: string) {
    const claims = verifyDownloadLink(
      this.config.get('JWT_ACCESS_SECRET') as string,
      'invoice-document-link',
      token,
      'Document',
    );
    const document = await this.prisma.client.invoiceDocument.findFirst({
      where: { id: claims.fileId, deletedAt: null, invoice: { companyId: claims.companyId } },
      select: { storageKey: true, mimeType: true, originalName: true },
    });
    if (!document) throw AppError.notFound('Document', 'link');
    return { ...document, data: await this.storage.get(document.storageKey) };
  }
}
