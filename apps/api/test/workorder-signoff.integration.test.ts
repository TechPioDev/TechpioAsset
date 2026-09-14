import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Work-order sign-off: assign → the technician accepts → start → complete
 * (AWAITING_APPROVAL) → a DIFFERENT manager approves (COMPLETED, asset back in
 * service) or sends it back with a reason (IN_PROGRESS). Cancel works from any
 * open status. Cast: itAdmin is the technician, officeAdmin the approver - both
 * hold maintenance:manage.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let categoryId: string;
let assetId: string;
let foreignCompanyId: string;
let foreignOrderId: string;

const run = Date.now() % 1_000_000;
const base = '/api/v1/maintenance';

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);

  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  categoryId = categories.body.data.find((c: { key: string }) => c.key === 'it-assets').id;

  const asset = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.superAdmin))
    .send({ assetTag: `SO-${run}`, name: 'Sign-off test rig', categoryId, status: 'AVAILABLE' });
  expect(asset.status, JSON.stringify(asset.body)).toBe(201);
  assetId = asset.body.data.id;

  // Another tenant's work order, written directly: nobody here may touch it.
  const company = await prisma.client.company.create({
    data: { name: `Sign-off Probe Tenant ${run}` },
    select: { id: true },
  });
  foreignCompanyId = company.id;
  const foreignCategory = await prisma.client.category.create({
    data: { companyId: foreignCompanyId, key: `so-probe-${run}`, name: 'Probe' },
    select: { id: true },
  });
  const foreignAsset = await prisma.client.asset.create({
    data: {
      companyId: foreignCompanyId,
      assetTag: `SO-F-${run}`,
      name: 'Foreign rig',
      categoryId: foreignCategory.id,
      qrToken: `so-probe-${run}`,
    },
    select: { id: true },
  });
  const foreignOrder = await prisma.client.maintenanceRecord.create({
    data: {
      assetId: foreignAsset.id,
      type: 'REPAIR',
      status: 'AWAITING_APPROVAL',
      title: 'Foreign job',
      technicianId: null,
    },
    select: { id: true },
  });
  foreignOrderId = foreignOrder.id;
});

afterAll(async () => {
  const orders = await prisma.client.maintenanceRecord.findMany({
    where: { assetId },
    select: { id: true },
  });
  const ids = [...orders.map((o) => o.id), foreignOrderId];
  await prisma.client.notification.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.client.maintenanceRecord.deleteMany({ where: { assetId } });
  await prisma.client.asset.delete({ where: { id: assetId } }).catch(() => undefined);
  await prisma.client.company.delete({ where: { id: foreignCompanyId } }).catch(() => undefined);
  await app?.close();
});

async function createWorkOrder(title: string) {
  const res = await api(app)
    .post(base)
    .set(auth(s.officeAdmin))
    .send({ assetId, type: 'REPAIR', title });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id as string;
}

const post = (who: Session, id: string, action: string, body: object = {}) =>
  api(app).post(`${base}/${id}/${action}`).set(auth(who)).send(body);

/** A fresh order, assigned to itAdmin, accepted and started. */
async function startedOrder(title: string) {
  const id = await createWorkOrder(title);
  expect(
    (await post(s.officeAdmin, id, 'assign', { technicianId: s.itAdmin.user.id })).status,
  ).toBe(201);
  expect((await post(s.itAdmin, id, 'accept')).status).toBe(201);
  const started = await post(s.itAdmin, id, 'start');
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  return id;
}

