import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Phase 3 (v2.79): a person's name finds the assets they hold and the
 * requests they raised or are for - in the asset list, the request list, and
 * so the global search on the web and the phone, which ask those lists.
 *
 * The rule that matters as much as the finding: a name search stays inside
 * the searcher's scope. An employee typing a colleague's name finds nothing
 * of the colleague's.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let holder: { first: string; last: string; email: string };
let requester: { first: string; last: string; email: string };
let assetId: string;
let requestId: string;
const tag = `PSRCH-${Date.now().toString(36)}`;

const who = async (userId: string) => {
  const u = await prisma.client.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, profile: { select: { firstName: true, lastName: true } } },
  });
  return { first: u.profile!.firstName, last: u.profile!.lastName, email: u.email };
};

const assetIds = async (as: Session, q: string) => {
  const res = await api(app)
    .get(`/api/v1/assets?q=${encodeURIComponent(q)}&pageSize=100`)
    .set(auth(as));
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  return (res.body.data as { id: string }[]).map((a) => a.id);
};
const requestIds = async (as: Session, q: string) => {
  const res = await api(app)
    .get(`/api/v1/requests?q=${encodeURIComponent(q)}&pageSize=100`)
    .set(auth(as));
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  return (res.body.data as { id: string }[]).map((r) => r.id);
};

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  holder = await who(s.employee2.user.id);
  requester = await who(s.employee.user.id);

  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  const itCategory = categories.body.data.find((c: { key: string }) => c.key === 'it-assets');
  const created = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.itAdmin))
    .send({
      assetTag: tag,
      name: `Search probe ${tag}`,
      categoryId: itCategory.id,
      serialNumber: `SN-${tag}`,
      status: 'AVAILABLE',
    });
  expect(created.status, JSON.stringify(created.body).slice(0, 200)).toBe(201);
  assetId = created.body.data.id;
  const assigned = await api(app)
    .post(`/api/v1/assets/${assetId}/assign`)
    .set(auth(s.itAdmin))
    .send({ userId: s.employee2.user.id, conditionOut: 'GOOD' });
  expect(assigned.status).toBeLessThan(300);

  const request = await api(app)
    .post('/api/v1/requests')
    .set(auth(s.employee))
    .send({
      type: 'ADDITIONAL_EQUIPMENT',
      businessReason: 'Checking that a request is found by the name of whoever raised it.',
      estimatedCost: '999.00',
      items: [{ description: `Probe item ${tag}`, quantity: 1, estimatedCost: '999.00' }],
    });
  expect(request.status, JSON.stringify(request.body).slice(0, 200)).toBe(201);
  requestId = request.body.data.id;
});

afterAll(async () => {
  await prisma?.client.$executeRawUnsafe(`DELETE FROM assets WHERE "assetTag" = $1`, tag);
  await app?.close();
});

describe('finding an asset by who holds it', () => {
  it('by first name, full name, surname and email', async () => {
    for (const q of [holder.first, `${holder.first} ${holder.last}`, holder.last, holder.email]) {
      expect(await assetIds(s.itAdmin, q), `searching "${q}"`).toContain(assetId);
    }
  });

  it('every word must match, so a different surname does not', async () => {
    expect(await assetIds(s.itAdmin, `${holder.first} Zzqxwv`)).not.toContain(assetId);
  });

  it('still finds by tag and serial, as before', async () => {
    expect(await assetIds(s.itAdmin, tag)).toContain(assetId);
    expect(await assetIds(s.itAdmin, `SN-${tag}`)).toContain(assetId);
  });

  it('stays inside the searcher’s scope: a colleague’s name finds nothing of theirs', async () => {
    expect(await assetIds(s.employee, `${holder.first} ${holder.last}`)).not.toContain(assetId);
    // The holder searching their own name finds their own laptop.
    expect(await assetIds(s.employee2, holder.first)).toContain(assetId);
  });
});

describe('finding a request by who raised it', () => {
  it('by the requester’s name or email', async () => {
    for (const q of [requester.first, `${requester.first} ${requester.last}`, requester.email]) {
      expect(await requestIds(s.itAdmin, q), `searching "${q}"`).toContain(requestId);
    }
  });

  it('still finds by request number and item, as before', async () => {
    const detail = await api(app).get(`/api/v1/requests/${requestId}`).set(auth(s.itAdmin));
    expect(await requestIds(s.itAdmin, detail.body.data.requestNumber)).toContain(requestId);
    expect(await requestIds(s.itAdmin, `Probe item ${tag}`)).toContain(requestId);
  });

  it('stays inside the searcher’s scope', async () => {
    expect(await requestIds(s.employee2, requester.first)).not.toContain(requestId);
  });
});

describe('finding the person themselves', () => {
  it('by full name, which used to match nobody', async () => {
    const res = await api(app)
      .get(
        `/api/v1/users?q=${encodeURIComponent(`${holder.first} ${holder.last}`)}&pageSize=50&audience=all`,
      )
      .set(auth(s.itAdmin));
    expect(res.status).toBe(200);
    expect((res.body.data as { id: string }[]).map((u) => u.id)).toContain(s.employee2.user.id);
  });
});
