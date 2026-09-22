import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { localWeekStart } from '@techpioasset/domain';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PushProvider } from '../src/providers/push/push.provider.js';
import { MockPushProvider } from '../src/providers/push/mock-push.provider.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Phase 2 (v2.78): notifications you can act on.
 *
 * - An approval push carries the Approve / Reject buttons and the request id;
 *   a handover push carries Confirm receipt and the asset id.
 * - Low stock reaches the phone.
 * - A supplier asked for a quote hears about it - its own request only, with
 *   no price and no word of the other suppliers.
 * - Admins get one Monday summary a week, in the company's time zone.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let push: MockPushProvider;
let companyId: string;
const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const tokens: string[] = [];
const createdUsers: string[] = [];
const createdVendors: string[] = [];

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;
  const provider = app.get(PushProvider);
  expect(provider, 'integration tests run on the mock push provider').toBeInstanceOf(
    MockPushProvider,
  );
  push = provider as MockPushProvider;
});

afterAll(async () => {
  await prisma?.client.deviceToken.deleteMany({ where: { token: { in: tokens } } });
  await prisma?.client.$executeRawUnsafe(`DELETE FROM assets WHERE "assetTag" LIKE 'PUSH2-%'`);
  if (createdUsers.length) {
    await prisma?.client.notification.deleteMany({ where: { userId: { in: createdUsers } } });
    await prisma?.client.userRole.deleteMany({ where: { userId: { in: createdUsers } } });
    await prisma?.client.user.deleteMany({ where: { id: { in: createdUsers } } });
  }
  await app?.close();
});

/** A phone for this user, so pushes to them are recorded. */
async function phoneFor(userId: string) {
  const token = `test-fcm-${stamp()}`;
  tokens.push(token);
  await prisma.client.deviceToken.create({ data: { userId, token, platform: 'android' } });
  return token;
}

/** Pushes that reached a given phone since `from`. Queue jobs run a beat later. */
async function pushesTo(token: string, from: number) {
  await new Promise((r) => setTimeout(r, 600));
  return push
    .recorded()
    .slice(from)
    .filter((m) => m.tokens.includes(token));
}

