import { Module } from '@nestjs/common';
import { MobileController } from './mobile.controller.js';
import { MobileSyncService } from './mobile-sync.service.js';
import { AssetsModule } from '../assets/assets.module.js';
import { StockModule } from '../stock/stock.module.js';

@Module({
  // v2.82 - offline handovers and counts are applied through these services.
  imports: [AssetsModule, StockModule],
  controllers: [MobileController],
  providers: [MobileSyncService],
})
export class MobileModule {}
