import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.92 — counts come from the database, not from a page of rows.
 *
 * The dashboard showed 169 assets with a breakdown adding up to 100, because
 * it derived the breakdown by filtering the page it had already fetched and
 * pageSize was 100. The endpoint under test exists so the two numbers come
 * from the same population.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
const tags: string[] = [];

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await prisma?.client.asset.deleteMany({ where: { assetTag: { in: tags } } });
  await app?.close();
});

async function makeAssets(status: string, n: number) {
  const companyId = s.itAdmin.user.companyId;
  const category = await prisma.client.category.findFirst({ where: { companyId } });
  for (let i = 0; i < n; i++) {
    const assetTag = `ST-${status}-${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
    tags.push(assetTag);
    await prisma.client.asset.create({
      data: {
        companyId,
        assetTag,
        name: `Stats ${status} ${i}`,
        categoryId: category!.id,
        status: status as never,
        condition: 'GOOD' as never,
        qrToken: `qr-${assetTag}`,
      },
      select: { id: true },
    });
  }
}

const stats = async () => {
  const res = await api(app).get('/api/v1/assets/stats').set(auth(s.itAdmin));
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  // Responses are enveloped: { data: ... , meta: ... }.
  return res.body.data as {
    total: number;
    byStatus: Record<string, number>;
    byCategory: { name: string; count: number }[];
    byOffice: { name: string; count: number }[];
  };
};

describe('asset counts', () => {
  it('agrees with the list total — the two numbers that disagreed', async () => {
    const before = await stats();
    const list = await api(app)
      .get('/api/v1/assets?pageSize=1')
      .set(auth(s.itAdmin));
    expect(list.status).toBe(200);
    expect(before.total).toBe(list.body.meta.page.totalItems);
  });

  it('counts past the page size', async () => {
    // The fault in one line: with a page of 100, a fleet of 105 must still
    // report 105. Derived from a page it would report 100.
    const before = await stats();
    await makeAssets('IN_STORAGE', 6);
    const after = await stats();
    expect(after.total).toBe(before.total + 6);
    expect(after.byStatus.IN_STORAGE ?? 0).toBe((before.byStatus.IN_STORAGE ?? 0) + 6);

    const list = await api(app).get('/api/v1/assets?pageSize=1').set(auth(s.itAdmin));
    expect(after.total).toBe(list.body.meta.page.totalItems);
  });

  it('breaks down into groups that sum to the total', async () => {
    const { total, byStatus } = await stats();
    const summed = Object.values(byStatus).reduce((n, c) => n + c, 0);
    expect(summed).toBe(total);
  });

  it('breaks down by category to the same total', async () => {
    // The donut printed 169 in the middle and 99 + 1 around it, because the
    // slices were counted from a page of 100.
    const { total, byCategory } = await stats();
    expect(byCategory.reduce((n, c) => n + c.count, 0)).toBe(total);
  });

  it('breaks down by office to the same total, counting the unassigned', async () => {
    // The office pie came to 59%. An asset with no office is not nothing - it
    // is Unassigned, and it is the one worth chasing.
    const { total, byOffice } = await stats();
    expect(byOffice.reduce((n, o) => n + o.count, 0)).toBe(total);
  });

  it('names every group rather than returning ids', async () => {
    const { byCategory, byOffice } = await stats();
    for (const row of [...byCategory, ...byOffice]) {
      expect(row.name, JSON.stringify(row)).not.toMatch(/^c[a-z0-9]{20,}$/); // not a cuid
      expect(row.name.length).toBeGreaterThan(0);
    }
  });

  it('is refused without a session', async () => {
    const res = await api(app).get('/api/v1/assets/stats');
    expect(res.status).toBe(401);
  });

  it('is not swallowed by the :id route', async () => {
    // 'stats' must be matched as a literal path, not read as an asset id.
    const res = await api(app).get('/api/v1/assets/stats').set(auth(s.itAdmin));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('byStatus');
  });
});
