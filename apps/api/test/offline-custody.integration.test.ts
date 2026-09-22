import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Phase 6 (v2.82): handovers, returns and stock counts recorded with no
 * signal, applied when the phone syncs.
 *
 * What must hold:
 * - a retried upload never applies twice;
 * - somebody else's change in between is a CONFLICT, never overwritten;
 * - a change someone already made is DONE, not an error;
 * - every rule of the online screen still applies, including permissions.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
const tag = `OFFL-${Date.now().toString(36)}`;
let assetId: string;

const sync = (as: Session, operations: object[], sessionId?: string) =>
  api(app)
    .post('/api/v1/mobile/sync')
    .set(auth(as))
    .send({ operations, ...(sessionId ? { sessionId } : {}) });

const op = (
  type: string,
  entityId: string | null,
  payload: object,
  capturedAt = new Date().toISOString(),
) => ({
  clientGeneratedId: ulid(),
  type,
  entityId,
  capturedAt,
  payload,
});

const holderOf = async (id: string) =>
  (await prisma.client.asset.findUniqueOrThrow({ where: { id }, select: { assignedUserId: true } }))
    .assignedUserId;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  const itCategory = categories.body.data.find((c: { key: string }) => c.key === 'it-assets');
  const created = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.itAdmin))
    .send({
      assetTag: tag,
      name: `Offline probe ${tag}`,
      categoryId: itCategory.id,
      serialNumber: `SN-${tag}`,
      status: 'AVAILABLE',
    });
  expect(created.status, JSON.stringify(created.body).slice(0, 200)).toBe(201);
  assetId = created.body.data.id;
});

afterAll(async () => {
  await prisma?.client.$executeRawUnsafe(`DELETE FROM assets WHERE "assetTag" = $1`, tag);
  await app?.close();
});

describe('a handover recorded offline', () => {
  const handover = op(
    'ASSET_ASSIGN',
    null,
    { userId: '', conditionOut: 'GOOD', seenHolderId: null },
    new Date(Date.now() - 20 * 60_000).toISOString(),
  );

  it('applies once, through the ordinary handover, noting it was recorded offline', async () => {
    Object.assign(handover, {
      entityId: assetId,
      payload: { ...handover.payload, userId: s.employee2.user.id },
    });
    const res = await sync(s.itAdmin, [handover]);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.data.results[0]).toMatchObject({ outcome: 'APPLIED' });
    expect(await holderOf(assetId)).toBe(s.employee2.user.id);
    const open = await prisma.client.assetAssignment.findMany({
      where: { assetId, returnedAt: null },
    });
    expect(open).toHaveLength(1);
    expect(open[0]!.notes).toMatch(/Recorded offline on the phone at/);
  });

  it('a retried upload is a duplicate: still exactly one handover', async () => {
    const res = await sync(s.itAdmin, [handover]);
    expect(res.body.data.results[0].outcome).toBe('DUPLICATE');
    expect(
      await prisma.client.assetAssignment.count({ where: { assetId, returnedAt: null } }),
    ).toBe(1);
  });

  it('a second phone recording the same handover finds it already done', async () => {
    const same = op('ASSET_ASSIGN', assetId, {
      userId: s.employee2.user.id,
      conditionOut: 'GOOD',
      seenHolderId: null,
    });
    const res = await sync(s.itAdmin, [same]);
    expect(res.body.data.results[0].outcome).toBe('DUPLICATE');
    expect(res.body.data.results[0].message).toMatch(/Already with/);
  });
});

