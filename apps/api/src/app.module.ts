import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ConfigService } from '@nestjs/config';
import { AppConfigModule } from './config/config.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HealthModule } from './health/health.module.js';
import { AssetsModule } from './assets/assets.module.js';
import { MarketingModule } from './marketing/marketing.module.js';
import { OrgModule } from './org/org.module.js';
import { SpecTemplatesModule } from './spec-templates/spec-templates.module.js';
import { VendorProductsModule } from './vendor-products/vendor-products.module.js';
import { UsersModule } from './users/users.module.js';
import { RolesModule } from './roles/roles.module.js';
import { LicensesModule } from './licenses/licenses.module.js';
import { ProcurementModule } from './procurement/procurement.module.js';
import { StockModule } from './stock/stock.module.js';
import { BudgetsModule } from './budgets/budgets.module.js';
import { RequestsModule } from './requests/requests.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { LifecycleModule } from './lifecycle/lifecycle.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { AiConfigModule } from './ai-config/ai-config.module.js';
import { StorageHttpModule } from './storage/storage-http.module.js';
import { MobileModule } from './mobile/mobile.module.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { ScheduledModule } from './scheduled/scheduled.module.js';
import { MailModule } from './providers/mail/mail.module.js';
import { QueueModule } from './providers/queue/queue.module.js';
import { CacheModule } from './providers/cache/cache.module.js';
import { StorageModule } from './providers/storage/storage.module.js';
import { AiModule } from './providers/ai/ai.module.js';
import { DiscoveryProviderModule } from './providers/discovery/discovery.module.js';
import { DiscoveryModule } from './discovery/discovery.module.js';
import { AssetHealthModule } from './asset-health/asset-health.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { PushModule } from './providers/push/push.module.js';
import { ChatModule } from './providers/chat/chat.module.js';
import { SsoModule } from './providers/sso/sso.module.js';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware.js';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor.js';
import { RlsTenantInterceptor } from './common/interceptors/rls-tenant.interceptor.js';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from './auth/guards/permissions.guard.js';
import { TenantThrottlerGuard } from './common/guards/tenant-throttler.guard.js';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: Number(config.get('RATE_LIMIT_TTL_SECONDS') ?? 60) * 1000,
            limit: Number(config.get('RATE_LIMIT_MAX') ?? 120),
          },
        ],
        // A shared Redis store so the limit is enforced across instances behind a
        // load balancer; in-memory (the default) is correct for a single node.
        ...(config.get('RATE_LIMIT_STORAGE') === 'redis'
          ? { storage: new ThrottlerStorageRedisService(String(config.get('REDIS_URL'))) }
          : {}),
      }),
    }),
    PrismaModule,
    AuditModule,
    MailModule,
    QueueModule,
    CacheModule,
    StorageModule,
    AiModule,
    DiscoveryProviderModule,
    AssetHealthModule,
    PushModule,
    ChatModule,
    SsoModule,
    AiConfigModule,
    NotificationsModule,
    AuthModule,
    HealthModule,
    UsersModule,
    RolesModule,
    LicensesModule,
    ProcurementModule,
    StockModule,
    BudgetsModule,
    OrgModule,
    SpecTemplatesModule,
    VendorProductsModule,
    AssetsModule,
    MarketingModule,
    RequestsModule,
    DashboardModule,
    LifecycleModule,
    InvoicesModule,
    StorageHttpModule,
    MobileModule,
    MaintenanceModule,
    DiscoveryModule,
    AnalyticsModule,
    IntegrationsModule,
    PlatformModule,
    ReportsModule,
    ScheduledModule,
  ],
  providers: [
    // Order matters: throttle before authenticating (so an unauthenticated flood
    // is cheap to reject), authenticate before checking permissions.
    // v2.8 S5: buckets per tenant (verified token) and per IP for anonymous
    // callers, so one tenant's traffic cannot exhaust everyone else's limit.
    { provide: APP_GUARD, useClass: TenantThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    // Innermost interceptor: wraps just the handler in a tenant transaction when
    // RLS_ENFORCE is on, so RLS scopes its queries. Passthrough otherwise.
    { provide: APP_INTERCEPTOR, useClass: RlsTenantInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Express 5 / path-to-regexp 8 syntax: a bare '*' is no longer a valid path.
    consumer.apply(RequestContextMiddleware).forRoutes('{*path}');
  }
}
