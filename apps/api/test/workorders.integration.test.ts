import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.5 H3 — work orders on top of maintenance. Invariants under test: SLA
 * escalation fires EXACTLY ONCE; part draw is the v2.4 guarded take with the
 * work-order reference on the ledger row and honest refusals; preventive
 * schedules spawn one catch-up order and advance strictly into the future.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let sweep: AlertSweepService;
let categoryId: string;
let assetId: string;
let itemId: string;
let locationId: string;

const run = Date.now() % 1_000_000;
const base = '/api/v1/maintenance';

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  sweep = app.get(AlertSweepService);

  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  categoryId = categories.body.data.find((c: { key: string }) => c.key === 'it-assets').id;

  const asset = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.superAdmin))
    .send({ assetTag: `WO-${run}`, name: 'Work-order test rig', categoryId, status: 'AVAILABLE' });
  expect(asset.status, JSON.stringify(asset.body)).toBe(201);
  assetId = asset.body.data.id;

  // A dedicated stock item + location so part draws never disturb other suites.
  const item = await prisma.client.inventoryItem.create({
    data: {
      companyId: s.superAdmin.user.companyId,
      sku: `WO-PART-${run}`,
      name: 'Replacement fan',
      categoryId,
      unit: 'unit',
      minStock: 0,
      createdById: s.superAdmin.user.id,
    },
    select: { id: true },
  });
  itemId = item.id;
  const loc = await api(app)
    .post('/api/v1/stock/locations')
    .set(auth(s.superAdmin))
    .send({ code: `WO-LOC-${run}`, name: 'Bench stock' });
  locationId = loc.body.data.id;
  const stocked = await api(app)
    .post('/api/v1/stock/adjust')
    .set(auth(s.superAdmin))
    .send({ inventoryItemId: itemId, stockLocationId: locationId, delta: 3, reason: 'Suite fixture stock' });
  expect(stocked.status, JSON.stringify(stocked.body)).toBe(201);
});

afterAll(async () => {
  await prisma.client.stockMovement.deleteMany({ where: { inventoryItemId: itemId } });
  await prisma.client.stockLevel.deleteMany({ where: { inventoryItemId: itemId } });
  await prisma.client.inventoryItem.delete({ where: { id: itemId } }).catch(() => undefined);
  await prisma.client.stockLocation.deleteMany({ where: { id: locationId } });
  await prisma.client.maintenanceSchedule.deleteMany({ where: { assetId } });
  await prisma.client.maintenanceRecord.deleteMany({ where: { assetId } });
  await prisma.client.asset.delete({ where: { id: assetId } }).catch(() => undefined);
  await app?.close();
});

async function createWorkOrder(title: string) {
  const res = await api(app)
    .post(base)
    .set(auth(s.itAdmin))
    .send({ assetId, type: 'REPAIR', title });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id as string;
}

describe('assignment and diagnosis', () => {
  it('assigns a technician with an SLA, notifies them, and an employee may not', async () => {
    const id = await createWorkOrder(`Fan rattle ${run}`);
    const due = new Date(Date.now() + 86_400_000).toISOString();

    const forbidden = await api(app)
      .post(`${base}/${id}/assign`)
      .set(auth(s.employee))
      .send({ technicianId: s.itAdmin.user.id, slaDueAt: due });
    expect(forbidden.status).toBe(403);

    const res = await api(app)
      .post(`${base}/${id}/assign`)
      .set(auth(s.itAdmin))
      .send({ technicianId: s.itAdmin.user.id, slaDueAt: due });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.technicianId).toBe(s.itAdmin.user.id);
    expect(res.body.data.slaDueAt).toBeTruthy();

    const notified = await prisma.client.notification.findFirst({
      where: { type: 'WORK_ORDER_ASSIGNED', entityId: id, userId: s.itAdmin.user.id },
    });
    expect(notified).toBeTruthy();

    const diag = await api(app)
      .patch(`${base}/${id}/diagnosis`)
      .set(auth(s.itAdmin))
      .send({ diagnosis: 'Bearing worn; fan needs replacement.' });
    expect(diag.status).toBe(200);
    expect(diag.body.data.diagnosis).toContain('Bearing worn');

    // The technician filter finds it (the mobile "my work orders" query).
    const mine = await api(app)
      .get(`${base}?technicianId=${s.itAdmin.user.id}`)
      .set(auth(s.itAdmin));
    expect(mine.body.data.some((r: { id: string }) => r.id === id)).toBe(true);
  });
});

describe('hold and resume', () => {
  it('holds only from in-progress, resumes only from hold', async () => {
    const id = await createWorkOrder(`Screen flicker ${run}`);

    // Unstarted work cannot be held.
    const early = await api(app).post(`${base}/${id}/hold`).set(auth(s.itAdmin)).send({});
    expect(early.status).toBe(409);

    await api(app).post(`${base}/${id}/start`).set(auth(s.itAdmin));
    const held = await api(app)
      .post(`${base}/${id}/hold`)
      .set(auth(s.itAdmin))
      .send({ reason: 'Waiting for a replacement panel' });
    expect(held.status, JSON.stringify(held.body)).toBe(201);
    expect(held.body.data.status).toBe('ON_HOLD');
    expect(held.body.data.diagnosis).toContain('Waiting for a replacement panel');

    // Held work cannot complete unseen.
    const complete = await api(app)
      .post(`${base}/${id}/complete`)
      .set(auth(s.itAdmin))
      .send({ replacementRecommended: false, restoreAsset: true });
    expect(complete.status).toBe(409);

    const resumed = await api(app).post(`${base}/${id}/resume`).set(auth(s.itAdmin));
    expect(resumed.status).toBe(201);
    expect(resumed.body.data.status).toBe('IN_PROGRESS');

    const done = await api(app)
      .post(`${base}/${id}/complete`)
      .set(auth(s.itAdmin))
      .send({ replacementRecommended: false, restoreAsset: true });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    // Completion goes for sign-off; it no longer closes the order by itself.
    expect(done.body.data.status).toBe('AWAITING_APPROVAL');
  });
});

