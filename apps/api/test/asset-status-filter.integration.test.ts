import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.87 — the asset list filters on the status it was asked for.
 *
 * The dashboard's Available, Assigned, Under repair and Damaged tiles all
 * opened the same unfiltered list of every asset in the company: the page
 * ignored the status on the link. That is fixed in both apps, and this pins
 * the server half — including the list form, which exists so the "Critical"
 * tile (damaged, lost and stolen counted together) can open the exact set it
 * counted rather than a third of it.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
const tags: string[] = [];

/** The statuses returned for a query, as a sorted unique list. */
async function statusesFor(query: string): Promise<string[]> {
  const res = await api(app).get(`/api/v1/assets?pageSize=100&${query}`).set(auth(s.itAdmin));
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  const rows = (res.body.data ?? res.body) as { status: string }[];
  return [...new Set(rows.map((r) => r.status))].sort();
}

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);

  // One asset in each of the statuses the dashboard tiles name.
  const companyId = s.itAdmin.user.companyId;
  const category = await prisma.client.category.findFirst({ where: { companyId } });
  for (const status of ['AVAILABLE', 'UNDER_REPAIR', 'DAMAGED', 'LOST', 'STOLEN'] as const) {
    const assetTag = `SF-${status}-${Date.now().toString(36)}`;
    tags.push(assetTag);
    await prisma.client.asset.create({
      data: {
        companyId,
        assetTag,
        name: `Status filter ${status}`,
        categoryId: category!.id,
        status,
        condition: 'GOOD',
        qrToken: `qr-${assetTag}`,
      },
    });
  }
});

afterAll(async () => {
  await prisma?.client.asset.deleteMany({ where: { assetTag: { in: tags } } });
  await app?.close();
});

describe('filtering the asset list by status', () => {
  it('returns only that status, for each one a tile links to', async () => {
    for (const status of ['AVAILABLE', 'ASSIGNED', 'UNDER_REPAIR', 'DAMAGED'] as const) {
      const found = await statusesFor(`status=${status}`);
      // Every row matches; an empty page is fine, a foreign status is not.
      expect(found.filter((f) => f !== status), status).toEqual([]);
    }
  });

  it('narrows the list rather than returning everything', async () => {
    const all = await statusesFor('');
    const damaged = await statusesFor('status=DAMAGED');
    // The bug: the filtered call came back with the whole fleet.
    expect(all.length).toBeGreaterThan(1);
    expect(damaged).toEqual(['DAMAGED']);
  });

  it('takes several statuses at once, for the damaged/lost/stolen tile', async () => {
    const found = await statusesFor('status=DAMAGED,LOST,STOLEN');
    expect(found).toEqual(['DAMAGED', 'LOST', 'STOLEN']);
  });

  it('tolerates spaces around the commas', async () => {
    expect(await statusesFor('status=DAMAGED,%20LOST')).toEqual(['DAMAGED', 'LOST']);
  });

  it('refuses a status it does not know rather than ignoring the filter', async () => {
    // Quietly dropping it is how "filtered" pages end up showing everything.
    const res = await api(app).get('/api/v1/assets?status=NONSENSE').set(auth(s.itAdmin));
    expect(res.status).toBe(422);
  });

  it('refuses a list with one bad value in it', async () => {
    const res = await api(app).get('/api/v1/assets?status=DAMAGED,NONSENSE').set(auth(s.itAdmin));
    expect(res.status).toBe(422);
  });
});
