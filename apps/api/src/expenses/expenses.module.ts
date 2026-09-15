import { Module } from '@nestjs/common';
import { ExpenseExportService } from './expense-export.service.js';
import { ExpensesController } from './expenses.controller.js';
import { ExpensesService } from './expenses.service.js';

@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpenseExportService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
