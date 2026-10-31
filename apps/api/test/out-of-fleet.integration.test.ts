import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AssetsService } from '../src/assets/assets.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v3.13 — assets that have left the company, and status changes that explain
 * themselves.
 *
 * From the owner's list on 31 Oct:
 *   - a row reading "Disposed" and "Available" at once;
 *   - disposed assets inside "Total assets", which then would not reconcile;
 *   - changing a held laptop to Available "did nothing".
 *
 * Every assertion here is about one of those three, against a real database.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let companyId = '';
const tags: string[] = [];
const run = Math.random().toString(36).slice(2, 7).toUpperCase();

async function makeAsset(status: string, name = `OOF ${status}`) {
  const category = await prisma.client.category.findFirst({ where: { companyId } });
  const assetTag = `OOF-${run}-${status}-${tags.length}`;
  tags.push(assetTag);
  return prisma.client.asset.create({
    data: {
      companyId,
      assetTag,
      name,
      categoryId: category!.id,
      status: status as never,
      condition: 'GOOD' as never,
      qrToken: `qr-${assetTag}`,
    },
    select: { id: true, assetTag: true, availabilityState: true, lifecycleState: true },
  });
}

const admin = () => auth(s.superAdmin);

const listTags = async (query = '') => {
  const res = await api(app).get(`/api/v1/assets?pageSize=100&q=OOF-${run}${query}`).set(admin());
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  return (res.body.data as { assetTag: string }[]).map((a) => a.assetTag).sort();
};

const stats = async () => {
  const res = await api(app).get('/api/v1/assets/stats').set(admin());
  expect(res.status).toBe(200);
  return res.body.data as { total: number; disposed: number; byStatus: Record<string, number> };
};

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;
});

afterAll(async () => {
  // Assignment history is append-only through the app, as it should be; test
  // rows are removed underneath it, the way asset-delete's clean-up does.
  for (const tag of tags) {
    await prisma?.client.$executeRawUnsafe(
      'DELETE FROM asset_assignments WHERE "assetId" IN (SELECT id FROM assets WHERE "assetTag" = $1)',
      tag,
    );
    await prisma?.client.$executeRawUnsafe('DELETE FROM assets WHERE "assetTag" = $1', tag);
  }
  await app?.close();
});