describe('a return recorded offline', () => {
  it('is a conflict when someone else holds it now, and says who', async () => {
    const stale = op('ASSET_RETURN', assetId, {
      conditionIn: 'GOOD',
      resultingStatus: 'AVAILABLE',
      seenHolderId: s.employee.user.id,
    });
    const res = await sync(s.itAdmin, [stale]);
    expect(res.body.data.results[0].outcome).toBe('CONFLICT');
    expect(res.body.data.results[0].message).toMatch(/now held by/);
    expect(await holderOf(assetId)).toBe(s.employee2.user.id);
  });

  it('applies when the holder is who the phone saw, then a second return is already done', async () => {
    const ret = () =>
      op('ASSET_RETURN', assetId, {
        conditionIn: 'GOOD',
        resultingStatus: 'AVAILABLE',
        seenHolderId: s.employee2.user.id,
      });
    const first = await sync(s.itAdmin, [ret()]);
    expect(first.body.data.results[0].outcome).toBe('APPLIED');
    expect(await holderOf(assetId)).toBeNull();
    const again = await sync(s.itAdmin, [ret()]);
    expect(again.body.data.results[0]).toMatchObject({
      outcome: 'DUPLICATE',
      message: 'Already returned by someone else.',
    });
  });

  it('a handover recorded before someone else returned it is a conflict, not a silent re-issue', async () => {
    const res = await sync(s.itAdmin, [
      op('ASSET_REASSIGN', assetId, {
        userId: s.employee.user.id,
        conditionIn: 'GOOD',
        seenHolderId: s.employee2.user.id,
      }),
    ]);
    expect(res.body.data.results[0].outcome).toBe('CONFLICT');
    expect(await holderOf(assetId)).toBeNull();
  });
});

describe('who may sync what', () => {
  it('an employee cannot sync custody changes at all', async () => {
    const res = await sync(s.employee, [
      op('ASSET_ASSIGN', assetId, {
        userId: s.employee.user.id,
        conditionOut: 'GOOD',
        seenHolderId: null,
      }),
    ]);
    expect(res.status).toBe(403);
    expect(await holderOf(assetId)).toBeNull();
  });

  it('a malformed payload is rejected with a reason, not applied', async () => {
    const res = await sync(s.itAdmin, [op('ASSET_ASSIGN', assetId, { seenHolderId: null })]);
    expect(res.body.data.results[0].outcome).toBe('REJECTED');
    expect(res.body.data.results[0].message).toMatch(/older version of the app/);
  });
});

describe('a stock count recorded offline', () => {
  it('applies when nothing moved, and is a conflict when stock moved since', async () => {
    const level = await prisma.client.stockLevel.findFirst({
      where: { companyId: s.superAdmin.user.companyId },
      orderBy: { updatedAt: 'desc' },
      select: { inventoryItemId: true, stockLocationId: true, quantity: true },
    });
    expect(level, 'the seed has at least one stock level').toBeTruthy();
    const where = {
      inventoryItemId: level!.inventoryItemId,
      stockLocationId: level!.stockLocationId,
    };
    const before = Number(level!.quantity);

    const count = await sync(s.superAdmin, [
      op('STOCK_COUNT', null, { ...where, seenQuantity: before, countedQuantity: before + 2 }),
    ]);
    expect(count.body.data.results[0].outcome, JSON.stringify(count.body.data.results[0])).toBe(
      'APPLIED',
    );
    const after = await prisma.client.stockLevel.findFirstOrThrow({
      where,
      select: { quantity: true },
    });
    expect(Number(after.quantity)).toBe(before + 2);

    // A count taken against the old figure now finds stock has moved.
    const stale = await sync(s.superAdmin, [
      op('STOCK_COUNT', null, { ...where, seenQuantity: before, countedQuantity: before + 5 }),
    ]);
    expect(stale.body.data.results[0].outcome).toBe('CONFLICT');
    expect(stale.body.data.results[0].message).toMatch(/Count again/);

    // Put it back.
    const reset = await sync(s.superAdmin, [
      op('STOCK_COUNT', null, { ...where, seenQuantity: before + 2, countedQuantity: before }),
    ]);
    expect(reset.body.data.results[0].outcome).toBe('APPLIED');
  });
});

describe('stock-take scans flushed from anywhere', () => {
  it('find their stock-take from the scan itself', async () => {
    const session = await api(app)
      .post('/api/v1/mobile/inventory/sessions')
      .set(auth(s.itAdmin))
      .send({ name: `Offline scan ${tag}` });
    expect(session.status).toBe(201);
    const res = await sync(s.itAdmin, [
      op('INVENTORY_SCAN', null, { scannedCode: `NOPE-${tag}`, sessionId: session.body.data.id }),
    ]);
    expect(res.body.data.results[0].outcome).toBe('APPLIED');
  });
});
