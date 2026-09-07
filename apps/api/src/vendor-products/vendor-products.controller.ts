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
import { PERMISSIONS, PRODUCT_IMAGE_RULES } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { OfferComparisonService } from './offer-comparison.service.js';
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

  @Get('meta/image-rules')
  @RequirePermissions(PERMISSIONS.VENDOR_PRODUCTS_READ)
  @ApiOperation({
    summary: 'The image limits, so clients state the same numbers the server enforces',
  })
  imageRules() {
    return PRODUCT_IMAGE_RULES;
  }
}
