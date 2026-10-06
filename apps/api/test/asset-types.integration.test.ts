import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v3.4 — asset types became manageable.
 *
 * Only IT Assets had types; the other three categories were empty for the life
 * of the tenant because the spec gives the admin the type tree and nothing let
 * them write to it.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
const created: string[] = [];
let categoryId = '';

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  const cat = await prisma.client.category.findFirst({
    where: { companyId: s.superAdmin.user.companyId, deletedAt: null },
    select: { id: true },
  });
  categoryId = cat!.id;
});

afterAll(async () => {
  await prisma?.client.subcategory.deleteMany({ where: { id: { in: created } } });
  await app?.close();
});

const unique = () => `Test Type ${Math.random().toString(36).slice(2, 8)}`;

async function create(name: string, as: Session = s.superAdmin) {
  const res = await api(app).post('/api/v1/asset-types').set(auth(as)).send({ categoryId, name });
  if (res.status < 300 && res.body?.data?.id) created.push(res.body.data.id);
  return res;
}

describe('adding a type', () => {
  it('creates it and derives a key from the name', async () => {
    const res = await create('Standing Desk / Riser');
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBeLessThan(300);
    expect(res.body.data.key).toBe('standing-desk-riser');
    expect(res.body.data.isActive).toBe(true);
  });

  it('refuses a duplicate in the same category', async () => {
    const name = unique();
    await create(name);
    const again = await create(name);
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(again.body)).toMatch(/already has a type/i);
  });

  it('points at the retired one rather than just saying no', async () => {
    // The fix differs: reactivate, not rename. A message that does not say so
    // sends somebody off to invent "Desk 2".
    const name = unique();
    const made = await create(name);
    await api(app)
      .patch(`/api/v1/asset-types/${made.body.data.id}`)
      .set(auth(s.superAdmin))
      .send({ isActive: false });

    const again = await create(name);
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(again.body)).toMatch(/retired/i);
  });

  it('refuses a name with nothing to key on', async () => {
    const res = await create('!!!');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses a category belonging to someone else', async () => {
    const other = await prisma.client.category.findFirst({
      where: { companyId: { not: s.superAdmin.user.companyId }, deletedAt: null },
      select: { id: true },
    });
    if (!other) return; // single-tenant test database
    const res = await api(app)
      .post('/api/v1/asset-types')
      .set(auth(s.superAdmin))
      .send({ categoryId: other.id, name: unique() });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('renaming and retiring', () => {
  it('renames without moving the key', async () => {
    // A key that drifts under a rename breaks whatever stored it.
    const made = await create(unique());
    const keyBefore = made.body.data.key;
    const res = await api(app)
      .patch(`/api/v1/asset-types/${made.body.data.id}`)
      .set(auth(s.superAdmin))
      .send({ name: 'Renamed Entirely' });
    expect(res.status).toBeLessThan(300);
    expect(res.body.data.name).toBe('Renamed Entirely');
    expect(res.body.data.key).toBe(keyBefore);
  });

  it('retires instead of deleting, so assets keep their type', async () => {
    const made = await create(unique());
    const res = await api(app)
      .patch(`/api/v1/asset-types/${made.body.data.id}`)
      .set(auth(s.superAdmin))
      .send({ isActive: false });
    expect(res.status).toBeLessThan(300);
    expect(res.body.data.isActive).toBe(false);

    const still = await prisma.client.subcategory.findUnique({ where: { id: made.body.data.id } });
    expect(still, 'retiring must not delete the row').not.toBeNull();
  });
});

describe('who may do it', () => {
  it('lists types with how many assets hold each', async () => {
    const res = await api(app).get('/api/v1/asset-types/manage').set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    const cats = res.body.data as { name: string; types: { assetCount: number }[] }[];
    expect(cats.length).toBeGreaterThan(0);
    expect(cats.some((c) => c.types.every((t) => typeof t.assetCount === 'number'))).toBe(true);
  });

  it('refuses an employee', async () => {
    const res = await api(app).get('/api/v1/asset-types/manage').set(auth(s.employee));
    expect(res.status).toBe(403);
  });

  it('refuses an employee trying to add one', async () => {
    const res = await create(unique(), s.employee);
    expect(res.status).toBe(403);
  });

  it('refuses anonymous', async () => {
    expect((await api(app).get('/api/v1/asset-types/manage')).status).toBe(401);
  });
});