describe('an asset that has left service', () => {
  it('is never stored as available', async () => {
    // The owner's row: Lenovo ThinkPad L490, "Disposed" + "Available".
    for (const status of ['RETIRED', 'DISPOSED', 'DONATED']) {
      const a = await makeAsset(status);
      expect(a.availabilityState, status).toBeNull();
    }
  });

  it('loses its availability when it is moved there, too', async () => {
    const a = await makeAsset('AVAILABLE');
    expect(a.availabilityState).toBe('AVAILABLE');

    const res = await api(app)
      .post(`/api/v1/assets/${a.id}/status`)
      .set(admin())
      .send({ status: 'RETIRED', reason: 'End of life' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBeLessThan(300);

    const after = await prisma.client.asset.findUniqueOrThrow({
      where: { id: a.id },
      select: { availabilityState: true, lifecycleState: true },
    });
    expect(after).toEqual({ availabilityState: null, lifecycleState: 'RETIRED' });
  });
});

describe('disposed and donated assets have their own list', () => {
  it('are left out of the list unless asked for', async () => {
    const kept = await makeAsset('AVAILABLE');
    const retired = await makeAsset('RETIRED');
    const disposed = await makeAsset('DISPOSED');
    const donated = await makeAsset('DONATED');

    const main = await listTags();
    expect(main).toContain(kept.assetTag);
    // Retired is still on the premises, so it stays in the main list.
    expect(main).toContain(retired.assetTag);
    expect(main).not.toContain(disposed.assetTag);
    expect(main).not.toContain(donated.assetTag);

    // The "Disposed assets" list is the status filter set to those two: it
    // has both, and nothing still in service. (Earlier tests in this file
    // dispose of assets too, so it is checked by membership, not by length.)
    const gone = await listTags('&status=DISPOSED,DONATED');
    expect(gone).toContain(disposed.assetTag);
    expect(gone).toContain(donated.assetTag);
    expect(gone).not.toContain(kept.assetTag);
    expect(gone).not.toContain(retired.assetTag);
  });

  it('are not in the total, and are counted beside it', async () => {
    const before = await stats();
    await makeAsset('DISPOSED');
    await makeAsset('DONATED');
    await makeAsset('AVAILABLE');
    const after = await stats();

    // Only the available one joins the fleet.
    expect(after.total).toBe(before.total + 1);
    expect(after.disposed).toBe(before.disposed + 2);
    expect(after.byStatus.DISPOSED ?? 0).toBe(0);
    expect(after.byStatus.DONATED ?? 0).toBe(0);
  });

  it('every count of "all assets" agrees with the list it opens', async () => {
    const statsTotal = (await stats()).total;

    // The tile the phone's home screen shows links to /assets; its number must
    // be the number that list shows, and so must the Insights total.
    const tiles = await api(app).get('/api/v1/dashboard').set(admin());
    expect(tiles.status).toBe(200);
    const assetTile = (tiles.body.data.tiles as { key: string; value: number }[]).find(
      (t) => t.key === 'assets-total',
    );
    expect(assetTile?.value).toBe(statsTotal);

    const list = await api(app).get('/api/v1/assets?pageSize=1').set(admin());
    expect(list.body.meta.page.totalItems).toBe(statsTotal);
  });
});

describe('a status change that cannot happen says why', () => {
  it('sends a laptop somebody holds to Return, in words', async () => {
    const a = await makeAsset('AVAILABLE', 'OOF held laptop');
    const assigned = await api(app)
      .post(`/api/v1/assets/${a.id}/assign`)
      .set(admin())
      .send({ userId: s.employee.user.id });
    expect(assigned.status, JSON.stringify(assigned.body).slice(0, 300)).toBeLessThan(300);

    const res = await api(app)
      .post(`/api/v1/assets/${a.id}/status`)
      .set(admin())
      .send({ status: 'AVAILABLE' });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/with a person/);
    expect(res.body.detail).toMatch(/Use Return/);
    expect(res.body.detail).not.toMatch(/Illegal|->/);

    // And the same words in a bulk change, which used to say only "skipped".
    const bulk = await api(app)
      .post('/api/v1/assets/bulk/status')
      .set(admin())
      .send({ ids: [a.id], status: 'AVAILABLE' });
    expect(bulk.status).toBeLessThan(300);
    expect(bulk.body.data.failed[0].reason).toMatch(/Use Return/);
  });

  it('says plainly that disposed is final', async () => {
    const a = await makeAsset('DISPOSED');
    const res = await api(app)
      .post(`/api/v1/assets/${a.id}/status`)
      .set(admin())
      .send({ status: 'AVAILABLE' });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/final/);
  });
});

describe('the nightly count', () => {
  it('counts the same fleet as the dashboard, and says so', async () => {
    await makeAsset('DISPOSED');
    await app.get(AssetsService).recordFleetSnapshots();

    const takenOn = new Date();
    takenOn.setUTCHours(0, 0, 0, 0);
    const snap = await prisma.client.fleetSnapshot.findUniqueOrThrow({
      where: { companyId_takenOn: { companyId, takenOn } },
      select: { total: true, excludesDisposed: true },
    });
    expect(snap.excludesDisposed).toBe(true);

    // Unscoped admin view: the snapshot is the company, as the stats are.
    expect(snap.total).toBe((await stats()).total);
    await prisma.client.fleetSnapshot.deleteMany({ where: { companyId, takenOn } });
  });

  it('never compares today with a snapshot that counted disposed assets', async () => {
    const takenOn = new Date(Date.now() - 30 * 86_400_000);
    takenOn.setUTCHours(0, 0, 0, 0);
    await prisma.client.fleetSnapshot.deleteMany({ where: { companyId } });
    // A row from before v3.13: its total included disposed assets.
    await prisma.client.fleetSnapshot.create({
      data: {
        companyId,
        takenOn,
        total: 1,
        assigned: 1,
        available: 0,
        inStock: 0,
        onOrder: 0,
        underRepair: 0,
        critical: 0,
        retired: 0,
        other: 0,
        excludesDisposed: false,
      },
    });
    const res = await api(app).get('/api/v1/assets/stats').set(admin());
    // Comparing would have reported every past disposal as the fleet shrinking.
    expect(res.body.data.trend).toBeNull();
    await prisma.client.fleetSnapshot.deleteMany({ where: { companyId } });
  });
});
