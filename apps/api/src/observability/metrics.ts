import { createServer, type Server } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import {
  AGENT_STATUSES,
  ASSET_STATUSES,
  deriveAgentStatus,
  isRefreshPending,
  type AgentStatusInput,
} from '@techpioasset/domain';

/**
 * v3.20 - Prometheus metrics.
 *
 * Three properties, in order of importance:
 *
 * 1. **Served on a port of its own, never through nginx.** The main API listens
 *    on API_PORT behind nginx; metrics listen on METRICS_PORT, which the compose
 *    files never publish to the host. Prometheus reaches it over the Docker
 *    network and nobody else can. That is the whole access control: the
 *    counts below are per company and must never be readable from the
 *    internet, so they do not sit on a URL the internet can reach. The main
 *    application has no /metrics route at all (the integration test pins it).
 *
 * 2. **Bounded cardinality.** The request labels are method, status and the
 *    ROUTE TEMPLATE (`/api/v1/assets/:id`), never the URL. A request that
 *    matched no route is one series, "unmatched", however many paths a
 *    scanner tries - a label per path would let the internet grow the
 *    process's memory.
 *
 * 3. **The fleet gauges are refreshed on a timer, not per scrape.** A scrape
 *    is a read of numbers already computed; the database is asked once a
 *    minute whatever the scrape interval, and a failed refresh keeps the last
 *    good numbers and counts itself, so a dashboard can tell "zero agents"
 *    from "could not count".
 */

export const METRICS_PATH = '/metrics';

/** How often the fleet gauges are recomputed from the database. */
export const FLEET_GAUGE_REFRESH_MS = 60_000;

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** Seconds. Dense at the fast end, where an API's latency budget lives. */
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

type HttpLabel = 'method' | 'route' | 'status';

export interface Metrics {
  registry: Registry;
  httpRequests: Counter<HttpLabel>;
  httpDuration: Histogram<HttpLabel>;
  agents: Gauge<'status'>;
  agentRefreshPending: Gauge<string>;
  assets: Gauge<'status'>;
  companies: Gauge<string>;
  m365Connections: Gauge<'status'>;
  fleetRefreshedAt: Gauge<string>;
  fleetRefreshFailures: Counter<string>;
}

export function createMetrics(): Metrics {
  const registry = new Registry();
  // Process CPU, memory, event-loop lag, GC, open handles - the "is the API
  // itself healthy" set, with the standard names every Node dashboard expects.
  collectDefaultMetrics({ register: registry });

  return {
    registry,
    httpRequests: new Counter({
      name: 'http_requests_total',
      help: 'Requests handled, by method, route template and status code.',
      labelNames: ['method', 'route', 'status'],
      registers: [registry],
    }),
    httpDuration: new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Request latency in seconds, by method, route template and status code.',
      labelNames: ['method', 'route', 'status'],
      buckets: DURATION_BUCKETS,
      registers: [registry],
    }),
    agents: new Gauge({
      name: 'techpioasset_agents',
      help: 'Laptop agents across all companies, by the status the Agents tab shows.',
      labelNames: ['status'],
      registers: [registry],
    }),
    agentRefreshPending: new Gauge({
      name: 'techpioasset_agent_refresh_pending',
      help: '"Refresh now" requests not yet answered by a report.',
      registers: [registry],
    }),
    assets: new Gauge({
      name: 'techpioasset_assets',
      help: 'Live (not deleted) asset records across all companies, by status.',
      labelNames: ['status'],
      registers: [registry],
    }),
    companies: new Gauge({
      name: 'techpioasset_companies_active',
      help: 'Active companies (tenants).',
      registers: [registry],
    }),
    m365Connections: new Gauge({
      name: 'techpioasset_m365_connections',
      help: 'Microsoft 365 connections by the result of their last licence sync.',
      labelNames: ['status'],
      registers: [registry],
    }),
    fleetRefreshedAt: new Gauge({
      name: 'techpioasset_fleet_gauges_refreshed_timestamp_seconds',
      help: 'When the techpioasset_* gauges were last recomputed. Stale means the refresh is failing.',
      registers: [registry],
    }),
    fleetRefreshFailures: new Counter({
      name: 'techpioasset_fleet_gauge_refresh_failures_total',
      help: 'Refreshes of the techpioasset_* gauges that failed (the previous values were kept).',
      registers: [registry],
    }),
  };
}

// ---------------------------------------------------------------------------
// Request observation

export function methodLabel(method: string | undefined): string {
  const upper = (method ?? '').toUpperCase();
  return HTTP_METHODS.has(upper) ? upper : 'OTHER';
}

/**
 * The route TEMPLATE the request matched, or "unmatched". Express sets
 * `req.route` once the router has picked a handler, so by the time the
 * response finishes it is there for every routed request; Nest registers its
 * routes with the global prefix already in the path.
 */
