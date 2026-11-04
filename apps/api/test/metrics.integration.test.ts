import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MetricsService } from '../src/observability/metrics.module.js';
import { startMetricsServer, type MetricsServerHandle } from '../src/observability/metrics.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v3.20 - metrics in a running application.
 *
 * Two things only a booted app can show: that the request middleware labels
 * real Nest routes by their template, and that the main application exposes
 * NO metrics route - the numbers are per company and are served on a port
 * the internet never reaches, so the test lane (METRICS_PORT=0) starts that
 * listener itself, on an ephemeral port, and scrapes it.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let listener: MetricsServerHandle;
let service: MetricsService;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  service = app.get(MetricsService);
  listener = await startMetricsServer(service.metrics.registry, { port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await listener?.close();
  await app?.close();
});

const scrape = async (): Promise<string> => {
  const res = await fetch(`http://127.0.0.1:${listener.port}/metrics`);
  expect(res.status).toBe(200);
  return res.text();
};

describe('the main application has no metrics route', () => {
  it('answers 404 under the API prefix and at the root, logged in or not', async () => {
    expect((await api(app).get('/api/v1/metrics')).status).toBe(404);
    expect((await api(app).get('/api/v1/metrics').set(auth(s.superAdmin))).status).toBe(404);
    expect((await api(app).get('/metrics')).status).toBe(404);
  });
});

describe('request metrics', () => {
  it('label real routes by template and status, not by URL', async () => {
    const list = await api(app).get('/api/v1/assets?pageSize=1').set(auth(s.itAdmin));
    expect(list.status).toBe(200);
    const missing = await api(app).get('/api/v1/assets/no-such-asset-id').set(auth(s.itAdmin));
    expect(missing.status).toBe(404);
    const unknown = await api(app).get('/api/v1/definitely/not/a/route');
    expect(unknown.status).toBe(404);

    const text = await scrape();
    expect(text).toMatch(
      /http_requests_total\{method="GET",route="\/api\/v1\/assets",status="200"\} \d+/,
    );
    expect(text).toMatch(
      /http_requests_total\{method="GET",route="\/api\/v1\/assets\/:id",status="404"\} \d+/,
    );
    expect(text).toMatch(/http_requests_total\{method="GET",route="unmatched",status="404"\} \d+/);
    expect(text).not.toContain('no-such-asset-id');
    expect(text).not.toContain('definitely/not/a/route');
    expect(text).toMatch(
      /http_request_duration_seconds_bucket\{le="0\.005",method="GET",route="\/api\/v1\/assets",status="200"\}/,
    );
  });

  it('leave the health probes out', async () => {
    expect((await api(app).get('/health/live')).status).toBe(200);
    expect(await scrape()).not.toContain('route="/health/live"');
  });
});

describe('fleet gauges', () => {
  it('count across the whole database and name no company', async () => {
    await service.refresh();
    const text = await scrape();

    const companies = Number(/techpioasset_companies_active (\d+)/.exec(text)?.[1]);
    expect(companies).toBeGreaterThanOrEqual(1);
    const assigned = Number(/techpioasset_assets\{status="ASSIGNED"\} (\d+)/.exec(text)?.[1]);
    expect(Number.isNaN(assigned)).toBe(false);
    expect(text).toMatch(/techpioasset_agents\{status="ONLINE"\} \d+/);
    expect(text).toMatch(/techpioasset_m365_connections\{status="never"\} \d+/);
    expect(text).toMatch(/techpioasset_fleet_gauges_refreshed_timestamp_seconds \d{10}/);
    expect(text).toContain('techpioasset_fleet_gauge_refresh_failures_total 0');

    // Numbers, never names: nothing in the scrape identifies a tenant or a person.
    expect(text).not.toContain(s.superAdmin.user.email);
    expect(text).not.toContain('@');
  });
});
