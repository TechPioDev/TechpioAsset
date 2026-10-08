import type { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphCompanySubscription, GraphSubscribedSku } from '@techpioasset/domain';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { M365LicenseSyncService } from '../src/integrations/m365-license-sync.service.js';
import {
  M365ConnectionError,
  M365GraphClient,
  type M365Credentials,
} from '../src/providers/m365/m365-graph.client.js';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v3.12 — Microsoft 365 licences, mirrored into Licences.
 *
 * Microsoft is replaced by a fake tenant here: there is no live one in this
 * environment, and the rules worth proving are ours anyway - what gets
 * written, what is never touched, and what happens when Microsoft says no.
 * The real client is exercised only up to its interface, which is stated in
 * the client itself rather than hidden behind a green tick.
 */

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SECRET = 'not-a-real-secret-Xy7~Q.test';

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let sync: M365LicenseSyncService;
let companyId = '';

/** What the fake tenant currently owns. Tests rewrite it. */
let tenant: { skus: GraphSubscribedSku[]; subscriptions: GraphCompanySubscription[] };
let fetchSpy: ReturnType<typeof vi.spyOn>;

const sku = (
  skuId: string,
  skuPartNumber: string,
  enabled: number,
  consumedUnits: number,
  over: Partial<GraphSubscribedSku> = {},
): GraphSubscribedSku => ({
  skuId,
  skuPartNumber,
  appliesTo: 'User',
  capabilityStatus: 'Enabled',
  consumedUnits,
  prepaidUnits: { enabled, warning: 0, suspended: 0, lockedOut: 0 },
  ...over,
});

const sub = (skuId: string, nextLifecycleDateTime: string): GraphCompanySubscription => ({
  skuId,
  status: 'Enabled',
  isTrial: false,
  createdDateTime: '2025-04-01T00:00:00Z',
  nextLifecycleDateTime,
});

const standardTenant = () => ({
  skus: [
    sku('sku-std', 'O365_BUSINESS_PREMIUM', 50, 42),
    sku('sku-prem', 'SPB', 5, 5),
    // Free, and must never reach the licence list.
    sku('sku-free', 'FLOW_FREE', 10_000, 3),
  ],
  subscriptions: [sub('sku-std', '2027-04-01T00:00:00Z'), sub('sku-prem', '2027-01-15T00:00:00Z')],
});

const base = '/api/v1/integrations/m365-licences';
const admin = () => auth(s.superAdmin);

const connect = () =>
  api(app)
    .put(base)
    .set(admin())
    .send({ tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET });

const synced = () =>
  prisma.client.softwareLicense.findMany({
    where: { companyId, externalSource: 'M365' },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      edition: true,
      seatsPurchased: true,
      status: true,
      expiryDate: true,
      costAmount: true,
      notes: true,
      externalId: true,
      externalSeatsUsed: true,
      externalStatus: true,
      pools: { select: { seatsAllocated: true, seatsReserved: true } },
      renewals: { select: { seatsDelta: true, notes: true } },
      _count: { select: { assignments: true } },
    },
  });

async function wipe() {
  // Renewals and pools cascade from the licence.
  await prisma.client.softwareLicense.deleteMany({ where: { externalSource: 'M365' } });
  await prisma.client.m365Connection.deleteMany({});
}

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  sync = app.get(M365LicenseSyncService);
  companyId = s.superAdmin.user.companyId;
});

beforeEach(async () => {
  await wipe();
  tenant = standardTenant();
  fetchSpy = vi
    .spyOn(app.get(M365GraphClient), 'fetchSubscriptions')
    .mockImplementation(async () => tenant);
});

afterEach(() => {
  fetchSpy.mockRestore();
});

afterAll(async () => {
  await wipe();
  await app?.close();
});

