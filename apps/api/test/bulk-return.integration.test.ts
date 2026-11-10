import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v3.24 - bulk return. Each asset runs through the same single return, so the
 * custody and state-machine guards are inherited; these tests prove the batch
 * behaviour: per-id results, the skipped-with-reason case, and the permission.
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

async function makeAsset(assignTo?: string): Promise<string> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const created = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.itAdmin))
    .send({
      assetTag: `BRET-${suffix}`,
      name: `Bulk return ${suffix}`,
      categoryId,
      status: 'AVAILABLE',
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id: string = created.body.data.id;
  if (assignTo) {
    const assigned = await api(app)
      .post(`/api/v1/assets/${id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: assignTo, conditionOut: 'GOOD' });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
  }
  return id;
}

describe('bulk return (v3.24)', () => {
  it('takes back every held asset and skips the one nobody holds, with the reason', async () => {
    const held1 = await makeAsset(s.employee3.user.id);
    const held2 = await makeAsset(s.employee3.user.id);
    const loose = await makeAsset();

    const res = await api(app)
      .post('/api/v1/assets/bulk/return')
      .set(auth(s.itAdmin))
      // held1 twice: a repeated id is returned once, not failed the second time.
      .send({
        ids: [held1, held2, loose, held1],
        conditionIn: 'FAIR',
        resultingStatus: 'IN_STORAGE',
        notes: 'Leaver kit collected',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect([...res.body.data.succeeded].sort()).toEqual([held1, held2].sort());
    expect(res.body.data.failed).toHaveLength(1);
    expect(res.body.data.failed[0].id).toBe(loose);
    expect(res.body.data.failed[0].reason).toContain('no open assignment');

    const after = await api(app).get(`/api/v1/assets/${held1}`).set(auth(s.itAdmin));
    expect(after.body.data.status).toBe('IN_STORAGE');
    expect(after.body.data.condition).toBe('FAIR');
    expect(after.body.data.assignedUser ?? null).toBeNull();

    // Nothing is left with employee3 from this test.
    const still = await api(app)
      .get(`/api/v1/assets?assignedUserId=${s.employee3.user.id}&pageSize=100`)
      .set(auth(s.itAdmin));
    const mine = still.body.data.filter((a: { id: string }) => [held1, held2].includes(a.id));
    expect(mine).toHaveLength(0);
  });

  it('refuses a resulting status a return cannot lead to, per asset, and changes nothing', async () => {
    const held = await makeAsset(s.employee3.user.id);
    try {
      const res = await api(app)
        .post('/api/v1/assets/bulk/return')
        .set(auth(s.itAdmin))
        .send({ ids: [held], conditionIn: 'GOOD', resultingStatus: 'ASSIGNED' });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.succeeded).toHaveLength(0);
      expect(res.body.data.failed[0].id).toBe(held);

      const after = await api(app).get(`/api/v1/assets/${held}`).set(auth(s.itAdmin));
      expect(after.body.data.status).toBe('ASSIGNED');
    } finally {
      await api(app)
        .post(`/api/v1/assets/${held}/return`)
        .set(auth(s.itAdmin))
        .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
    }
  });

  it('is refused to someone without assets:return', async () => {
    const loose = await makeAsset();
    const res = await api(app)
      .post('/api/v1/assets/bulk/return')
      .set(auth(s.employee))
      .send({ ids: [loose], conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
    expect(res.status).toBe(403);
  });

  it('rejects an empty selection', async () => {
    const res = await api(app)
      .post('/api/v1/assets/bulk/return')
      .set(auth(s.itAdmin))
      .send({ ids: [], conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
    expect([400, 422]).toContain(res.status);
  });
});
