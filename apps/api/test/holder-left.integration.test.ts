import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v3.15 - equipment still out with people who have left.
 *
 * The owner saw a deactivated person's name on the asset list and asked for
 * it to go. The name is there because a laptop is still recorded against
 * them, so hiding it would hide the laptop. Instead: a deactivated holder is
 * marked wherever named, never offered in a picker, and the list has a
 * one-click filter for exactly these assets.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let companyId: string;

const stamp = Date.now().toString(36);
const LEFT_TAG = `HL-LEFT-${stamp}`;
const STAYED_TAG = `HL-STAYED-${stamp}`;
let leftUserId: string;
let leftEmail: string;
let leftAssetId: string;
let stayedAssetId: string;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.itAdmin.user.companyId;

  leftEmail = `left-${stamp}@example.com`;
  const left = await prisma.client.user.create({
    data: {
      companyId,
      email: leftEmail,
      status: 'DEACTIVATED',
      emailVerifiedAt: new Date(),
      profile: { create: { firstName: 'Gone', lastName: `Person ${stamp}` } },
    },
    select: { id: true },
  });
  leftUserId = left.id;

  // Types hang off categories, which is where the company lives.
  const laptop = await prisma.client.subcategory.findFirst({
    where: { key: 'laptop', category: { companyId } },
    select: { id: true, categoryId: true },
  });
  const category = laptop
    ? { id: laptop.categoryId }
    : await prisma.client.category.findFirstOrThrow({ where: { companyId }, select: { id: true } });

  const make = (assetTag: string, userId: string) =>
    prisma.client.asset.create({
      data: {
        companyId,
        assetTag,
        name: `Holder filter ${assetTag}`,
        categoryId: category.id,
        subcategoryId: laptop?.id ?? null,
        serialNumber: `SN-${assetTag}`,
        status: 'IN_USE',
        condition: 'GOOD',
        qrToken: `qr-${assetTag}`,
        assignedUserId: userId,
      },
      select: { id: true },
    });
  leftAssetId = (await make(LEFT_TAG, leftUserId)).id;
  stayedAssetId = (await make(STAYED_TAG, s.itAdmin.user.id)).id;
});

afterAll(async () => {
  await prisma?.client.asset.deleteMany({ where: { assetTag: { in: [LEFT_TAG, STAYED_TAG] } } });
  if (leftUserId) await prisma?.client.user.delete({ where: { id: leftUserId } });
  await app?.close();
});

const list = async (session: Session, query: string) => {
  const res = await api(app).get(`/api/v1/assets?pageSize=100&${query}`).set(auth(session));
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  return res.body.data as Array<{ id: string; assignedUser: { status?: string } | null }>;
};

describe('the "held by people who left" filter', () => {
  it('returns the equipment still out with deactivated people, and nothing else', async () => {
    const rows = await list(s.itAdmin, 'holder=left');
    expect(rows.map((r) => r.id)).toContain(leftAssetId);
    expect(rows.map((r) => r.id)).not.toContain(stayedAssetId);
    for (const r of rows) expect(r.assignedUser?.status).toBe('DEACTIVATED');
  });

  it('still names the holder - the row marks them, it does not blank them', async () => {
    const rows = await list(s.itAdmin, 'holder=left');
    const row = rows.find((r) => r.id === leftAssetId)!;
    expect(row.assignedUser).toMatchObject({
      status: 'DEACTIVATED',
      profile: { firstName: 'Gone' },
    });
  });

  it('is ANDed with the other filters, like every filter on the list', async () => {
    const rows = await list(s.itAdmin, `holder=left&assignedUserId=${s.itAdmin.user.id}`);
    expect(rows).toEqual([]);
  });

  it('refuses a value it does not know rather than ignoring the filter', async () => {
    const res = await api(app).get('/api/v1/assets?holder=gone').set(auth(s.itAdmin));
    expect(res.status).toBe(422);
  });

  it('never widens what an employee may see', async () => {
    const rows = await list(s.employee, 'holder=left');
    expect(rows.map((r) => r.id)).not.toContain(leftAssetId);
  });
});

describe('a holder who has left, elsewhere', () => {
  it('is marked on the Discovery rollout list, where their laptop still has no agent', async () => {
    const res = await api(app).get('/api/v1/discovery/agents/not-enrolled').set(auth(s.itAdmin));
    expect(res.status).toBe(200);
    const rows = res.body.data.rows as Array<{
      id: string;
      holder: string | null;
      holderLeft?: boolean;
    }>;
    const left = rows.find((r) => r.id === leftAssetId);
    const stayed = rows.find((r) => r.id === stayedAssetId);
    // Only laptops are listed; a company without a laptop type lists neither.
    if (left) {
      expect(left.holder).toContain('Gone');
      expect(left.holderLeft).toBe(true);
    }
    if (stayed) expect(stayed.holderLeft).toBe(false);
  });

  it('is offered by no people picker', async () => {
    const res = await api(app)
      .get(`/api/v1/users?pageSize=100&q=${encodeURIComponent(`Person ${stamp}`)}`)
      .set(auth(s.itAdmin));
    expect(res.status).toBe(200);
    expect((res.body.data as Array<{ id: string }>).map((u) => u.id)).not.toContain(leftUserId);
  });
});
