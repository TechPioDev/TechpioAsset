import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp } from './harness.js';

/**
 * v3.17 - per-IP limits are per IP.
 *
 * The API sits behind nginx on the same host. Express was not told to trust
 * that hop, so every request's address was nginx's own 127.0.0.1 and the
 * per-IP limits on login, password reset and agent enrolment were one bucket
 * for the whole internet. These tests pin the fix: the address nginx appends
 * to X-Forwarded-For is the one the limiter keys on, and only when the
 * request really comes through the loopback hop.
 *
 * The enrolment route is used because it is public, carries a 10-a-minute
 * limit of its own, and a bad token has no side effect beyond a 401.
 */

let app: INestApplication;

const enrol = (ip: string) =>
  api(app)
    .post('/api/v1/discovery/agents/enrol')
    .set({ 'x-enrolment-token': 'tae_not-a-real-token', 'x-forwarded-for': ip })
    .send({ machineId: 'proxy-ip-probe-machine', hostname: 'PROBE', platform: 'windows' });

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

describe('the address a public request is limited by', () => {
  it('is the client nginx reports, so one noisy address does not lock out the rest', async () => {
    for (let i = 0; i < 10; i += 1) expect((await enrol('203.0.113.10')).status).toBe(401);
    expect((await enrol('203.0.113.10')).status).toBe(429);
    // A different client, through the same nginx, is not affected.
    expect((await enrol('203.0.113.11')).status).toBe(401);
  });

  it('cannot be forged past nginx: the hop that is trusted is the loopback only', async () => {
    // A client that writes its own X-Forwarded-For gets the real address
    // appended after it by nginx; Express reads the rightmost untrusted one.
    // Here the "real" address (rightmost) is 203.0.113.12 whatever is forged
    // in front of it.
    for (let i = 0; i < 10; i += 1) {
      expect((await enrol(`10.0.0.${i}, 203.0.113.12`)).status).toBe(401);
    }
    expect((await enrol('10.0.0.99, 203.0.113.12')).status).toBe(429);
  });
});