describe('acceptance', () => {
  it('requires the assigned technician to accept before work starts', async () => {
    const id = await createWorkOrder(`Accept first ${run}`);
    await post(s.officeAdmin, id, 'assign', { technicianId: s.itAdmin.user.id });

    const early = await post(s.officeAdmin, id, 'start');
    expect(early.status).toBe(409);
    expect(early.body.detail).toContain('must accept');

    // Somebody else cannot accept on the technician's behalf.
    const notMine = await post(s.officeAdmin, id, 'accept');
    expect(notMine.status).toBe(403);
    expect(notMine.body.detail).toContain('assigned technician');

    const accepted = await post(s.itAdmin, id, 'accept');
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect(accepted.body.data.acceptedById).toBe(s.itAdmin.user.id);
    expect(accepted.body.data.acceptedAt).toBeTruthy();
    expect((await post(s.itAdmin, id, 'accept')).status).toBe(409);

    const audit = await prisma.client.auditLog.findFirst({
      where: { entityType: 'MaintenanceRecord', entityId: id, actorId: s.itAdmin.user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.reason).toContain('accepted');

    const started = await post(s.officeAdmin, id, 'start');
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    expect(started.body.data.status).toBe('IN_PROGRESS');
  });

  it('reassigning to a different technician clears acceptance', async () => {
    const id = await createWorkOrder(`Reassign ${run}`);
    await post(s.officeAdmin, id, 'assign', { technicianId: s.itAdmin.user.id });
    await post(s.itAdmin, id, 'accept');

    // Same technician re-saved (a new SLA): acceptance stands.
    const same = await post(s.officeAdmin, id, 'assign', {
      technicianId: s.itAdmin.user.id,
      slaDueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(same.body.data.acceptedById).toBe(s.itAdmin.user.id);

    const moved = await post(s.itAdmin, id, 'assign', { technicianId: s.officeAdmin.user.id });
    expect(moved.status).toBe(201);
    expect(moved.body.data.acceptedById).toBeNull();
    expect(moved.body.data.acceptedAt).toBeNull();
    expect((await post(s.itAdmin, id, 'start')).status).toBe(409);
    expect((await post(s.itAdmin, id, 'accept')).status).toBe(403);
  });

  it('a job with no technician starts as it always did', async () => {
    const id = await createWorkOrder(`Unassigned ${run}`);
    const started = await post(s.officeAdmin, id, 'start');
    expect(started.status, JSON.stringify(started.body)).toBe(201);
  });

  it('an employee without maintenance:manage cannot accept', async () => {
    const id = await createWorkOrder(`Employee accept ${run}`);
    await post(s.officeAdmin, id, 'assign', { technicianId: s.employee.user.id });
    expect((await post(s.employee, id, 'accept')).status).toBe(403);
  });
});

describe('completion and sign-off', () => {
  it('complete lands in AWAITING_APPROVAL, keeps the asset under repair, and notifies approvers', async () => {
    const id = await startedOrder(`Complete ${run}`);
    const done = await post(s.itAdmin, id, 'complete', {
      serviceCost: '120.00',
      downtimeHours: '4',
      resolutionNotes: 'Fan replaced',
      restoreAsset: true,
    });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body.data.status).toBe('AWAITING_APPROVAL');
    expect(done.body.data.completedById).toBe(s.itAdmin.user.id);
    expect(done.body.data.completedAt).toBeTruthy();
    expect(done.body.data.asset.status).toBe('UNDER_REPAIR');

    // Whoever can approve is told - never the completer.
    const toApprover = await prisma.client.notification.findFirst({
      where: { type: 'WORK_ORDER_AWAITING_APPROVAL', entityId: id, userId: s.officeAdmin.user.id },
    });
    expect(toApprover).toBeTruthy();
    const toSelf = await prisma.client.notification.count({
      where: { type: 'WORK_ORDER_AWAITING_APPROVAL', entityId: id, userId: s.itAdmin.user.id },
    });
    expect(toSelf).toBe(0);

    // Awaiting approval counts as open work.
    const open = await api(app)
      .get(`${base}?open=true&pageSize=100&assetId=${assetId}`)
      .set(auth(s.officeAdmin));
    expect(open.body.data.some((r: { id: string }) => r.id === id)).toBe(true);

    // It cannot be restarted or reassigned in this state.
    expect((await post(s.itAdmin, id, 'start')).status).toBe(409);
    expect(
      (await post(s.officeAdmin, id, 'assign', { technicianId: s.officeAdmin.user.id })).status,
    ).toBe(409);
  });

  it('the completer cannot approve or send back; another manager approves and the asset returns', async () => {
    const id = await startedOrder(`Approve ${run}`);
    await post(s.itAdmin, id, 'complete', { restoreAsset: true });

    const self = await post(s.itAdmin, id, 'approve');
    expect(self.status).toBe(403);
    expect(self.body.detail).toContain('cannot sign it off');
    expect((await post(s.itAdmin, id, 'send-back', { reason: 'Mine' })).status).toBe(403);

    const approved = await post(s.officeAdmin, id, 'approve');
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    expect(approved.body.data.status).toBe('COMPLETED');
    expect(approved.body.data.approvedById).toBe(s.officeAdmin.user.id);
    expect(approved.body.data.approvedAt).toBeTruthy();
    // Restored at sign-off, not at completion.
    expect(approved.body.data.asset.status).toBe('AVAILABLE');

    const told = await prisma.client.notification.findFirst({
      where: { type: 'WORK_ORDER_APPROVED', entityId: id, userId: s.itAdmin.user.id },
    });
    expect(told).toBeTruthy();
    const audit = await prisma.client.auditLog.findFirst({
      where: {
        entityType: 'MaintenanceRecord',
        entityId: id,
        actorId: s.officeAdmin.user.id,
        reason: 'Work order approved',
      },
    });
    expect(audit).toBeTruthy();

    // Closed is closed.
    expect((await post(s.officeAdmin, id, 'approve')).status).toBe(409);
    expect((await post(s.officeAdmin, id, 'cancel')).status).toBe(409);
  });

  it('leaves the asset out of service when the technician said not to restore it', async () => {
    const id = await startedOrder(`No restore ${run}`);
    await post(s.itAdmin, id, 'complete', { restoreAsset: false });
    const approved = await post(s.officeAdmin, id, 'approve');
    expect(approved.status).toBe(201);
    expect(approved.body.data.asset.status).toBe('UNDER_REPAIR');
    // Put the rig back for the rest of the file.
    await prisma.client.asset.update({ where: { id: assetId }, data: { status: 'AVAILABLE' } });
  });

  it('send back requires a reason, reopens the work and records why', async () => {
    const id = await startedOrder(`Send back ${run}`);
    await post(s.itAdmin, id, 'complete', { resolutionNotes: 'Looks fine' });

    const blank = await post(s.officeAdmin, id, 'send-back', { reason: '   ' });
    expect(blank.status).toBe(422);
    expect((await post(s.officeAdmin, id, 'send-back')).status).toBe(422);

    const back = await post(s.officeAdmin, id, 'send-back', { reason: 'Fan still rattles' });
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    expect(back.body.data.status).toBe('IN_PROGRESS');
    expect(back.body.data.sendBackReason).toBe('Fan still rattles');
    expect(back.body.data.diagnosis).toContain('[Sent back] Fan still rattles');
    expect(back.body.data.completedAt).toBeNull();
    expect(back.body.data.completedById).toBeNull();

    const told = await prisma.client.notification.findFirst({
      where: { type: 'WORK_ORDER_SENT_BACK', entityId: id, userId: s.itAdmin.user.id },
    });
    expect(told?.body).toBe('Fan still rattles');
    const audit = await prisma.client.auditLog.findFirst({
      where: { entityType: 'MaintenanceRecord', entityId: id, reason: 'Fan still rattles' },
    });
    expect(audit).toBeTruthy();

    // Sent-back work can be completed again and then approved.
    expect((await post(s.itAdmin, id, 'complete', {})).body.data.status).toBe('AWAITING_APPROVAL');
    expect((await post(s.officeAdmin, id, 'approve')).body.data.status).toBe('COMPLETED');
  });

  it('cancels from AWAITING_APPROVAL with an optional reason, and body-less', async () => {
    const id = await startedOrder(`Cancel ${run}`);
    await post(s.itAdmin, id, 'complete', {});
    const cancelled = await post(s.officeAdmin, id, 'cancel', { reason: 'Asset written off' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(cancelled.body.data.diagnosis).toContain('[Cancelled] Asset written off');

    // The original body-less call still works.
    const other = await createWorkOrder(`Cancel bare ${run}`);
    const bare = await api(app).post(`${base}/${other}/cancel`).set(auth(s.officeAdmin));
    expect(bare.status, JSON.stringify(bare.body)).toBe(201);
    expect(bare.body.data.status).toBe('CANCELLED');
    // Leave the rig usable for later suites.
    await prisma.client.asset.update({ where: { id: assetId }, data: { status: 'AVAILABLE' } });
  });

  it('never escalates an overdue order that is awaiting approval', async () => {
    const id = await startedOrder(`No escalate ${run}`);
    await post(s.itAdmin, id, 'complete', {});
    await prisma.client.maintenanceRecord.update({
      where: { id },
      data: { slaDueAt: new Date(Date.now() - 86_400_000), escalatedAt: null },
    });
    await app.get(AlertSweepService).runWorkOrderSweep();
    const row = await prisma.client.maintenanceRecord.findUnique({ where: { id } });
    expect(row?.escalatedAt).toBeNull();
    await post(s.officeAdmin, id, 'cancel');
    await prisma.client.asset.update({ where: { id: assetId }, data: { status: 'AVAILABLE' } });
  });
});

describe('tenant isolation', () => {
  it("another company's work order is invisible to every sign-off action (404)", async () => {
    for (const action of ['accept', 'approve', 'cancel']) {
      expect((await post(s.superAdmin, foreignOrderId, action)).status).toBe(404);
    }
    expect((await post(s.superAdmin, foreignOrderId, 'send-back', { reason: 'x' })).status).toBe(
      404,
    );
    const row = await prisma.client.maintenanceRecord.findUnique({ where: { id: foreignOrderId } });
    expect(row?.status).toBe('AWAITING_APPROVAL');
  });
});
