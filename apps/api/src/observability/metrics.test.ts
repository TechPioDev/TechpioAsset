import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  createMetrics,
  isObserved,
  methodLabel,
  observeHttp,
  refreshFleetGauges,
  routeLabel,
  startMetricsServer,
  type FleetReader,
} from './metrics';

/**
 * v3.20 - the parts of metrics that need no database and no Nest.
 *
 * The property that matters most is bounded cardinality: the request labels
 * must come from the route TEMPLATE, never the URL, or the internet decides
 * how many series the process keeps in memory.
 */

async function scrape(registryMetrics: () => Promise<string>): Promise<string> {
  return registryMetrics();
}

describe('request labels are bounded', () => {
  it('uses the route template, never the URL', () => {
    expect(routeLabel({ route: { path: '/api/v1/assets/:id' } })).toBe('/api/v1/assets/:id');
    expect(routeLabel({ baseUrl: '/api/v1', route: { path: '/assets/:id/' } })).toBe(
      '/api/v1/assets/:id',
    );
    // Express may hand back an array for routes registered with several paths.
    expect(routeLabel({ route: { path: ['/a', '/b'] } })).toBe('/a');
  });

  it('folds every unrouted request into one series', () => {
    expect(routeLabel({})).toBe('unmatched');
    expect(routeLabel({ route: {} })).toBe('unmatched');
    expect(routeLabel({ route: { path: 42 } })).toBe('unmatched');
  });

  it('keeps the method label to the known verbs', () => {
    expect(methodLabel('get')).toBe('GET');
    expect(methodLabel('PROPFIND')).toBe('OTHER');
    expect(methodLabel(undefined)).toBe('OTHER');
  });

  it('leaves the health probes out', () => {
    expect(isObserved('/health/live')).toBe(false);
    expect(isObserved('/health/ready?x=1')).toBe(false);
    expect(isObserved('/api/v1/health-ish')).toBe(true);
    expect(isObserved(undefined)).toBe(true);
  });
});

describe('observeHttp', () => {
  function fakeExchange(overrides: {
    url?: string;
    method?: string;
    route?: unknown;
    status?: number;
  }) {
    const res = new EventEmitter() as EventEmitter & { statusCode: number };
    res.statusCode = overrides.status ?? 200;
    const req = {
      originalUrl: overrides.url ?? '/api/v1/assets/abc',
      method: overrides.method ?? 'GET',
      route: overrides.route ?? { path: '/api/v1/assets/:id' },
    };
    return { req, res };
  }

  it('records one count and one duration per finished response', async () => {
    const metrics = createMetrics();
    const middleware = observeHttp(metrics);
    const { req, res } = fakeExchange({ status: 404 });
    let passed = false;
    middleware(req as never, res as never, () => {
      passed = true;
    });
    expect(passed).toBe(true);
    res.emit('finish');

    const text = await scrape(() => metrics.registry.metrics());
    expect(text).toContain(
      'http_requests_total{method="GET",route="/api/v1/assets/:id",status="404"} 1',
    );
    expect(text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/api/v1/assets/:id",status="404"} 1',
    );
  });

  it('does not record health probes', async () => {
    const metrics = createMetrics();
    const { req, res } = fakeExchange({ url: '/health/live', route: { path: '/health/live' } });
    observeHttp(metrics)(req as never, res as never, () => undefined);
    res.emit('finish');
    expect(await metrics.registry.metrics()).not.toContain('route="/health/live"');
  });

  it('cannot be made to grow by probing paths', async () => {
    const metrics = createMetrics();
    const middleware = observeHttp(metrics);
    for (let i = 0; i < 50; i += 1) {
      const { req, res } = fakeExchange({
        url: `/wp-admin/${i}.php`,
        route: undefined,
        status: 404,
      });
      // Nest's 404 for an unknown path never sets req.route.
      delete (req as { route?: unknown }).route;
      middleware(req as never, res as never, () => undefined);
      res.emit('finish');
    }
    const text = await metrics.registry.metrics();
    expect(text).toContain('http_requests_total{method="GET",route="unmatched",status="404"} 50');
    expect(text).not.toContain('wp-admin');
  });
});

