import {
  Global,
  Injectable,
  Logger,
  Module,
  type NestMiddleware,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppConfig } from '../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  createMetrics,
  FLEET_GAUGE_REFRESH_MS,
  observeHttp,
  refreshFleetGauges,
  startMetricsServer,
  type FleetReader,
  type Metrics,
  type MetricsServerHandle,
} from './metrics.js';

/**
 * v3.20 - the Nest side of metrics: owns the registry for the process, starts
 * the scrape listener on METRICS_PORT (0 = off), and keeps the fleet gauges
 * fresh on a timer. See metrics.ts for why each of those is shaped as it is.
 */
@Injectable()
export class MetricsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  readonly metrics: Metrics = createMetrics();
  private listener: MetricsServerHandle | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  /** Every count is across companies: this runs outside any request, so no tenant is set and RLS lets every row through. */
  private get reader(): FleetReader {
    const db = this.prisma.client;
    return {
      // Bounded for the guard's sake; a fleet is hundreds of laptops, not millions.
      agents: () =>
        db.deviceAgent.findMany({
          take: 10_000,
          select: {
            revokedAt: true,
            lastSeenAt: true,
            lastRejectedAt: true,
            lastHeartbeatAt: true,
            refreshRequestedAt: true,
          },
        }),
      assetsByStatus: async () =>
        (await db.asset.groupBy({ by: ['status'], _count: { _all: true } })).map((row) => ({
          status: row.status,
          count: row._count._all,
        })),
      activeCompanies: () => db.company.count({ where: { isActive: true } }),
      m365Connections: () =>
        db.m365Connection.findMany({ take: 10_000, select: { lastSyncStatus: true } }),
    };
  }

  /** Recompute the techpioasset_* gauges now. Public for the integration test and for anything that wants fresh numbers. */
  async refresh(): Promise<void> {
    await refreshFleetGauges(this.metrics, this.reader);
  }

  async onApplicationBootstrap(): Promise<void> {
    const port = this.config.get('METRICS_PORT');
    if (port === 0) {
      this.logger.log('Metrics endpoint off (METRICS_PORT=0)');
      return;
    }
    const host = this.config.get('METRICS_HOST');
    try {
      this.listener = await startMetricsServer(this.metrics.registry, { port, host });
    } catch (error) {
      // A port clash must not take the API down with it: the API is the
      // product, the metrics are a window onto it.
      this.logger.error(
        `Metrics endpoint could not listen on ${host}:${port}: ${(error as Error).message}`,
      );
      return;
    }
    this.logger.log(
      `Metrics endpoint listening on ${host}:${this.listener.port}/metrics (internal only)`,
    );

    await this.safeRefresh();
    this.timer = setInterval(() => void this.safeRefresh(), FLEET_GAUGE_REFRESH_MS);
    // Never the reason the process stays alive.
    this.timer.unref();
  }

  private async safeRefresh(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      this.logger.warn(`Fleet gauges not refreshed: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.listener?.close();
    this.listener = null;
  }
}

/** One series per finished response; mounted on every route by AppModule. */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  private readonly observe: ReturnType<typeof observeHttp>;

  constructor(service: MetricsService) {
    this.observe = observeHttp(service.metrics);
  }

  use(req: Request, res: Response, next: NextFunction): void {
    this.observe(req, res, next);
  }
}

@Global()
@Module({
  providers: [MetricsService, MetricsMiddleware],
  exports: [MetricsService],
})
export class MetricsModule {}