describe('connecting', () => {
  it('needs the secret the first time', async () => {
    const res = await api(app).put(base).set(admin()).send({ tenantId: TENANT, clientId: CLIENT });
    expect(res.status).toBe(422);
    expect(await prisma.client.m365Connection.count()).toBe(0);
  });

  it('refuses an id that is not an id, before Microsoft is ever asked', async () => {
    const res = await api(app)
      .put(base)
      .set(admin())
      .send({ tenantId: 'techpio.onmicrosoft.com', clientId: CLIENT, clientSecret: SECRET });
    expect(res.status).toBe(422);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stores the secret encrypted and never hands it back', async () => {
    const saved = await connect();
    expect(saved.status, JSON.stringify(saved.body).slice(0, 300)).toBe(200);
    expect(saved.body.data).toMatchObject({ connected: true, tenantId: TENANT, hasSecret: true });

    const read = await api(app).get(base).set(admin());
    // Not in the save response, not in the read, under any key.
    expect(JSON.stringify(saved.body)).not.toContain(SECRET);
    expect(JSON.stringify(read.body)).not.toContain(SECRET);

    const row = await prisma.client.m365Connection.findUniqueOrThrow({ where: { companyId } });
    expect(row.clientSecretEncrypted).not.toContain(SECRET);
    expect(row.clientSecretEncrypted.length).toBeGreaterThan(SECRET.length);
  });

  it('keeps the stored secret when only the ids are corrected', async () => {
    await connect();
    const before = await prisma.client.m365Connection.findUniqueOrThrow({ where: { companyId } });

    const otherTenant = '99999999-2222-3333-4444-555555555555';
    const res = await api(app)
      .put(base)
      .set(admin())
      .send({ tenantId: otherTenant, clientId: CLIENT });
    expect(res.status).toBe(200);

    const after = await prisma.client.m365Connection.findUniqueOrThrow({ where: { companyId } });
    expect(after.tenantId).toBe(otherTenant);
    expect(after.clientSecretEncrypted).toBe(before.clientSecretEncrypted);
  });

  it('is closed to anyone who cannot manage integrations', async () => {
    await connect();
    for (const who of [s.employee, s.itAdmin, s.finance]) {
      // Whoever lacks integrations:manage is refused on every route; nobody is
      // skipped quietly if a role happens to hold it.
      if (who.user.permissions.includes('integrations:manage')) continue;
      expect((await api(app).get(base).set(auth(who))).status).toBe(403);
      expect((await api(app).post(`${base}/sync`).set(auth(who))).status).toBe(403);
      expect((await api(app).delete(base).set(auth(who))).status).toBe(403);
    }
    expect((await api(app).get(base).set(auth(s.employee))).status).toBe(403);
  });
});

describe('trying it before trusting it', () => {
  it('shows what a sync would record and writes nothing', async () => {
    await connect();
    const res = await api(app).post(`${base}/test`).set(admin());
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
    expect(res.body.data.licences.map((l: { name: string }) => l.name)).toEqual([
      'Microsoft 365 Business Premium',
      'Microsoft 365 Business Standard',
    ]);
    expect(res.body.data.skipped.free).toBe(1);
    expect(await synced()).toEqual([]);
  });

  it('says why in words when Microsoft refuses', async () => {
    await connect();
    fetchSpy.mockRejectedValueOnce(
      new M365ConnectionError('The client secret is wrong or has expired.', 'credentials'),
    );
    const res = await api(app).post(`${base}/test`).set(admin());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      ok: false,
      message: 'The client secret is wrong or has expired.',
    });
  });
});

