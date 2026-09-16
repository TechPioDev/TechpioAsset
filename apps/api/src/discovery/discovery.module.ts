import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { DiscoveryController } from './discovery.controller.js';
import { DiscoveryService } from './discovery.service.js';
import { AgentGuard } from './agent.guard.js';
import { AgentEnrolmentService } from './agent-enrolment.service.js';

@Module({
  imports: [AuditModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService, AgentEnrolmentService, AgentGuard],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
