import { Module } from '@nestjs/common';
import { AiModule } from '../providers/ai/ai.module.js';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';
import { AssetImportService } from './asset-import.service.js';
import { AssetPriceSheetService } from './asset-price-sheet.service.js';
import { AssetPhotosService } from './asset-photos.service.js';
import { AssetVerificationService } from './asset-verification.service.js';
import { LenovoWarrantyService } from './lenovo-warranty.service.js';

@Module({
  imports: [AiModule],
  controllers: [AssetsController],
  // StorageModule is @Global, so AssetPhotosService gets StorageProvider without an import here.
  providers: [
    AssetsService,
    AssetImportService,
    AssetPriceSheetService,
    AssetPhotosService,
    AssetVerificationService,
    LenovoWarrantyService,
  ],
  exports: [AssetsService, LenovoWarrantyService],
})
export class AssetsModule {}