describe('syncing', () => {
  it('records each paid subscription, with its seats, use and renewal date', async () => {
    await connect();
    const res = await api(app).post(`${base}/sync`).set(admin());
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.data).toMatchObject({
      total: 2,
      created: 2,
      updated: 0,
      retired: 0,
      skipped: { free: 1 },
    });

    const rows = await synced();
    expect(rows.map((r) => [r.name, r.edition, r.seatsPurchased, r.externalSeatsUsed])).toEqual([
      ['Microsoft 365 Business Premium', 'SPB', 5, 5],
      ['Microsoft 365 Business Standard', 'O365_BUSINESS_PREMIUM', 50, 42],
    ]);
    const standard = rows[1]!;
    expect(standard.expiryDate).toEqual(new Date('2027-04-01T00:00:00Z'));
    // The seat counter is Microsoft's tally, so every existing screen shows
    // the right "42 of 50" without knowing the licence is synced.
    expect(standard.pools).toEqual([{ seatsAllocated: 50, seatsReserved: 42 }]);
    // Microsoft does not say what anything cost, so nothing is written there.
    expect(standard.costAmount).toBeNull();
  });

  it('hands the credentials it was given to Microsoft, decrypted', async () => {
    await connect();
    await api(app).post(`${base}/sync`).set(admin());
    const used = fetchSpy.mock.calls[0]![0] as M365Credentials;
    expect(used).toEqual({ tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET });
  });

  it('appears in the ordinary licence list, marked as synced', async () => {
    await connect();
    await api(app).post(`${base}/sync`).set(admin());

    // Searched rather than paged: the list caps a page at 100 rows.
    const list = await api(app).get('/api/v1/licenses?q=Business%20Standard').set(admin());
    expect(list.status).toBe(200);
    const row = (list.body.data as Record<string, unknown>[]).find(
      (l) => l.name === 'Microsoft 365 Business Standard',
    );
    expect(row).toMatchObject({
      externalSource: 'M365',
      seatsPurchased: 50,
      seatsReserved: 42,
      seatsAvailable: 8,
      externalSeatsUsed: 42,
    });
  });

  it('changes nothing on a second run', async () => {
    await connect();
    await api(app).post(`${base}/sync`).set(admin());
    const first = await synced();

    const again = await api(app).post(`${base}/sync`).set(admin());
    expect(again.body.data).toMatchObject({ created: 0, updated: 0, unchanged: 2, retired: 0 });

    const second = await synced();
    expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));
    expect(second.flatMap((r) => r.renewals)).toEqual([]);
  });

  it('records a seat change as history, not an overwrite', async () => {
    await connect();
    await api(app).post(`${base}/sync`).set(admin());

    tenant.skus[0] = sku('sku-std', 'O365_BUSINESS_PREMIUM', 60, 47);
    const res = await api(app).post(`${base}/sync`).set(admin());
    expect(res.body.data).toMatchObject({ created: 0, updated: 1, unchanged: 1 });

    const standard = (await synced()).find((r) => r.externalId === 'sku-std')!;
    expect(standard.seatsPurchased).toBe(60);
    expect(standard.pools).toEqual([{ seatsAllocated: 60, seatsReserved: 47 }]);
    expect(standard.renewals).toHaveLength(1);
    expect(standard.renewals[0]).toMatchObject({ seatsDelta: 10 });
    expect(standard.renewals[0]!.notes).toMatch(/50 to 60/);
  });

  it('follows a subscription that shrinks below what was in use', async () => {
    await connect();
    await api(app).post(`${base}/sync`).set(admin());

    // 50 seats with 42 used becomes 30 seats with 42 still assigned: the
    // counter must drop with the allocation in one step, or the database rule
    // that reserved never exceeds allocated refuses the update half-way.
    tenant.skus[0] = sku('sku-std', 'O365_BUSINESS_PREMIUM', 30, 42);
    const res = await api(app).post(`${base}/sync`).set(admin());
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.data.overAssigned).toEqual([
      { name: 'Microsoft 365 Business Standard', by: 12 },
    ]);

    const standard = (await synced()).find((r) => r.externalId === 'sku-std')!;
    expect(standard.pools).toEqual([{ seatsAllocated: 30, seatsReserved: 30 }]);
    // The true figure survives beside the capped counter.
    expect(standard.externalSeatsUsed).toBe(42);
  });

  it('retires what Microsoft stops listing, and revives the same record if it returns', async () => {
    await connect();
    await api(app).post(`${base}/sync`).set(admin());
    const original = (await synced()).find((r) => r.externalId === 'sku-prem')!;

    tenant.skus = tenant.skus.filter((k) => k.skuId !== 'sku-prem');
    const gone = await api(app).post(`${base}/sync`).set(admin());
    expect(gone.body.data).toMatchObject({ retired: 1, total: 1 });

    const retired = (await synced()).find((r) => r.externalId === 'sku-prem')!;
    expect(retired.id).toBe(original.id);
    expect(retired.status).toBe('RETIRED');
    expect(retired.externalStatus).toBe('Removed');

    // A third run must not "retire" it again.
    const still = await api(app).post(`${base}/sync`).set(admin());
    expect(still.body.data.retired).toBe(0);

    tenant.skus.push(sku('sku-prem', 'SPB', 5, 4));
    const back = await api(app).post(`${base}/sync`).set(admin());
    expect(back.body.data).toMatchObject({ created: 0, revived: 1 });
    const revived = (await synced()).find((r) => r.externalId === 'sku-prem')!;
    expect(revived.id).toBe(original.id);
    expect(revived.status).not.toBe('RETIRED');
  });

  it('never touches the cost or the notes somebody typed', async () => {
    await connect();
    await api(app).post(`${base}/sync`).set(admin());
    const standard = (await synced()).find((r) => r.externalId === 'sku-std')!;

    // By an admin who may both edit a licence and record cost - the rule that
    // only cost roles enter purchase cost is the existing one, untouched here.
    const edit = await api(app)
      .patch(`/api/v1/licenses/${standard.id}`)
      .set(admin())
      .send({ costAmount: '1250.00', costCurrency: 'INR', notes: 'Billed annually via reseller' });
    expect(edit.status, JSON.stringify(edit.body).slice(0, 300)).toBe(200);

    tenant.skus[0] = sku('sku-std', 'O365_BUSINESS_PREMIUM', 55, 44);
    await api(app).post(`${base}/sync`).set(admin());

    const after = (await synced()).find((r) => r.externalId === 'sku-std')!;
    expect(after.seatsPurchased).toBe(55);
    expect(after.costAmount?.toString()).toBe('1250');
    expect(after.notes).toBe('Billed annually via reseller');
  });
});