describe('buttons on the notification', () => {
  it('an approval push carries Approve / Reject and the request id', async () => {
    const phone = await phoneFor(s.manager.user.id);
    const from = push.recorded().length;

    const created = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.employee))
      .send({
        type: 'ADDITIONAL_EQUIPMENT',
        businessReason: 'Checking that the approval push carries its buttons.',
        estimatedCost: '1699.00',
        items: [
          { description: `Dell Latitude 7450 (${stamp()})`, quantity: 1, estimatedCost: '1699.00' },
        ],
      });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const requestId = created.body.data.id as string;
    await api(app).post(`/api/v1/requests/${requestId}/submit`).set(auth(s.employee));

    const sent = await pushesTo(phone, from);
    const approval = sent.find((m) => m.data?.requestId === requestId);
    expect(approval, 'the manager was pushed about the approval').toBeTruthy();
    expect(approval!.categoryId).toBe('approval');
    expect(approval!.data).toMatchObject({ requestId, linkPath: `/requests/${requestId}` });
    // FCM refuses anything but strings.
    for (const value of Object.values(approval!.data ?? {})) expect(typeof value).toBe('string');
  });

  it('a handover push carries Confirm receipt and the asset id', async () => {
    const phone = await phoneFor(s.employee.user.id);
    const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
    const itCategory = categories.body.data.find((c: { key: string }) => c.key === 'it-assets');
    const tag = `PUSH2-${stamp()}`;
    const asset = await api(app)
      .post('/api/v1/assets')
      .set(auth(s.itAdmin))
      .send({
        assetTag: tag,
        name: `Push laptop ${tag}`,
        categoryId: itCategory.id,
        serialNumber: `SN-${tag}`,
        status: 'AVAILABLE',
      });
    expect(asset.status, JSON.stringify(asset.body).slice(0, 300)).toBe(201);
    const assetId = asset.body.data.id as string;

    const from = push.recorded().length;
    const assigned = await api(app)
      .post(`/api/v1/assets/${assetId}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });
    expect(assigned.status, JSON.stringify(assigned.body).slice(0, 300)).toBeLessThan(300);

    const sent = await pushesTo(phone, from);
    const receipt = sent.find((m) => m.data?.assetId === assetId);
    expect(receipt, 'the new holder was pushed').toBeTruthy();
    expect(receipt!.categoryId).toBe('receipt');
  });

  it('low stock now reaches the phone', async () => {
    const phone = await phoneFor(s.officeAdmin.user.id);
    const from = push.recorded().length;
    await app.get(NotificationsService).notify({
      companyId,
      userId: s.officeAdmin.user.id,
      type: 'LOW_STOCK',
      title: 'Low stock: USB-C chargers',
      body: 'Main store is down to 1 (minimum 5).',
      linkPath: '/inventory',
      entityId: `low-${stamp()}`,
    });
    const sent = await pushesTo(phone, from);
    expect(sent.map((m) => m.title)).toContain('Low stock: USB-C chargers');
    // No buttons: there is nothing to decide from a lock screen.
    expect(sent.find((m) => m.title === 'Low stock: USB-C chargers')!.categoryId).toBeUndefined();
  });
});

describe('a supplier asked for a quote', () => {
  it('tells only that supplier, without prices or the other suppliers', async () => {
    const alpha = await prisma.client.vendor.create({
      data: { companyId, name: `Alpha Quotes ${stamp()}`, code: `AQ${stamp()}`.slice(0, 20) },
    });
    const beta = await prisma.client.vendor.create({
      data: { companyId, name: `Beta Quotes ${stamp()}`, code: `BQ${stamp()}`.slice(0, 20) },
    });
    createdVendors.push(alpha.id, beta.id);
    const role = await prisma.client.role.findFirst({
      where: { companyId, key: 'VENDOR', deletedAt: null },
    });
    const template = await prisma.client.user.findFirstOrThrow({
      where: { companyId, email: 'employee@techpioasset.dev' },
      select: { passwordHash: true },
    });
    const makeUser = async (vendorId: string, label: string) => {
      const user = await prisma.client.user.create({
        data: {
          companyId,
          email: `${label}-${stamp()}@example.com`,
          passwordHash: template.passwordHash,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          vendorId,
          ...(role ? { roles: { create: { roleId: role.id } } } : {}),
        },
      });
      createdUsers.push(user.id);
      return user.id;
    };
    const alphaUser = await makeUser(alpha.id, 'alpha-rfq');
    const betaUser = await makeUser(beta.id, 'beta-rfq');

    const pr = await api(app)
      .post('/api/v1/procurement/requests')
      .set(auth(s.employee))
      .send({
        justification: `Quote alert probe ${stamp()}: docks for the build lab.`,
        lines: [{ description: 'Dell WD19S dock', quantity: 3, estimatedUnitPrice: '14567.00' }],
      });
    expect(pr.status, JSON.stringify(pr.body).slice(0, 300)).toBe(201);
    const prId = pr.body.data.id as string;
    await api(app).post(`/api/v1/procurement/requests/${prId}/submit`).set(auth(s.employee));
    const decided = await api(app)
      .post(`/api/v1/procurement/requests/${prId}/decision`)
      .set(auth(s.finance))
      .send({ decision: 'APPROVE' });
    expect(decided.status, JSON.stringify(decided.body).slice(0, 300)).toBe(201);

    const rfq = await api(app)
      .post(`/api/v1/procurement/requests/${prId}/rfq`)
      .set(auth(s.superAdmin))
      .send({ vendorIds: [alpha.id, beta.id], dueDate: '2026-10-05' });
    expect(rfq.status, JSON.stringify(rfq.body).slice(0, 300)).toBe(201);

    const toAlpha = await prisma.client.notification.findMany({
      where: { userId: alphaUser, type: 'RFQ_REQUESTED' },
    });
    const toBeta = await prisma.client.notification.findMany({
      where: { userId: betaUser, type: 'RFQ_REQUESTED' },
    });
    expect(toAlpha).toHaveLength(1);
    expect(toBeta).toHaveLength(1);
    const body = toAlpha[0]!.body;
    expect(body).toContain('3 × Dell WD19S dock');
    expect(body).toContain('5 Oct 2026');
    // Our estimate is internal, and Alpha must not learn Beta was asked.
    expect(body).not.toMatch(/14,?567/);
    expect(body).not.toContain(beta.name);
    expect(toAlpha[0]!.title).toBe(`Quote requested: ${rfq.body.data.rfqNumber}`);
  });
});

describe('the Monday summary', () => {
  it('goes to the admins once a week, from 09:00 Monday in the company time zone', async () => {
    const sweep = app.get(AlertSweepService);
    const company = await prisma.client.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timezone: true },
    });
    // This week's Monday 10:00, local to the company - a moment in the week
    // the rows written now belong to, so "once a week" can be observed.
    const monday10 = new Date(
      localWeekStart(new Date(), company.timezone).getTime() + 10 * 3_600_000,
    );
    const tuesday10 = new Date(monday10.getTime() + 86_400_000);
    await prisma.client.notification.deleteMany({
      where: {
        companyId,
        type: 'WEEKLY_SUMMARY',
        createdAt: { gte: localWeekStart(new Date(), company.timezone) },
      },
    });

    expect(await sweep.runWeeklySummary(tuesday10), 'not on a Tuesday').toBe(0);
    await sweep.runWeeklySummary(monday10);
    const rows = await prisma.client.notification.findMany({
      where: { companyId, type: 'WEEKLY_SUMMARY', userId: s.superAdmin.user.id },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.at(-1)!.title).toBe('Monday summary');
    // An employee is not an admin.
    expect(
      await prisma.client.notification.count({
        where: { type: 'WEEKLY_SUMMARY', userId: s.employee.user.id },
      }),
    ).toBe(0);

    const before = await prisma.client.notification.count({
      where: { companyId, type: 'WEEKLY_SUMMARY' },
    });
    await sweep.runWeeklySummary(monday10);
    const after = await prisma.client.notification.count({
      where: { companyId, type: 'WEEKLY_SUMMARY' },
    });
    expect(after, 'a second look the same Monday sends nothing').toBe(before);
  });
});
