import { Module } from '@nestjs/common';
import { BudgetsModule } from '../budgets/budgets.module.js';
import { StockModule } from '../stock/stock.module.js';
import { ProcurementController } from './procurement.controller.js';
import { ProcurementService } from './procurement.service.js';
import { MatchService } from './match.service.js';
import { QualityCheckService } from './quality-check.service.js';
import { RfqService } from './rfq.service.js';

@Module({
  // v2.9 C2: approving a charged request commits against its budget.
  // StockModule: receiving into a lot happens inside the receipt transaction.
  imports: [BudgetsModule, StockModule],
  controllers: [ProcurementController],
  providers: [ProcurementService, MatchService, RfqService, QualityCheckService],
  exports: [MatchService],
})
export class ProcurementModule {}
