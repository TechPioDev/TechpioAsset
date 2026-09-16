import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Phase 2b: the custody notifications the spec calls mandatory.
 *
 * ASSET_ASSIGNED, RECEIPT_CONFIRMATION and RETURN_OVERDUE were all defined,
 * all marked mandatory, and none of them had ever been emitted by anything.
 * A device could be booked out against someone's name without that person
 * being told, and a loan could run months past its return date in silence.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let sweeps: AlertSweepService;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  sweeps = app.get(AlertSweepService);
});

afterAll(async () => {
  // Each run assigns a pile of test laptops to the shared employee account.
  // Left behind, they accumulate until every scope-comparison test in the
  // suite saturates its page cap and starts failing for reasons that have
  // nothing to do with the code under test. Raw SQL so the soft-delete
  // middleware does not turn this into more residue.
  await app
    .get(PrismaService)
    .client.$executeRawUnsafe(`DELETE FROM assets WHERE "assetTag" LIKE 'NOTIF-%'`);
  await app?.close();
});

const uniq = () => `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 900 + 100)}`;

async function freshAsset(suffix: string) {
  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  const itCategory = categories.body.data.find((c: { key: string }) => c.key === 'it-assets');
  const created = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.itAdmin))
    .send({
      assetTag: `NOTIF-${suffix}`,
      name: `Notification test laptop ${suffix}`,
      categoryId: itCategory.id,
      serialNumber: `NOTIFSN-${suffix}`,
      status: 'AVAILABLE',
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.data as { id: string; assetTag: string };
}

const notificationsFor = (userId: string, type: string, entityId: string) =>
  prisma.client.notification.findMany({ where: { userId, type: type as never, entityId } });

describe('ASSET_ASSIGNED', () => {
  it('tells the recipient when a device is issued to them', async () => {
    const asset = await freshAsset(uniq());

    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });

    const sent = await notificationsFor(s.employee.user.id, 'ASSET_ASSIGNED', asset.id);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain(asset.assetTag);
    expect(sent[0].linkPath).toBe('/my-assets');
  });

  it('tells the incoming holder after a handover, and not the outgoing one', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });

    await api(app)
      .post(`/api/v1/assets/${asset.id}/reassign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee2.user.id, conditionIn: 'GOOD' });

    expect(await notificationsFor(s.employee2.user.id, 'ASSET_ASSIGNED', asset.id)).toHaveLength(1);
    // The first holder was told once, when they received it - not again when
    // it left them.
    expect(await notificationsFor(s.employee.user.id, 'ASSET_ASSIGNED', asset.id)).toHaveLength(1);
  });

  it('names the return date when the loan has one', async () => {
    const asset = await freshAsset(uniq());
    const due = new Date(Date.now() + 14 * 86_400_000);

    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({
        userId: s.employee.user.id,
        conditionOut: 'GOOD',
        expectedReturnAt: due.toISOString(),
      });

    const [sent] = await notificationsFor(s.employee.user.id, 'ASSET_ASSIGNED', asset.id);
    expect(sent.body).toContain('Please return it by');
  });
});

/**
 * Makes a handover the OLDEST unconfirmed one in the database. The sweep takes
 * the 500 oldest, and the test database carries hundreds of unconfirmed
 * handovers left by other suites, so a handover dated now could sit outside
 * the batch and never be chased - which read as the sweep being broken.
 */
async function backdate(assignmentId: string) {
  await prisma.client.assetAssignment.update({
    where: { id: assignmentId },
    data: { assignedAt: new Date('2000-01-01T00:00:00Z') },
  });
}

describe('RECEIPT_CONFIRMATION sweep', () => {
  it('leaves a fresh handover alone, then chases it once the grace period passes', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });

    const assignment = await prisma.client.assetAssignment.findFirstOrThrow({
      where: { assetId: asset.id, returnedAt: null },
    });

    // Today: nothing. Somebody issued a laptop an hour ago.
    await sweeps.runReceiptSweep();
    expect(await notificationsFor(s.employee.user.id, 'RECEIPT_CONFIRMATION', assignment.id))
      .toHaveLength(0);

    // Long past the grace period, still unconfirmed.
    await backdate(assignment.id);
    await sweeps.runReceiptSweep();
    const chased = await notificationsFor(
      s.employee.user.id,
      'RECEIPT_CONFIRMATION',
      assignment.id,
    );
    expect(chased).toHaveLength(1);
    expect(chased[0].body).toContain(asset.assetTag);
  });

  it('does not chase the same handover twice in a week, and stops after three', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });

    const assignment = await prisma.client.assetAssignment.findFirstOrThrow({
      where: { assetId: asset.id, returnedAt: null },
    });
    const count = async () =>
      (await notificationsFor(s.employee.user.id, 'RECEIPT_CONFIRMATION', assignment.id)).length;

    await backdate(assignment.id);
    await sweeps.runReceiptSweep();
    expect(await count()).toBe(1);

    // The next night. Nothing has changed, and neither should their inbox.
    await sweeps.runReceiptSweep(new Date(Date.now() + 5 * 86_400_000));
    expect(await count()).toBe(1);

    await sweeps.runReceiptSweep(new Date(Date.now() + 12 * 86_400_000));
    await sweeps.runReceiptSweep(new Date(Date.now() + 19 * 86_400_000));
    expect(await count()).toBe(3);

    // Three unanswered reminders is a conversation, not a fourth email.
    await sweeps.runReceiptSweep(new Date(Date.now() + 26 * 86_400_000));
    expect(await count()).toBe(3);
  });

  it('stops chasing the moment the holder confirms', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });

    const assignment = await prisma.client.assetAssignment.findFirstOrThrow({
      where: { assetId: asset.id, returnedAt: null },
    });

    const ack = await api(app)
      .post(`/api/v1/assets/assignments/${assignment.id}/acknowledge`)
      .set(auth(s.employee))
      .send({});
    expect(ack.status).toBe(201);

    await sweeps.runReceiptSweep(new Date(Date.now() + 30 * 86_400_000));
    expect(await notificationsFor(s.employee.user.id, 'RECEIPT_CONFIRMATION', assignment.id))
      .toHaveLength(0);
  });

  it('writes the acknowledgement to the audit log', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });

    const assignment = await prisma.client.assetAssignment.findFirstOrThrow({
      where: { assetId: asset.id, returnedAt: null },
    });
    await api(app)
      .post(`/api/v1/assets/assignments/${assignment.id}/acknowledge`)
      .set(auth(s.employee))
      .send({});

    const audit = await api(app)
      .get(`/api/v1/audit?entityId=${asset.id}&pageSize=50`)
      .set(auth(s.superAdmin));
    expect(
      audit.body.data.some((e: { action: string }) => e.action === 'RECEIPT_ACKNOWLEDGED'),
    ).toBe(true);
  });
});

describe('RETURN_OVERDUE sweep', () => {
  it('tells both the holder and whoever issued it once a loan runs late', async () => {
    const asset = await freshAsset(uniq());
    const due = new Date(Date.now() - 3 * 86_400_000);

    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({
        userId: s.employee.user.id,
        conditionOut: 'GOOD',
        expectedReturnAt: due.toISOString(),
      });

    const raised = await sweeps.runReturnOverdueSweep();
    expect(raised).toBeGreaterThanOrEqual(1);

    const holder = await notificationsFor(s.employee.user.id, 'RETURN_OVERDUE', asset.id);
    const issuer = await notificationsFor(s.itAdmin.user.id, 'RETURN_OVERDUE', asset.id);
    expect(holder).toHaveLength(1);
    expect(issuer).toHaveLength(1);
    expect(holder[0].body).toContain('day(s) ago');
  });

  it('does not repeat the same alert on a second pass the same day', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({
        userId: s.employee.user.id,
        conditionOut: 'GOOD',
        expectedReturnAt: new Date(Date.now() - 86_400_000).toISOString(),
      });

    await sweeps.runReturnOverdueSweep();
    await sweeps.runReturnOverdueSweep();

    expect(await notificationsFor(s.employee.user.id, 'RETURN_OVERDUE', asset.id)).toHaveLength(1);
  });

  it('ignores a loan that is not due yet, and one already returned', async () => {
    const future = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${future.id}/assign`)
      .set(auth(s.itAdmin))
      .send({
        userId: s.employee.user.id,
        conditionOut: 'GOOD',
        expectedReturnAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });

    const returned = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${returned.id}/assign`)
      .set(auth(s.itAdmin))
      .send({
        userId: s.employee.user.id,
        conditionOut: 'GOOD',
        expectedReturnAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      });
    await api(app)
      .post(`/api/v1/assets/${returned.id}/return`)
      .set(auth(s.itAdmin))
      .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });

    await sweeps.runReturnOverdueSweep();

    expect(await notificationsFor(s.employee.user.id, 'RETURN_OVERDUE', future.id)).toHaveLength(0);
    expect(await notificationsFor(s.employee.user.id, 'RETURN_OVERDUE', returned.id)).toHaveLength(
      0,
    );
  });
});
