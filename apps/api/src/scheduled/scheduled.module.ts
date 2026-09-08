import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { MaintenanceModule } from '../maintenance/maintenance.module.js';
import { VendorProductsModule } from '../vendor-products/vendor-products.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { ScheduledController } from './scheduled.controller.js';
import { AlertSweepService } from './alert-sweep.service.js';
import { ReportRunnerService } from './report-runner.service.js';

@Module({
  imports: [AssetsModule, MaintenanceModule, ReportsModule, VendorProductsModule],
  controllers: [ScheduledController],
  providers: [AlertSweepService, ReportRunnerService],
  exports: [AlertSweepService, ReportRunnerService],
})
export class ScheduledModule {}
