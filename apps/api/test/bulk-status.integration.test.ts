import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Bulk status change. Each asset runs through the same validated single-asset
 * path, so the guards are inherited; these tests prove the batch behaviour —
 * permission gating, partial failure, and per-id results.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let categoryId: string;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  categoryId = categories.body.data.find((c: { key: string }) => c.key === 'it-assets').id;
});

afterAll(async () => {
  await app?.close();
});

async function makeAssets(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const suffix = Math.random().toString(36).slice(2, 8);
    const res = await api(app)
      .post('/api/v1/assets')
      .set(auth(s.itAdmin))
      .send({
        assetTag: `BULK-${suffix}`,
        name: `Bulk ${suffix}`,
        categoryId,
        status: 'AVAILABLE',
      });
    ids.push(res.body.data.id);
  }
  return ids;
}

describe('bulk status change', () => {
  it('retires many assets in one call', async () => {
    const ids = await makeAssets(3);
    const res = await api(app)
      .post('/api/v1/assets/bulk/status')
      .set(auth(s.itAdmin))
      .send({ ids, status: 'RETIRED', reason: 'Batch decommission' });

    expect(res.status).toBe(201);
    expect(res.body.data.succeeded).toHaveLength(3);
    expect(res.body.data.failed).toHaveLength(0);
  });

  it('reports partial failure with a per-id reason for invalid transitions', async () => {
    const ids = await makeAssets(2);
    // Retire them first, then attempt an illegal RETIRED -> AVAILABLE for both.
    await api(app)
      .post('/api/v1/assets/bulk/status')
      .set(auth(s.itAdmin))
      .send({ ids, status: 'RETIRED' });

    const res = await api(app)
      .post('/api/v1/assets/bulk/status')
      .set(auth(s.itAdmin))
      .send({ ids, status: 'AVAILABLE' });

    expect(res.status).toBe(201);
    expect(res.body.data.succeeded).toHaveLength(0);
    expect(res.body.data.failed).toHaveLength(2);
    // v3.13: the reason is a sentence a person can act on, not the rule's
    // name ("Illegal AssetStatus transition: RETIRED -> AVAILABLE").
    expect(res.body.data.failed[0].reason).toMatch(/Retired cannot change straight to Available/);
    expect(res.body.data.failed[0].reason).not.toMatch(/Illegal|->/);
  });

  it('forbids a role without assets:update', async () => {
    const ids = await makeAssets(1);
    const res = await api(app)
      .post('/api/v1/assets/bulk/status')
      .set(auth(s.employee))
      .send({ ids, status: 'RETIRED' });
    expect(res.status).toBe(403);
  });

  it('rejects an empty selection', async () => {
    const res = await api(app)
      .post('/api/v1/assets/bulk/status')
      .set(auth(s.itAdmin))
      .send({ ids: [], status: 'RETIRED' });
    expect(res.status).toBe(422);
  });
});
