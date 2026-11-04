import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.23 - deleting a record that should never have existed.
 *
 * A spreadsheet import creates whatever the spreadsheet said, mistakes
 * included. Until now the only way to remove one was to dispose of it, which
 * writes a disposal into the device's history and the reports - a fictional
 * event for a device that was never there.
 *
 * The tests care about three things: only a super admin can do it, an assigned
 * row can still be removed (import mistakes are assigned to people, which is how
 * they are noticed), and the record survives as history rather than being
 * destroyed.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let categoryId: string;
const created: string[] = [];

async function makeAsset() {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  const res = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.itAdmin))
    .send({
      assetTag: `DEL-${suffix}`,
      name: `Bad import ${suffix}`,
      categoryId,
      status: 'AVAILABLE',
    });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  created.push(res.body.data.id);
  return res.body.data.id as string;
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);
  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  categoryId = categories.body.data.find((c: { key: string }) => c.key === 'it-assets').id;
});

afterAll(async () => {
  for (const id of created) {
    await prisma.client.$executeRawUnsafe('DELETE FROM asset_assignments WHERE "assetId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM assets WHERE id = $1', id);
  }
  await app?.close();
});

describe('deleting several records at once (v3.18)', () => {
  it('is refused to anyone without assets:delete', async () => {
    const id = await makeAsset();
    const res = await api(app)
      .post('/api/v1/assets/bulk/delete')
      .set(auth(s.itAdmin))
      .send({ ids: [id] });
    expect(res.status).toBe(403);
  });

  it('deletes each selected record and reports the ones it could not', async () => {
    const a = await makeAsset();
    const b = await makeAsset();
    const res = await api(app)
      .post('/api/v1/assets/bulk/delete')
      .set(auth(s.superAdmin))
      .send({ ids: [a, b, 'not-a-real-asset-id'], reason: 'Duplicate import rows' });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(201);
    expect(res.body.data.succeeded.sort()).toEqual([a, b].sort());
    expect(res.body.data.failed).toEqual([
      { id: 'not-a-real-asset-id', reason: expect.stringMatching(/not found/i) },
    ]);

    for (const id of [a, b]) {
      const gone = await api(app).get(`/api/v1/assets/${id}`).set(auth(s.superAdmin));
      expect(gone.status).toBe(404);
    }
  });

  it('refuses an empty selection', async () => {
    const res = await api(app)
      .post('/api/v1/assets/bulk/delete')
      .set(auth(s.superAdmin))
      .send({ ids: [] });
    expect(res.status).toBe(422);
  });
});

describe('deleting an incorrect asset record', () => {
  it('refuses anyone without assets:delete, including IT', async () => {
    const id = await makeAsset();

    // IT can create, assign and dispose - removing a record outright is not theirs.
    const res = await api(app).delete(`/api/v1/assets/${id}`).set(auth(s.itAdmin));

    expect(res.status).toBe(403);
  });

  it('lets a super admin remove one, and it stops appearing', async () => {
    const id = await makeAsset();

    const res = await api(app)
      .delete(`/api/v1/assets/${id}?reason=Duplicate row from the spreadsheet`)
      .set(auth(s.superAdmin));
    expect(res.status).toBeLessThan(300);

    const detail = await api(app).get(`/api/v1/assets/${id}`).set(auth(s.superAdmin));
    expect(detail.status).toBe(404);

    const list = await api(app).get('/api/v1/assets?pageSize=100').set(auth(s.superAdmin));
    expect((list.body.data as { id: string }[]).some((a) => a.id === id)).toBe(false);
  });

  it('removes one that is assigned, and leaves nobody holding it', async () => {
    const id = await makeAsset();
    const assigned = await api(app)
      .post(`/api/v1/assets/${id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });
    expect(assigned.status).toBeLessThan(300);

    const res = await api(app).delete(`/api/v1/assets/${id}`).set(auth(s.superAdmin));
    expect(res.status).toBeLessThan(300);

    // An open assignment left behind would show a person still holding a record
    // that no longer exists.
    const open = await prisma.client.assetAssignment.count({
      where: { assetId: id, returnedAt: null },
    });
    expect(open).toBe(0);

    const kit = await api(app)
      .get(`/api/v1/assets?assignedUserId=${s.employee.user.id}&pageSize=100`)
      .set(auth(s.superAdmin));
    expect((kit.body.data as { id: string }[]).some((a) => a.id === id)).toBe(false);
  });

  it('keeps the row, so a mistaken deletion is recoverable', async () => {
    const id = await makeAsset();
    await api(app).delete(`/api/v1/assets/${id}`).set(auth(s.superAdmin));

    // Reads are filtered to deletedAt: null globally; includeDeleted is the
    // documented opt-out, and is the only way to see that the row survived.
    const row = await prisma.client.asset.findFirst({
      where: { id, includeDeleted: true } as never,
      select: { id: true, deletedAt: true },
    });
    expect(row).not.toBeNull();
    expect(row!.deletedAt).not.toBeNull();
  });

  it('answers 404 when asked to delete something already gone', async () => {
    const id = await makeAsset();
    await api(app).delete(`/api/v1/assets/${id}`).set(auth(s.superAdmin));
    const again = await api(app).delete(`/api/v1/assets/${id}`).set(auth(s.superAdmin));

    // Not a special case: every read is filtered to the undeleted, so the second
    // call genuinely cannot find it, and "not found" is what that means.
    expect(again.status).toBe(404);
  });
});
