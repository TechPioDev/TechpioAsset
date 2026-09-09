import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type {
  AuthUser,
  CompareOffersInput,
  CreateVendorProductInput,
  ReviewVendorProductInput,
  SelectOfferInput,
  UpdateVendorProductInput,
} from '@techpioasset/contracts';
import {
  compareOffersSchema,
  createVendorProductSchema,
  reviewVendorProductSchema,
  selectOfferSchema,
  updateVendorProductSchema,
} from '@techpioasset/contracts';
import {
  PERMISSIONS,
  PRODUCT_DOCUMENT_KINDS,
  PRODUCT_DOCUMENT_RULES,
  PRODUCT_IMAGE_RULES,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { OfferComparisonService } from './offer-comparison.service.js';
import { VendorProductDocumentsService } from './vendor-product-documents.service.js';
import { VendorProductImportService } from './vendor-product-import.service.js';
import { VendorProductImagesService } from './vendor-product-images.service.js';
import { VendorProductsService } from './vendor-products.service.js';

/**
 * The vendor catalogue (v2.42).
 *
 * Reachable by two different kinds of caller: a supplier working on its own
 * offers, and internal staff working across every supplier. They share these
 * endpoints deliberately - one code path means one set of isolation rules, and
 * a separate "vendor portal API" would be a second place for those rules to
 * drift out of step.
 *
 * What separates them is the scope filter in the service, not the route.
 */
@ApiTags('vendor-products')
@Controller('vendor-products')
export class VendorProductsController {
  constructor(
    private readonly products: VendorProductsService,
    private readonly images: VendorProductImagesService,
    private readonly documents: VendorProductDocumentsService,
    private readonly imports: VendorProductImportService,
    private readonly comparison: OfferComparisonService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_READ)
  @ApiOperation({
    summary: 'Catalogue',
    description:
      'A supplier sees only its own offers, in any state, because it works on its drafts here. ' +
      'Internal staff see every vendor. Pass liveOnly=true for offers that can actually be bought today.',
  })
  list(
    @CurrentUser() actor: AuthUser,
    @Query('status') status?: string,
    @Query('categoryId') categoryId?: string,
    @Query('vendorId') vendorId?: string,
    @Query('liveOnly') liveOnly?: string,
    @Query('take') take?: string,
  ) {
    return this.products.list(actor, {
      ...(status ? { status } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(vendorId ? { vendorId } : {}),
      liveOnly: liveOnly === 'true',
      ...(take ? { take: Number(take) } : {}),
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_READ)
  @ApiOperation({ summary: 'One offer, with its images, specification and review history' })
  findOne(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.products.findOne(actor, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @ApiOperation({
    summary: 'Create an offer as a draft',
    description:
      'A supplier may not name a vendor - the offer is always its own. Internal staff must name one.',
  })
  create(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(createVendorProductSchema)) body: CreateVendorProductInput,
  ) {
    return this.products.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @ApiOperation({
    summary: 'Edit an offer',
    description:
      'A supplier editing the price or specification of an approved offer sends it back for review: ' +
      'the reviewer approved those values, not the row.',
  })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(updateVendorProductSchema)) body: UpdateVendorProductInput,
  ) {
    return this.products.update(actor, id, body);
  }

  // ── Bulk import ───────────────────────────────────────────────────────────

  @Post('import')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Import products from a spreadsheet',
    description:
      'Excel or CSV. Send commit=false (the default) to see what would happen without writing ' +
      'anything; commit=true imports the rows that pass and reports the ones that do not, by line ' +
      'number and reason. Valid rows are imported even when others fail, because refusing sixty ' +
      'rows over one bad cell means uploading sixty again. Everything lands as a draft.',
  })
  async importProducts(
    @CurrentUser() actor: AuthUser,
    @Body() body: { commit?: string; vendorId?: string },
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    if (!file?.buffer?.length) throw new AppError('FILE_REJECTED', 'No file was received');

    // A supplier imports into its own catalogue whatever it sends; internal
    // staff must say whose it is. The same rule as creating one by hand.
    const vendorId = actor.vendorId ?? body?.vendorId;
    if (!vendorId) {
      throw new AppError('VALIDATION_FAILED', 'Say which vendor these products belong to');
    }
    if (actor.vendorId && body?.vendorId && body.vendorId !== actor.vendorId) {
      throw AppError.forbidden('You may only import products for your own company');
    }

    return body?.commit === 'true'
      ? this.imports.commit(actor, vendorId, file.buffer)
      : this.imports.preview(actor, vendorId, file.buffer);
  }

  @Post(':id/duplicate')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @ApiOperation({
    summary: 'Copy an offer into a new draft',
    description:
      'For variants - the same laptop at two memory sizes. The copy carries no pictures, because ' +
      'a variant is a different thing and should be photographed rather than inherit its sibling.',
  })
  duplicate(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.products.duplicate(actor, id);
  }

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @ApiOperation({ summary: 'Send a draft for internal review; needs at least one image' })
  submit(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.products.submitForReview(actor, id);
  }

  @Post(':id/review')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_REVIEW)
  @ApiOperation({
    summary: 'Approve, reject or return an offer',
    description: 'Internal only. A rejection must say why, or the vendor cannot act on it.',
  })
  review(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(reviewVendorProductSchema)) body: ReviewVendorProductInput,
  ) {
    return this.products.review(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @ApiOperation({ summary: 'Withdraw an offer; it stays readable so past purchases stay explicable' })
  remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.products.remove(actor, id);
  }

  // ── Comparison and selection ──────────────────────────────────────────────
  //
  // Internal only. Gated on the review permission rather than the read one:
  // suppliers and employees both hold read, and neither may see how offers
  // score against each other. The service refuses supplier accounts a second
  // time, because a supplier legitimately holds manage for its own drafts.

  @Post('compare')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_REVIEW)
  @ApiOperation({
    summary: 'Score offers against what was asked for',
    description:
      'Each requirement comes back as PASS, PARTIAL or FAIL with a reason. A specification the ' +
      'vendor never filled in is a FAIL that says "not stated", so an unanswered question is never ' +
      'mistaken for a met one. Arithmetic only - no model is consulted.',
  })
  compare(
    @CurrentUser() actor: AuthUser,
    @Body(zodBody(compareOffersSchema)) body: CompareOffersInput,
  ) {
    return this.comparison.compare(actor, body);
  }

  @Post(':id/select')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @ApiOperation({
    summary: 'Choose this offer',
    description:
      'Snapshots the price, specification and warranty as they are now. A vendor may change its ' +
      'price tomorrow; a decision defended six months later has to show what was true when it was made.',
  })
  select(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(selectOfferSchema)) body: SelectOfferInput,
  ) {
    return this.comparison.select(actor, id, body);
  }

  @Get('selections/list')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_REVIEW)
  @ApiOperation({ summary: 'What has been chosen' })
  selections(
    @CurrentUser() actor: AuthUser,
    @Query('purchaseRequestId') purchaseRequestId?: string,
    @Query('take') take?: string,
  ) {
    return this.comparison.listSelections(actor, {
      ...(purchaseRequestId ? { purchaseRequestId } : {}),
      ...(take ? { take: Number(take) } : {}),
    });
  }

  @Delete('selections/:selectionId')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @ApiOperation({
    summary: 'Undo a choice',
    description: 'Kept as a dated row rather than deleted; that a vendor was dropped is auditable.',
  })
  deselect(@CurrentUser() actor: AuthUser, @Param('selectionId') selectionId: string) {
    return this.comparison.deselect(actor, selectionId);
  }

  // ── Images ────────────────────────────────────────────────────────────────

  @Post(':id/images')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  // The multer ceiling is deliberately above the 500 KB rule: a file rejected
  // by the framework produces a generic error, while one that reaches the
  // service is rejected with a message naming the actual limit.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Add an image',
    description:
      'One to three per product, 500 KB each, JPG/PNG/WEBP. The type is decided by the file ' +
      'signature, not by its name or declared MIME.',
  })
  addImage(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    return this.images.add(actor, id, file);
  }

  @Delete(':id/images/:imageId')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @ApiOperation({
    summary: 'Remove an image',
    description: 'Deleting the primary promotes the next, so a product is never left without one.',
  })
  removeImage(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.images.remove(actor, id, imageId);
  }

  @Post(':id/images/:imageId/primary')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @ApiOperation({ summary: 'Choose which image leads' })
  setPrimary(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.images.setPrimary(actor, id, imageId);
  }

  @Get(':id/images/:imageId')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_READ)
  @ApiOperation({ summary: 'The image bytes' })
  async readImage(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Res() res: Response,
  ) {
    const image = await this.images.read(actor, id, imageId);
    res.setHeader('Content-Type', image.mimeType);
    // Private: an offer's images are commercial information, not public assets.
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(image.data);
  }

  @Get('meta/policy')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_READ)
  @ApiOperation({
    summary: 'Whether offers here wait for approval',
    description:
      'So the button can say what it actually does. Readable by suppliers, who hold the catalogue ' +
      'read permission but not the settings one, and therefore cannot read this from settings.',
  })
  policy(@CurrentUser() actor: AuthUser) {
    return this.products.policyFor(actor);
  }

  // ── Documents ─────────────────────────────────────────────────────────────
  //
  // Datasheets, manuals, compliance certificates. Reached through the product
  // rather than by document id, so a supplier cannot read another's paperwork
  // by guessing one.

  @Get(':id/documents')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_READ)
  @ApiOperation({ summary: 'The paperwork on this product' })
  listDocuments(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.documents.list(actor, id);
  }

  @Post(':id/documents')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  // Above the rule so an oversized file is refused with a message naming the
  // real limit rather than by the framework with a generic one.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Add a document',
    description:
      'PDF and images only, up to 10 MB and ten per product. The type is decided by the file ' +
      'signature, not by its name or declared MIME. Office files are refused: they are archives ' +
      'that can carry macros, and these arrive from outside the company by definition.',
  })
  addDocument(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: { kind?: string; title?: string },
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    const kind = PRODUCT_DOCUMENT_KINDS.find((k) => k === body?.kind);
    if (!kind) {
      throw new AppError('VALIDATION_FAILED', 'Say what kind of document this is', {
        detail: `One of: ${PRODUCT_DOCUMENT_KINDS.join(', ')}.`,
      });
    }
    return this.documents.add(actor, id, { kind, title: body?.title ?? null }, file);
  }

  @Get(':id/documents/:documentId')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_READ)
  @ApiOperation({ summary: 'The document itself' })
  async readDocument(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ) {
    const document = await this.documents.read(actor, id, documentId);
    res.setHeader('Content-Type', document.mimeType);
    // Attachment, not inline: a PDF rendered in the page is a PDF running in
    // our origin, and these come from outside the company.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${document.originalName.replace(/[^\w.\- ]/g, '_')}"`,
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(document.data);
  }

  @Delete(':id/documents/:documentId')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @ApiOperation({
    summary: 'Remove a document',
    description: 'Kept rather than destroyed: paperwork that justified a purchase must survive it.',
  })
  removeDocument(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documents.remove(actor, id, documentId);
  }

  @Get('meta/document-rules')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_READ)
  @ApiOperation({ summary: 'The document limits, so clients state what the server enforces' })
  documentRules() {
    return { ...PRODUCT_DOCUMENT_RULES, kinds: PRODUCT_DOCUMENT_KINDS };
  }

  @Get('meta/image-rules')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_READ)
  @ApiOperation({
    summary: 'The image limits, so clients state the same numbers the server enforces',
  })
  imageRules() {
    return PRODUCT_IMAGE_RULES;
  }
}
