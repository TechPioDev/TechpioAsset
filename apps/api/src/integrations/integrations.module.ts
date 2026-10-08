import { Global, Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { IntegrationsController } from './integrations.controller.js';
import { ScimController } from './scim.controller.js';
import { ScimGuard } from './scim.guard.js';
import { ScimService } from './scim.service.js';
import { WebhooksService } from './webhooks.service.js';
import { M365LicenseSyncService } from './m365-license-sync.service.js';
import { HttpM365GraphClient, M365GraphClient } from '../providers/m365/m365-graph.client.js';

/** Global so business modules can publish webhook events without imports. */
@Global()
@Module({
  imports: [UsersModule],
  controllers: [IntegrationsController, ScimController],
  providers: [
    WebhooksService,
    ScimService,
    ScimGuard,
    M365LicenseSyncService,
    // Behind a token so tests can stand a fake tenant in for Microsoft.
    { provide: M365GraphClient, useClass: HttpM365GraphClient },
  ],
  // The nightly sweep runs the sync, and the licences service asks it nothing -
  // but both live in other modules, so it is exported like the webhooks are.
  exports: [WebhooksService, M365LicenseSyncService],
})
export class IntegrationsModule {}
