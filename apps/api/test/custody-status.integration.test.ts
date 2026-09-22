import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.24 - custody statuses cannot be declared, only earned.
 *
 * Found in production: an asset whose header read "Assigned - Deployed -
 * Assigned" while its overview read "Assigned to: Unassigned". The status menu
 * had been used to set ASSIGNED by hand, and no assignment record existed, so
 * every screen that reads custody (holder, My assets, offboarding) disagreed
 * with every screen that reads status.
 *
 * The rule: ASSIGNED and IN_USE require an open assignment; RETURNED must not
 * be set while one exists. The real flows (assign / return / acknowledge) write
 * status and record in one transaction and are untouched. The tests also pin
 * the repair path for rows already in the phantom state - they must be able to
 * come back out of it.
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
    .send({ assetTag: `CUST-${suffix}`, name: `Custody test ${suffix}`, categoryId, status: 'AVAILABLE' });
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

describe('declaring a custody status by hand', () => {
  it('refuses ASSIGNED through the status endpoint when nobody holds it', async () => {
    const id = await makeAsset();

    const res = await api(app)
      .post(`/api/v1/assets/${id}/status`)
      .set(auth(s.itAdmin))
      .send({ status: 'ASSIGNED' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    // The error must say what to do instead, not merely refuse.
    expect(JSON.stringify(res.body)).toContain('Assign action');
  });

  it('refuses ASSIGNED riding along a general edit', async () => {
    const id = await makeAsset();

    const res = await api(app)
      .patch(`/api/v1/assets/${id}`)
      .set(auth(s.itAdmin))
      .send({ status: 'ASSIGNED' });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('fails ASSIGNED per-asset through bulk status, not the whole batch', async () => {
    const id = await makeAsset();

    const res = await api(app)
      .post('/api/v1/assets/bulk/status')
      .set(auth(s.itAdmin))
      .send({ ids: [id], status: 'ASSIGNED' });

    expect(res.status).toBeLessThan(300);
    expect(res.body.data.succeeded).toHaveLength(0);
    expect(res.body.data.failed).toHaveLength(1);
  });

  it('still allows the real assign flow, which records the holder', async () => {
    const id = await makeAsset();

    const assigned = await api(app)
      .post(`/api/v1/assets/${id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });
    expect(assigned.status).toBeLessThan(300);

    const detail = await api(app).get(`/api/v1/assets/${id}`).set(auth(s.itAdmin));
    expect(detail.body.data.status).toBe('ASSIGNED');
    expect(detail.body.data.assignedUser?.id).toBe(s.employee.user.id);
  });
});

describe('statuses on an asset somebody holds', () => {
  async function makeAssigned() {
    const id = await makeAsset();
    const assigned = await api(app)
      .post(`/api/v1/assets/${id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });
    expect(assigned.status).toBeLessThan(300);
    return id;
  }

  it('allows UNDER_REPAIR while held - a repair does not end custody', async () => {
    const id = await makeAssigned();

    const res = await api(app)
      .post(`/api/v1/assets/${id}/status`)
      .set(auth(s.itAdmin))
      .send({ status: 'UNDER_REPAIR' });

    expect(res.status).toBeLessThan(300);
  });

  it('refuses a hand-typed RETURNED while the assignment is open', async () => {
    const id = await makeAssigned();

    const res = await api(app)
      .post(`/api/v1/assets/${id}/status`)
      .set(auth(s.itAdmin))
      .send({ status: 'RETURNED' });

    // Setting RETURNED by hand would leave the assignment open: holder still
    // shown, and the asset assignable to a second person.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toContain('Return action');
  });

  it('refuses AVAILABLE, and every other "nobody has it" status, while held (v2.75)', async () => {
    // The owner found a mouse shown as Available AND assigned to somebody in
    // one row. Repair done at the holder's desk goes back to them, not to the
    // shelf, unless the return is recorded first.
    const id = await makeAssigned();
    const repair = await api(app)
      .post(`/api/v1/assets/${id}/status`)
      .set(auth(s.itAdmin))
      .send({ status: 'UNDER_REPAIR' });
    expect(repair.status).toBeLessThan(300);

    for (const status of ['AVAILABLE', 'IN_STORAGE', 'RETIRED']) {
      const res = await api(app)
        .post(`/api/v1/assets/${id}/status`)
        .set(auth(s.itAdmin))
        .send({ status });
      expect(res.status, status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(res.body), status).toContain('still holds this asset');
    }

    // The holder is untouched and the list can never say "Available" of it.
    const asset = await prisma.client.asset.findUniqueOrThrow({
      where: { id },
      select: { status: true, assignedUserId: true },
    });
    expect(asset).toEqual({ status: 'UNDER_REPAIR', assignedUserId: s.employee.user.id });
  });

  it('is refused by the database too, whatever path tries it', async () => {
    const id = await makeAssigned();
    await expect(
      prisma.client.$executeRawUnsafe(`UPDATE assets SET status = 'AVAILABLE' WHERE id = $1`, id),
    ).rejects.toThrow(/assets_holder_matches_status/);
  });
});

describe('the default status', () => {
  it('is AVAILABLE when the caller names none - the phone form never does', async () => {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const res = await api(app)
      .post('/api/v1/assets')
      .set(auth(s.itAdmin))
      .send({ assetTag: `DFLT-${suffix}`, name: `Default status ${suffix}`, categoryId });

    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    created.push(res.body.data.id);
    // DRAFT was the old default, and a Draft asset is a trap: it cannot be
    // assigned until somebody notices and flips it.
    expect(res.body.data.status).toBe('AVAILABLE');
  });
});

describe('an asset already in the phantom state', () => {
  it('goes straight to AVAILABLE in one step - nobody holds it, so nothing needs returning', async () => {
    const id = await makeAsset();
    await prisma.client.asset.update({
      where: { id },
      data: { status: 'ASSIGNED', lifecycleState: 'DEPLOYED' },
    });

    // ASSIGNED does not transition to AVAILABLE for a genuinely held asset -
    // but with no assignment behind it, the row is treated as already returned,
    // so the one obvious edit works.
    const res = await api(app)
      .post(`/api/v1/assets/${id}/status`)
      .set(auth(s.itAdmin))
      .send({ status: 'AVAILABLE' });

    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  });

  it('goes straight to AVAILABLE through a general edit too', async () => {
    const id = await makeAsset();
    await prisma.client.asset.update({
      where: { id },
      data: { status: 'ASSIGNED', lifecycleState: 'DEPLOYED' },
    });

    const res = await api(app)
      .patch(`/api/v1/assets/${id}`)
      .set(auth(s.itAdmin))
      .send({ status: 'AVAILABLE' });

    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  });

  it('does not open that shortcut for an asset somebody genuinely holds', async () => {
    const id = await makeAsset();
    const assigned = await api(app)
      .post(`/api/v1/assets/${id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });
    expect(assigned.status).toBeLessThan(300);

    // Held means the Return flow is the only way back to the shelf.
    const res = await api(app)
      .post(`/api/v1/assets/${id}/status`)
      .set(auth(s.itAdmin))
      .send({ status: 'AVAILABLE' });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('can be walked back out: RETURNED, then AVAILABLE, then assigned properly', async () => {
    const id = await makeAsset();
    // Recreate the production defect directly - the API no longer produces it.
    await prisma.client.asset.update({
      where: { id },
      data: { status: 'ASSIGNED', lifecycleState: 'DEPLOYED' },
    });

    // RETURNED with no open assignment is the escape hatch, so it must work.
    const back = await api(app)
      .post(`/api/v1/assets/${id}/status`)
      .set(auth(s.itAdmin))
      .send({ status: 'RETURNED' });
    expect(back.status, JSON.stringify(back.body)).toBeLessThan(300);

    const avail = await api(app)
      .post(`/api/v1/assets/${id}/status`)
      .set(auth(s.itAdmin))
      .send({ status: 'AVAILABLE' });
    expect(avail.status).toBeLessThan(300);

    const assigned = await api(app)
      .post(`/api/v1/assets/${id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });
    expect(assigned.status).toBeLessThan(300);

    const detail = await api(app).get(`/api/v1/assets/${id}`).set(auth(s.itAdmin));
    expect(detail.body.data.assignedUser?.id).toBe(s.employee.user.id);
  });
});
