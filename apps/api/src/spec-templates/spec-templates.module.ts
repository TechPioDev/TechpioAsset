import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { SpecTemplatesController } from './spec-templates.controller.js';
import { SpecTemplatesService } from './spec-templates.service.js';

/**
 * Category spec templates. Exported because the comparison engine reads the
 * same definitions - one description of a category, not two.
 */
@Module({
  imports: [AuditModule],
  controllers: [SpecTemplatesController],
  providers: [SpecTemplatesService],
  exports: [SpecTemplatesService],
})
export class SpecTemplatesModule {}