describe('part consumption', () => {
  it('draws through the ledger with the work-order reference; refusals carry honest numbers', async () => {
    const id = await createWorkOrder(`Fan replacement ${run}`);

    // Parts cannot be drawn before work starts.
    const early = await api(app)
      .post(`${base}/${id}/consume-part`)
      .set(auth(s.itAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locationId, quantity: 1 });
    expect(early.status).toBe(409);

    await api(app).post(`${base}/${id}/start`).set(auth(s.itAdmin));
    const drawn = await api(app)
      .post(`${base}/${id}/consume-part`)
      .set(auth(s.itAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locationId, quantity: 2, note: 'Two fans fitted' });
    expect(drawn.status, JSON.stringify(drawn.body)).toBe(201);
    expect(drawn.body.data.parts).toHaveLength(1);
    expect(Number(drawn.body.data.level.quantity)).toBe(1);

    // The ledger row carries the work-order reference.
    const movement = await prisma.client.stockMovement.findFirst({
      where: { refType: 'MaintenanceRecord', refId: id, type: 'ISSUE' },
    });
    expect(movement).toBeTruthy();
    expect(Number(movement!.quantity)).toBe(2);

    // Only 1 left: a draw of 2 is refused with the real numbers, nothing moves.
    const refused = await api(app)
      .post(`${base}/${id}/consume-part`)
      .set(auth(s.itAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locationId, quantity: 2 });
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toContain('1 available');
    const level = await prisma.client.stockLevel.findUnique({
      where: {
        inventoryItemId_stockLocationId: { inventoryItemId: itemId, stockLocationId: locationId },
      },
    });
    expect(Number(level!.quantity)).toBe(1);

    // The detail payload lists what was used.
    const detail = await api(app).get(`${base}/${id}`).set(auth(s.itAdmin));
    expect(detail.body.data.parts).toHaveLength(1);
    expect(detail.body.data.parts[0].inventoryItem.name).toBe('Replacement fan');
  });
});

describe('SLA escalation', () => {
  it('escalates an overdue order exactly once, audited and notified', async () => {
    const id = await createWorkOrder(`Overdue job ${run}`);
    await api(app)
      .post(`${base}/${id}/assign`)
      .set(auth(s.itAdmin))
      .send({
        technicianId: s.itAdmin.user.id,
        slaDueAt: new Date(Date.now() - 3_600_000).toISOString(), // already overdue
      });
    // An assigned order starts only once its technician has accepted it.
    await api(app).post(`${base}/${id}/accept`).set(auth(s.itAdmin));
    const started = await api(app).post(`${base}/${id}/start`).set(auth(s.itAdmin));
    expect(started.status, JSON.stringify(started.body)).toBe(201);

    const first = await sweep.runWorkOrderSweep();
    const mine = (await prisma.client.maintenanceRecord.findUnique({ where: { id } }))!;
    expect(mine.escalatedAt).not.toBeNull();
    expect(first.escalated).toBeGreaterThanOrEqual(1);

    const notif = await prisma.client.notification.findFirst({
      where: { type: 'WORK_ORDER_ESCALATED', entityId: id },
    });
    expect(notif).toBeTruthy();
    const audit = await prisma.client.auditLog.findFirst({
      where: { action: 'WORK_ORDER_ESCALATED', entityId: id },
    });
    expect(audit).toBeTruthy();

    // Second sweep: nothing more for this order.
    await sweep.runWorkOrderSweep();
    const notifs = await prisma.client.notification.count({
      where: { type: 'WORK_ORDER_ESCALATED', entityId: id },
    });
    expect(notifs).toBe(1);
  });
});

describe('preventive schedules', () => {
  it('spawns ONE catch-up order for a due schedule and advances strictly into the future', async () => {
    const created = await api(app)
      .post(`${base}/schedules`)
      .set(auth(s.itAdmin))
      .send({
        assetId,
        title: `Quarterly clean ${run}`,
        intervalDays: 90,
        firstDueAt: new Date(Date.now() - 10 * 86_400_000).toISOString(), // 10 days overdue
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const scheduleId = created.body.data.id;

    const result = await sweep.runWorkOrderSweep();
    expect(result.spawned).toBeGreaterThanOrEqual(1);

    const orders = await prisma.client.maintenanceRecord.findMany({
      where: { assetId, title: `Quarterly clean ${run}` },
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]!.status).toBe('SCHEDULED');

    const after = (await prisma.client.maintenanceSchedule.findUnique({
      where: { id: scheduleId },
    }))!;
    expect(after.nextDueAt.getTime()).toBeGreaterThan(Date.now());
    expect(after.lastCreatedAt).not.toBeNull();

    // Idempotent: a second sweep spawns nothing for this schedule.
    await sweep.runWorkOrderSweep();
    const again = await prisma.client.maintenanceRecord.count({
      where: { assetId, title: `Quarterly clean ${run}` },
    });
    expect(again).toBe(1);

    // Deactivating stops future spawns even when due.
    const off = await api(app)
      .patch(`${base}/schedules/${scheduleId}`)
      .set(auth(s.itAdmin))
      .send({ isActive: false, nextDueAt: new Date(Date.now() - 1000).toISOString() });
    expect(off.status).toBe(200);
    await sweep.runWorkOrderSweep();
    expect(
      await prisma.client.maintenanceRecord.count({
        where: { assetId, title: `Quarterly clean ${run}` },
      }),
    ).toBe(1);
  });
});
