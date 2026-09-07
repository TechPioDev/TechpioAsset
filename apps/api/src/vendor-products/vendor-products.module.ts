import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { SpecTemplatesModule } from '../spec-templates/spec-templates.module.js';
import { OfferComparisonService } from './offer-comparison.service.js';
import { VendorProductImagesService } from './vendor-product-images.service.js';
import { VendorProductsController } from './vendor-products.controller.js';
import { VendorProductsService } from './vendor-products.service.js';

/**
 * The vendor catalogue. Storage and Prisma arrive from their @Global modules;
 * only audit needs importing, as elsewhere.
 */
@Module({
  imports: [AuditModule, SpecTemplatesModule],
  controllers: [VendorProductsController],
  providers: [VendorProductsService, VendorProductImagesService, OfferComparisonService],
  exports: [VendorProductsService],
})
export class VendorProductsModule {}
