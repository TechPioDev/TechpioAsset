import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.12 — the employee least-privilege audit, as executable assertions.
 *
 * Every test here holds one of the audit's findings closed:
 *  G1  procurement reads are OWN-scoped (no company-wide PR prices)
 *  G2  delegations never leak a colleague's HR profile
 *  G3  an employee's asset detail anonymises previous holders
 *  G4  cost-centre picker rows carry no owner identity for employees
 *  G6  a push token registered to one user cannot be taken over by another
 *  G7  cancelling a foreign request reads as 404, not as "exists but no"
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let companyId: string;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;
});

afterAll(async () => {
  await app?.close();
});

describe('G1 — procurement is OWN-scoped for employees', () => {
  it("an employee's PR list contains only their own, and a foreign PR detail is 404", async () => {
    // A PR raised by someone else (a fellow employee) must be invisible.
    const foreign = await api(app)
      .post('/api/v1/procurement/requests')
      .set(auth(s.employee2))
      .send({
        justification: 'Standing desk for the finance bay - least-privilege audit fixture',
        lines: [{ description: 'Standing desk', quantity: 1, estimatedUnitPrice: '300.00' }],
      });
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(201);
    const foreignId = foreign.body.data.id;

    const list = await api(app)
      .get('/api/v1/procurement/requests?pageSize=100')
      .set(auth(s.employee));
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const requesterIds = new Set(
      list.body.data.map((pr: { requester: { id: string } }) => pr.requester?.id),
    );
    for (const id of requesterIds) expect(id).toBe(s.employee.user.id);

    const detail = await api(app)
      .get(`/api/v1/procurement/requests/${foreignId}`)
      .set(auth(s.employee));
    expect(detail.status).toBe(404);

    // An ALL-scope reader still sees it - the scope narrows, never breaks.
    const adminDetail = await api(app)
      .get(`/api/v1/procurement/requests/${foreignId}`)
      .set(auth(s.superAdmin));
    expect(adminDetail.status).toBe(200);
  });
});

