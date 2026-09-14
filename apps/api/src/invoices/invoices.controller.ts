import {
  Body,
  Controller,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Express, Response } from 'express';
import 'multer';
import {
  createInvoiceSchema,
  invoiceListQuerySchema,
  linkInvoiceLineSchema,
  verifyInvoiceDecisionSchema,
  type AuthUser,
  type CreateInvoiceInput,
  type InvoiceListQuery,
} from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, Public, RequirePermissions } from '../auth/decorators.js';
import { safeDownloadName } from '../common/signed-download-link.js';
import { InvoicesService } from './invoices.service.js';
import { InvoiceUploadService } from './invoice-upload.service.js';
import { InvoiceDocumentLinksService } from './invoice-document-links.service.js';

@ApiTags('Invoices')
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly uploads: InvoiceUploadService,
    private readonly documentLinks: InvoiceDocumentLinksService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVOICES_READ)
  @ApiOperation({ summary: 'List invoices' })
  list(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(invoiceListQuerySchema)) query: InvoiceListQuery,
  ) {
    return this.invoices.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.INVOICES_READ)
  @ApiOperation({ summary: 'Read an invoice with its documents, extraction and verification' })
  findOne(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.invoices.findOne(actor, id);
  }

  @Post(':id/documents/:documentId/link')
  @RequirePermissions(PERMISSIONS.INVOICES_READ)
  @ApiOperation({
    summary: 'A two-minute download link for one invoice document',
    description:
      'For the phone app, which can open a link in the system browser but cannot attach a ' +
      'sign-in header to it. Access is checked here, when the link is made; the link names ' +
      'only that document and stops working after two minutes.',
  })
  documentLink(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documentLinks.createLink(actor, id, documentId);
  }

  // Public on purpose, and only this one route: the signature is the credential.
  @Get('document-links/:token')
  @Public()
  @ApiOperation({ summary: 'Download an invoice document through a signed link' })
  async readDocumentLink(@Param('token') token: string, @Res() res: Response) {
    const document = await this.documentLinks.readByLink(token);
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeDownloadName(document.originalName)}"`,
    );
    // Never cached: a link is meant to stop working, and a cache would not.
    res.setHeader('Cache-Control', 'no-store');
    res.send(document.data);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.INVOICES_UPLOAD)
  @ApiOperation({
    summary: 'Create an invoice by manual entry',
    description:
      'The AI-disabled path: works with no provider involved and runs deterministic checks.',
  })
  create(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createInvoiceSchema)) body: CreateInvoiceInput,
  ) {
    return this.invoices.create(actor, body);
  }

  @Post('upload')
  @RequirePermissions(PERMISSIONS.INVOICES_UPLOAD)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a document',
    description:
      'Validates the file by signature, stores it privately, extracts it only if AI is enabled ' +
      'for this company, and always runs deterministic verification.',
  })
  async upload(
    @CurrentUser() actor: AuthUser,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 30 * 1024 * 1024 })],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
    @Body('vendorId') vendorId?: string,
    @Body('invoiceNumber') invoiceNumber?: string,
  ) {
    if (!file?.buffer) throw new AppError('FILE_REJECTED', 'No file was received');
    return this.uploads.upload(
      actor,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { vendorId, invoiceNumber },
    );
  }

  @Post(':id/reverify')
  @RequirePermissions(PERMISSIONS.INVOICES_READ)
  @ApiOperation({
    summary: 'Re-run deterministic verification',
    description: 'Never contacts AI — only the pure engine and application records.',
  })
  async reverify(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.invoices.runVerification(actor, id);
    return this.invoices.findOne(actor, id);
  }

  @Post(':id/lines/link')
  @RequirePermissions(PERMISSIONS.INVOICES_CORRECT_EXTRACTION)
  @ApiOperation({ summary: 'Link an invoice line to an asset or inventory item' })
  link(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(linkInvoiceLineSchema))
    body: { lineId: string; assetId?: string; inventoryItemId?: string },
  ) {
    return this.invoices.linkLine(actor, id, body.lineId, {
      assetId: body.assetId,
      inventoryItemId: body.inventoryItemId,
    });
  }

  @Post(':id/decision')
  @RequirePermissions(PERMISSIONS.INVOICES_VERIFY)
  @ApiOperation({
    summary: 'Verify or reject an invoice (human decision — spec section 9)',
    description: 'AI can never make this decision; the endpoint requires invoices:verify.',
  })
  decide(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(verifyInvoiceDecisionSchema))
    body: { decision: 'VERIFIED' | 'REJECTED'; notes?: string },
  ) {
    return this.invoices.decide(actor, id, body.decision, body.notes);
  }
}
