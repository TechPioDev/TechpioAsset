import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { InvoiceUploadService } from './invoice-upload.service.js';
import { InvoiceDocumentLinksService } from './invoice-document-links.service.js';
import { ProcurementModule } from '../procurement/procurement.module.js';

@Module({
  imports: [ProcurementModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceUploadService, InvoiceDocumentLinksService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