export function routeLabel(req: { baseUrl?: string; route?: { path?: unknown } }): string {
  const path = req.route?.path;
  const raw =
    typeof path === 'string'
      ? path
      : Array.isArray(path) && typeof path[0] === 'string'
        ? (path[0] as string)
        : null;
  if (raw === null) return 'unmatched';
  const full = `${req.baseUrl ?? ''}${raw}`.replace(/\/+$/, '');
  return full || '/';
}

/** Health probes run every few seconds from Compose and nginx; they would drown the real traffic. */
export function isObserved(url: string | undefined): boolean {
  return !(url ?? '').startsWith('/health/');
}

/**
 * Records one series per finished response. Attached as the outermost
 * middleware so the duration covers guards, handler and serialisation.
 */
export function observeHttp(metrics: Metrics) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isObserved(req.originalUrl)) {
      next();
      return;
    }
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      const labels = {
        method: methodLabel(req.method),
        route: routeLabel(req),
        status: String(res.statusCode),
      };
      metrics.httpRequests.inc(labels);
      metrics.httpDuration.observe(labels, seconds);
    });
    next();
  };
}

// ---------------------------------------------------------------------------
// Fleet gauges

export interface FleetAgentRow extends AgentStatusInput {
  refreshRequestedAt?: Date | string | null;
}

/** What the gauges need from the database, kept abstract so the unit tests need no database. */
export interface FleetReader {
  agents(): Promise<FleetAgentRow[]>;
  assetsByStatus(): Promise<Array<{ status: string; count: number }>>;
  activeCompanies(): Promise<number>;
  m365Connections(): Promise<Array<{ lastSyncStatus: string | null }>>;
}

const M365_STATUSES = ['ok', 'failed', 'never'] as const;

/**
 * Recomputes every techpioasset_* gauge. Every known label value is set, zero
 * included, so a status that empties out drops to 0 rather than vanishing
 * from the graph - a series that disappears looks the same as one that was
 * never there.
 */
export async function refreshFleetGauges(
  metrics: Metrics,
  reader: FleetReader,
  now: Date = new Date(),
): Promise<void> {
  try {
    const [agents, assets, companies, m365] = await Promise.all([
      reader.agents(),
      reader.assetsByStatus(),
      reader.activeCompanies(),
      reader.m365Connections(),
    ]);

    const agentCounts = new Map<string, number>(AGENT_STATUSES.map((s) => [s, 0]));
    let pending = 0;
    for (const agent of agents) {
      const status = deriveAgentStatus(agent, now);
      agentCounts.set(status, (agentCounts.get(status) ?? 0) + 1);
      if (isRefreshPending(agent.refreshRequestedAt, now)) pending += 1;
    }
    for (const [status, count] of agentCounts) metrics.agents.set({ status }, count);
    metrics.agentRefreshPending.set(pending);

    const assetCounts = new Map<string, number>(ASSET_STATUSES.map((s) => [s, 0]));
    for (const row of assets) assetCounts.set(row.status, row.count);
    for (const [status, count] of assetCounts) metrics.assets.set({ status }, count);

    metrics.companies.set(companies);

    const m365Counts = new Map<string, number>(M365_STATUSES.map((s) => [s, 0]));
    for (const row of m365) {
      const key =
        row.lastSyncStatus === 'ok' || row.lastSyncStatus === 'failed'
          ? row.lastSyncStatus
          : 'never';
      m365Counts.set(key, (m365Counts.get(key) ?? 0) + 1);
    }
    for (const [status, count] of m365Counts) metrics.m365Connections.set({ status }, count);

    metrics.fleetRefreshedAt.set(Math.floor(now.getTime() / 1000));
  } catch (error) {
    metrics.fleetRefreshFailures.inc();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The listener

export interface MetricsServerHandle {
  server: Server;
  /** The port actually bound - matters when asked for 0 (ephemeral, tests). */
  port: number;
  close: () => Promise<void>;
}

/**
 * A plain Node server, deliberately outside Nest: no guards, no throttling,
 * no cookies, no body parsing. It answers GET /metrics and nothing else.
 */
export function startMetricsServer(
  registry: Registry,
  options: { port: number; host: string },
): Promise<MetricsServerHandle> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method !== 'GET' || path !== METRICS_PATH) {
      res.statusCode = 404;
      res.end();
      return;
    }
    registry.metrics().then(
      (body) => {
        res.setHeader('content-type', registry.contentType);
        res.end(body);
      },
      (error: unknown) => {
        res.statusCode = 500;
        res.end(error instanceof Error ? error.message : 'metrics unavailable');
      },
    );
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : options.port;
      resolve({
        server,
        port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