describe('a synced licence is changed in Microsoft 365, not here', () => {
  let id = '';
  beforeEach(async () => {
    await connect();
    await api(app).post(`${base}/sync`).set(admin());
    id = (await synced()).find((r) => r.externalId === 'sku-std')!.id;
  });

  it('refuses to assign a seat', async () => {
    const res = await api(app)
      .post(`/api/v1/licenses/${id}/assign`)
      .set(admin())
      .send({ userId: s.employee.user.id });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/Microsoft 365 admin centre/);
    const row = (await synced()).find((r) => r.id === id)!;
    expect(row._count.assignments).toBe(0);
    expect(row.pools).toEqual([{ seatsAllocated: 50, seatsReserved: 42 }]);
  });

  it('refuses a renewal, a rename and a removal', async () => {
    const renew = await api(app)
      .post(`/api/v1/licenses/${id}/renewals`)
      .set(admin())
      .send({ newExpiry: '2028-04-01T00:00:00.000Z', seatsDelta: 5 });
    expect(renew.status).toBe(409);

    const rename = await api(app)
      .patch(`/api/v1/licenses/${id}`)
      .set(admin())
      .send({ name: 'Our Office plan' });
    expect(rename.status).toBe(409);
    expect(rename.body.detail).toMatch(/name/);

    const remove = await api(app).delete(`/api/v1/licenses/${id}`).set(admin());
    expect(remove.status).toBe(409);

    const row = (await synced()).find((r) => r.id === id)!;
    expect(row.name).toBe('Microsoft 365 Business Standard');
    expect(row.renewals).toEqual([]);
  });

  it('accepts a save that sends the name back unchanged alongside new notes', async () => {
    // A form that posts every field is saving the notes, not renaming
    // anything. Refusing it for "changing the name" would make cost and notes
    // uneditable from any screen built that way.
    const res = await api(app)
      .patch(`/api/v1/licenses/${id}`)
      .set(admin())
      .send({ name: 'Microsoft 365 Business Standard', notes: 'Reviewed in October' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect((await synced()).find((r) => r.id === id)!.notes).toBe('Reviewed in October');
  });

  it('leaves hand-entered licences exactly as they were', async () => {
    const created = await api(app)
      .post('/api/v1/licenses')
      .set(admin())
      .send({
        name: `Hand entered ${Date.now()}`,
        family: 'DESIGN_CREATIVE',
        subscriptionType: 'SUBSCRIPTION',
        purchaseDate: '2026-01-01T00:00:00.000Z',
        expiryDate: '2028-01-01T00:00:00.000Z',
        seatsPurchased: 3,
        unitOfAssignment: 'USER',
      });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const manualId = created.body.data.id as string;
    expect(created.body.data.externalSource).toBeNull();

    const assign = await api(app)
      .post(`/api/v1/licenses/${manualId}/assign`)
      .set(admin())
      .send({ userId: s.employee.user.id });
    expect(assign.status, JSON.stringify(assign.body).slice(0, 300)).toBeLessThan(300);

    // And a sync does not notice it at all.
    const res = await api(app).post(`${base}/sync`).set(admin());
    expect(res.body.data).toMatchObject({ created: 0, retired: 0 });
    const manual = await prisma.client.softwareLicense.findUniqueOrThrow({
      where: { id: manualId },
      select: { status: true, externalSource: true },
    });
    expect(manual).toEqual({ status: 'ACTIVE', externalSource: null });

    await prisma.client.softwareLicense.delete({ where: { id: manualId } });
  });
});

describe('when Microsoft says no', () => {
  it('changes nothing, and leaves the reason where the admin will see it', async () => {
    await connect();
    await api(app).post(`${base}/sync`).set(admin());
    const before = await synced();
    const lastGood = (await api(app).get(base).set(admin())).body.data.lastSyncAt;

    fetchSpy.mockRejectedValueOnce(
      new M365ConnectionError(
        'Signed in, but the app registration is not allowed to read subscriptions.',
        'permission',
      ),
    );
    const res = await api(app).post(`${base}/sync`).set(admin());
    expect(res.status).toBe(503);
    expect(res.body.detail).toMatch(/not allowed to read subscriptions/);

    const status = (await api(app).get(base).set(admin())).body.data;
    expect(status.lastSyncStatus).toBe('failed');
    expect(status.lastSyncMessage).toMatch(/not allowed to read subscriptions/);
    // Still the last time the data was actually read.
    expect(status.lastSyncAt).toBe(lastGood);
    expect(await synced()).toEqual(before);
  });

  it('refuses to sync before anything is connected', async () => {
    const res = await api(app).post(`${base}/sync`).set(admin());
    expect(res.status).toBe(422);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('disconnecting', () => {
  it('stops syncing and keeps what was recorded', async () => {
    await connect();
    await api(app).post(`${base}/sync`).set(admin());

    const res = await api(app).delete(base).set(admin());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ connected: false, hasSecret: false, licences: 2 });
    expect(await prisma.client.m365Connection.count({ where: { companyId } })).toBe(0);
    expect(await synced()).toHaveLength(2);
  });
});

describe('overnight, and between companies', () => {
  it('syncs each connected company with its own credentials, into its own licences', async () => {
    await connect();
    const other = await prisma.client.company.create({
      data: { name: `M365 other tenant ${Date.now()}` },
      select: { id: true },
    });
    const otherTenant = '77777777-2222-3333-4444-555555555555';
    await prisma.client.m365Connection.create({
      data: {
        companyId: other.id,
        tenantId: otherTenant,
        clientId: CLIENT,
        clientSecretEncrypted: (
          await prisma.client.m365Connection.findUniqueOrThrow({ where: { companyId } })
        ).clientSecretEncrypted,
      },
    });

    fetchSpy.mockImplementation(async (credentials: M365Credentials) =>
      credentials.tenantId === otherTenant
        ? { skus: [sku('sku-other', 'ENTERPRISEPACK', 9, 7)], subscriptions: [] }
        : tenant,
    );

    const result = await sync.syncAllConnected();
    expect(result).toEqual({ companies: 2, failed: 0 });

    const mine = await synced();
    expect(mine.map((r) => r.externalId).sort()).toEqual(['sku-prem', 'sku-std']);
    const theirs = await prisma.client.softwareLicense.findMany({
      where: { companyId: other.id },
      select: { name: true, externalId: true },
    });
    expect(theirs).toEqual([{ name: 'Office 365 E3', externalId: 'sku-other' }]);

    // And the screen for this company counts only its own.
    const status = (await api(app).get(base).set(admin())).body.data;
    expect(status).toMatchObject({ tenantId: TENANT, licences: 2 });

    await prisma.client.company.delete({ where: { id: other.id } });
  });

  it("one company's expired secret does not stop the next company's sync", async () => {
    await connect();
    const other = await prisma.client.company.create({
      data: { name: `M365 failing tenant ${Date.now()}` },
      select: { id: true },
    });
    const failingTenant = '66666666-2222-3333-4444-555555555555';
    await prisma.client.m365Connection.create({
      data: {
        companyId: other.id,
        tenantId: failingTenant,
        clientId: CLIENT,
        clientSecretEncrypted: (
          await prisma.client.m365Connection.findUniqueOrThrow({ where: { companyId } })
        ).clientSecretEncrypted,
      },
    });
    fetchSpy.mockImplementation(async (credentials: M365Credentials) => {
      if (credentials.tenantId === failingTenant) {
        throw new M365ConnectionError('The client secret is wrong or has expired.', 'credentials');
      }
      return tenant;
    });

    const result = await sync.syncAllConnected();
    expect(result).toEqual({ companies: 2, failed: 1 });
    expect(await synced()).toHaveLength(2);
    const failed = await prisma.client.m365Connection.findUniqueOrThrow({
      where: { companyId: other.id },
    });
    expect(failed.lastSyncStatus).toBe('failed');
    expect(failed.lastSyncMessage).toMatch(/expired/);

    await prisma.client.company.delete({ where: { id: other.id } });
  });

  it('does not report a synced licence as a seat-counter fault', async () => {
    const sweep = app.get(AlertSweepService);
    const before = await sweep.runLicenseSweep();

    await connect();
    await api(app).post(`${base}/sync`).set(admin());
    // 42 and 5 seats "reserved" with no assignment rows behind them: exactly
    // what the drift check exists to catch on a hand-entered licence, and
    // exactly what a mirrored one looks like by design.
    const after = await sweep.runLicenseSweep();
    expect(after.drift).toBe(before.drift);
  });
});