describe('fleet gauges', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  const reader: FleetReader = {
    agents: async () => [
      { lastHeartbeatAt: minutesAgo(3), lastSeenAt: minutesAgo(3) }, // ONLINE
      {
        lastHeartbeatAt: minutesAgo(30),
        lastSeenAt: minutesAgo(30),
        refreshRequestedAt: minutesAgo(5),
      }, // OFFLINE, refresh pending
      { lastSeenAt: minutesAgo(60) }, // ACTIVE (daily reporter)
      { lastSeenAt: minutesAgo(60), revokedAt: minutesAgo(1) }, // REVOKED
      { lastSeenAt: minutesAgo(60), lastRejectedAt: minutesAgo(2) }, // CREDENTIAL_REJECTED
    ],
    assetsByStatus: async () => [
      { status: 'ASSIGNED', count: 120 },
      { status: 'AVAILABLE', count: 7 },
    ],
    activeCompanies: async () => 3,
    m365Connections: async () => [
      { lastSyncStatus: 'ok' },
      { lastSyncStatus: 'failed' },
      { lastSyncStatus: null },
    ],
  };

  it('counts every status, zero included, so a series never silently disappears', async () => {
    const metrics = createMetrics();
    await refreshFleetGauges(metrics, reader, now);
    const text = await metrics.registry.metrics();

    expect(text).toContain('techpioasset_agents{status="ONLINE"} 1');
    expect(text).toContain('techpioasset_agents{status="OFFLINE"} 1');
    expect(text).toContain('techpioasset_agents{status="ACTIVE"} 1');
    expect(text).toContain('techpioasset_agents{status="REVOKED"} 1');
    expect(text).toContain('techpioasset_agents{status="CREDENTIAL_REJECTED"} 1');
    expect(text).toContain('techpioasset_agent_refresh_pending 1');

    expect(text).toContain('techpioasset_assets{status="ASSIGNED"} 120');
    expect(text).toContain('techpioasset_assets{status="AVAILABLE"} 7');
    expect(text).toContain('techpioasset_assets{status="DISPOSED"} 0');

    expect(text).toContain('techpioasset_companies_active 3');
    expect(text).toContain('techpioasset_m365_connections{status="ok"} 1');
    expect(text).toContain('techpioasset_m365_connections{status="failed"} 1');
    expect(text).toContain('techpioasset_m365_connections{status="never"} 1');
    expect(text).toContain(
      `techpioasset_fleet_gauges_refreshed_timestamp_seconds ${Math.floor(now.getTime() / 1000)}`,
    );
  });

  it('keeps the last good numbers and counts the failure when the database is unavailable', async () => {
    const metrics = createMetrics();
    await refreshFleetGauges(metrics, reader, now);
    const broken: FleetReader = {
      ...reader,
      agents: async () => {
        throw new Error('connection refused');
      },
    };
    await expect(
      refreshFleetGauges(metrics, broken, new Date(now.getTime() + 60_000)),
    ).rejects.toThrow('connection refused');
    const text = await metrics.registry.metrics();
    expect(text).toContain('techpioasset_fleet_gauge_refresh_failures_total 1');
    expect(text).toContain('techpioasset_companies_active 3');
    // The timestamp did not advance: a dashboard can see the numbers are stale.
    expect(text).toContain(
      `techpioasset_fleet_gauges_refreshed_timestamp_seconds ${Math.floor(now.getTime() / 1000)}`,
    );
  });
});

describe('the scrape listener', () => {
  it('answers GET /metrics and nothing else', async () => {
    const metrics = createMetrics();
    const handle = await startMetricsServer(metrics.registry, { port: 0, host: '127.0.0.1' });
    try {
      const base = `http://127.0.0.1:${handle.port}`;
      const ok = await fetch(`${base}/metrics`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-type')).toContain('text/plain');
      expect(await ok.text()).toContain('process_cpu_user_seconds_total');

      expect((await fetch(`${base}/`)).status).toBe(404);
      expect((await fetch(`${base}/metrics`, { method: 'POST' })).status).toBe(404);
      expect((await fetch(`${base}/api/v1/assets`)).status).toBe(404);
    } finally {
      await handle.close();
    }
  });
});