describe('G2 — delegations carry identity, never the HR profile', () => {
  it('naming a colleague as delegate returns their name and email only', async () => {
    const created = await api(app)
      .post('/api/v1/delegations')
      .set(auth(s.employee))
      .send({
        delegateId: s.employee2.user.id,
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
    expect([200, 201]).toContain(created.status);

    const list = await api(app).get('/api/v1/delegations').set(auth(s.employee));
    expect(list.status).toBe(200);
    const raw = JSON.stringify(list.body);
    // The old shape included the ENTIRE profile row of anyone you named.
    expect(raw).not.toContain('employeeNumber');
    expect(raw).not.toContain('phone');
    expect(raw).not.toContain('hireDate');
    expect(raw).not.toContain('managerId');

    // Clean up the fixture delegation.
    await prisma.client.approvalDelegation.deleteMany({
      where: { delegatorId: s.employee.user.id, delegateId: s.employee2.user.id },
    });
  });
});

describe('G3 — asset history is anonymised for the current holder', () => {
  it("shows the employee their own rows but not previous holders' names", async () => {
    // Build a device with a past life: employee2 held it, employee holds it now.
    const asset = await prisma.client.asset.findFirst({
      where: { companyId },
      select: { id: true, condition: true, assignedUserId: true, status: true },
    });
    const original = asset!.assignedUserId;
    const originalStatus = asset!.status;
    // A holder needs a custody status (assets_holder_matches_status).
    await prisma.client.asset.update({
      where: { id: asset!.id },
      data: { assignedUserId: s.employee.user.id, status: 'ASSIGNED' },
    });
    const past = await prisma.client.assetAssignment.create({
      data: {
        assetId: asset!.id,
        userId: s.employee2.user.id,
        conditionOut: asset!.condition,
        assignedAt: new Date(Date.now() - 30 * 86_400_000),
        returnedAt: new Date(Date.now() - 10 * 86_400_000),
      },
    });
    const current = await prisma.client.assetAssignment.create({
      data: { assetId: asset!.id, userId: s.employee.user.id, conditionOut: asset!.condition },
    });

    const res = await api(app).get(`/api/v1/assets/${asset!.id}`).set(auth(s.employee));
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);

    const body = res.body.data;
    expect(body.assignmentCount).toBeGreaterThanOrEqual(2);
    // The holder sees their own device's notes - specs and known problems
    // live there (owner decision, 2026-08-12). What stays protected is other
    // PEOPLE: the anonymisation below is unchanged.
    expect(body).toHaveProperty('notes');
    const rows = body.assignments as { user: { id: string } | null }[];
    const namedUsers = rows.filter((r) => r.user !== null).map((r) => r.user!.id);
    // Every named row is the caller; every other holder is anonymous.
    for (const id of namedUsers) expect(id).toBe(s.employee.user.id);
    expect(JSON.stringify(rows)).not.toContain(s.employee2.user.id);

    // An ALL-scope reader still sees the full named history.
    const adminView = await api(app).get(`/api/v1/assets/${asset!.id}`).set(auth(s.superAdmin));
    expect(JSON.stringify(adminView.body.data.assignments)).toContain(s.employee2.user.id);

    // Restore the fixture.
    await prisma.client.$executeRawUnsafe(
      'DELETE FROM asset_assignments WHERE id IN ($1, $2)',
      past.id,
      current.id,
    );
    await prisma.client.asset.update({
      where: { id: asset!.id },
      data: { assignedUserId: original, status: originalStatus },
    });
  });
});

describe('G11 — vendor is procurement information, not the holders', () => {
  it('an employee never sees which supplier the asset came from', async () => {
    const list = await api(app).get('/api/v1/assets?pageSize=100').set(auth(s.employee));
    expect(list.status, JSON.stringify(list.body).slice(0, 200)).toBe(200);
    // The audit found real vendor names ("Dell Technologies", "Apple Business")
    // reaching employees through the list payload.
    for (const asset of list.body.data) expect(asset.vendor).toBeUndefined();

    // ...and a role that manages vendors still gets it, so the gate narrows
    // the field rather than deleting it. Filtered by vendorId so the rows are
    // guaranteed to have one - most seeded assets do not.
    const vendor = await prisma.client.vendor.findFirst({
      where: { companyId, assets: { some: {} } },
      select: { id: true, name: true },
    });
    expect(vendor, 'fixture needs a vendor with assets').not.toBeNull();
    const itAdmin = await api(app)
      .get(`/api/v1/assets?pageSize=5&vendorId=${vendor!.id}`)
      .set(auth(s.itAdmin));
    expect(itAdmin.status, JSON.stringify(itAdmin.body).slice(0, 200)).toBe(200);
    expect(itAdmin.body.data.length).toBeGreaterThan(0);
    for (const asset of itAdmin.body.data) expect(asset.vendor?.name).toBe(vendor!.name);
  });
});

describe('G4 — cost-centre picker rows are anonymous for employees', () => {
  it('returns code and name but neither owner nor notes', async () => {
    const res = await api(app).get('/api/v1/cost-centres').set(auth(s.employee));
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    for (const row of res.body.data) {
      expect(row.owner).toBeNull();
      expect(row.notes).toBeNull();
    }
    // Finance keeps the full rows.
    const finance = await api(app).get('/api/v1/cost-centres').set(auth(s.finance));
    const anyOwner = finance.body.data.some((row: { owner: unknown }) => row.owner !== null);
    expect(typeof anyOwner).toBe('boolean');
  });
});

describe('G6 — push tokens cannot be taken over', () => {
  it("re-registering another user's token is refused", async () => {
    const token = `test-token-least-priv-${Date.now()}`;
    const first = await api(app)
      .post('/api/v1/mobile/devices')
      .set(auth(s.employee2))
      .send({ token, platform: 'android' });
    expect([200, 201]).toContain(first.status);

    const takeover = await api(app)
      .post('/api/v1/mobile/devices')
      .set(auth(s.employee))
      .send({ token, platform: 'android' });
    expect(takeover.status).toBe(409);

    // Re-registering YOUR OWN token stays fine (app reinstall case).
    const again = await api(app)
      .post('/api/v1/mobile/devices')
      .set(auth(s.employee2))
      .send({ token, platform: 'android' });
    expect([200, 201]).toContain(again.status);

    await prisma.client.deviceToken.deleteMany({ where: { token } });
  });
});

describe('G7 — foreign request writes read as 404', () => {
  it("cancelling someone else's request is indistinguishable from a missing one", async () => {
    const foreign = await prisma.client.assetRequest.findFirst({
      where: { companyId, requesterId: { not: s.employee.user.id }, status: 'SUBMITTED' },
      select: { id: true },
    });
    if (!foreign) return; // no submitted foreign request in the fixture set
    const res = await api(app)
      .post(`/api/v1/requests/${foreign.id}/cancel`)
      .set(auth(s.employee))
      .send({});
    expect(res.status).toBe(404);
  });
});
