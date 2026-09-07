import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Quality check on receiving (v2.42).
 *
 * The step that was missing between "a box arrived" and "the laptop is usable".
 * Before this, ASSET intake created assets in RECEIVED and nothing ever moved
 * them on, so somebody edited each one by hand.
 *
 * The tests that matter here are the ones about not losing count: an inspection
 * whose numbers do not add up to what arrived is worse than no inspection,
 * because it looks authoritative.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let vendorId: string;
let itemId: string;
let categoryId: string;
let companyId: string;
let stockLocationId: string;

const base = '/api/v1/procurement';

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;

  const [vendor, item, category, location] = await Promise.all([
    prisma.client.vendor.findFirst({ where: { companyId, deletedAt: null }, select: { id: true } }),
    prisma.client.inventoryItem.findFirst({ where: { companyId, deletedAt: null }, select: { id: true } }),
    prisma.client.category.findFirst({ where: { companyId, deletedAt: null }, select: { id: true } }),
    prisma.client.stockLocation.findFirst({ where: { companyId, deletedAt: null }, select: { id: true } }),
  ]);
  vendorId = vendor!.id;
  itemId = item!.id;
  categoryId = category!.id;
  stockLocationId = location!.id;
});

afterAll(async () => {
  await prisma.client.asset.deleteMany({ where: { companyId, sourceGrnLineId: { not: null } } });
  await app?.close();
});

/** An issued PO ready to receive against. */
async function issuedPo(quantity: number) {
  const pr = await api(app)
    .post(`${base}/requests`)
    .set(auth(s.employee))
    .send({
      justification: 'Integration probe: quality check on what arrived.',
      lines: [{ description: 'USB-C dock', quantity, estimatedUnitPrice: '40.00', inventoryItemId: itemId }],
    });
  await api(app).post(`${base}/requests/${pr.body.data.id}/submit`).set(auth(s.employee));
  await api(app)
    .post(`${base}/requests/${pr.body.data.id}/decision`)
    .set(auth(s.finance))
    .send({ decision: 'APPROVE' });
  const converted = await api(app)
    .post(`${base}/requests/${pr.body.data.id}/convert`)
    .set(auth(s.superAdmin))
    .send({ vendorId });
  const poId = converted.body.data.purchaseOrderId as string;
  await api(app).post(`${base}/orders/${poId}/issue`).set(auth(s.superAdmin));
  const po = await api(app).get(`${base}/orders/${poId}`).set(auth(s.superAdmin));
  return { poId, lineId: po.body.data.lines[0].id as string };
}

/** Receive `quantity` as assets and hand back the receipt line and its assets. */
async function receivedAssets(quantity: number) {
  const { poId, lineId } = await issuedPo(quantity);
  const res = await api(app)
    .post(`${base}/orders/${poId}/receive`)
    .set(auth(s.superAdmin))
    .send({ lines: [{ purchaseOrderLineId: lineId, quantity, intake: 'ASSET', categoryId }] });
  expect(res.status, JSON.stringify(res.body)).toBe(201);

  const grnLine = await prisma.client.goodsReceiptLine.findFirstOrThrow({
    where: { purchaseOrderLineId: lineId },
    select: { id: true, goodsReceiptId: true, assets: { select: { id: true, status: true } } },
  });
  return grnLine;
}

const check = (lineId: string, body: unknown, as: Session = s.superAdmin) =>
  api(app).post(`${base}/receipt-lines/${lineId}/quality-check`).set(auth(as)).send(body);

describe('inspecting assets', () => {
  it('a clean pass makes the received assets available', async () => {
    const line = await receivedAssets(2);
    // They arrive in the building, not in service.
    expect(line.assets.every((a) => a.status === 'RECEIVED')).toBe(true);

    const res = await check(line.id, { quantityAccepted: 2, quantityRejected: 0 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.outcome).toBe('PASSED');
    expect(res.body.data.assetsMadeAvailable).toBe(2);

    const after = await prisma.client.asset.findMany({
      where: { id: { in: line.assets.map((a) => a.id) } },
      select: { status: true },
    });
    expect(after.every((a) => a.status === 'AVAILABLE')).toBe(true);
  });

  it('holds back only the units named, and passes the rest', async () => {
    const line = await receivedAssets(3);
    const [bad, ...good] = line.assets;

    const res = await check(line.id, {
      quantityAccepted: 2,
      quantityRejected: 1,
      rejectionReason: 'Screen cracked in transit',
      disposition: 'HOLD_DAMAGED',
      rejectedAssetIds: [bad!.id],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.outcome).toBe('PARTIAL');

    const rejected = await prisma.client.asset.findUniqueOrThrow({ where: { id: bad!.id } });
    expect(rejected.status).toBe('DAMAGED');
    const rest = await prisma.client.asset.findMany({
      where: { id: { in: good.map((a) => a.id) } },
      select: { status: true },
    });
    expect(rest.every((a) => a.status === 'AVAILABLE')).toBe(true);
  });

  it('sends a returned unit out of the estate rather than marking it damaged', async () => {
    const line = await receivedAssets(1);
    const res = await check(line.id, {
      quantityAccepted: 0,
      quantityRejected: 1,
      rejectionReason: 'Wrong model shipped',
      disposition: 'RETURN_TO_VENDOR',
      rejectedAssetIds: [line.assets[0]!.id],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.outcome).toBe('FAILED');

    const asset = await prisma.client.asset.findUniqueOrThrow({ where: { id: line.assets[0]!.id } });
    expect(asset.status).toBe('RETIRED');
  });

  it('refuses counts that do not add up to what arrived', async () => {
    const line = await receivedAssets(3);
    const res = await check(line.id, {
      quantityAccepted: 1,
      quantityRejected: 1,
      rejectionReason: 'One was dented',
      disposition: 'HOLD_DAMAGED',
      rejectedAssetIds: [line.assets[0]!.id],
    });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('add up');
  });

  it('refuses a rejection with no reason', async () => {
    const line = await receivedAssets(2);
    const res = await check(line.id, {
      quantityAccepted: 1,
      quantityRejected: 1,
      disposition: 'HOLD_DAMAGED',
      rejectedAssetIds: [line.assets[0]!.id],
    });
    expect(res.status).toBe(422);
  });

  it('refuses a rejection with nowhere for the units to go', async () => {
    const line = await receivedAssets(2);
    const res = await check(line.id, {
      quantityAccepted: 1,
      quantityRejected: 1,
      rejectionReason: 'Dented',
      rejectedAssetIds: [line.assets[0]!.id],
    });
    expect(res.status).toBe(422);
  });

  it('refuses a rejected count that does not match the units named', async () => {
    const line = await receivedAssets(3);
    const res = await check(line.id, {
      quantityAccepted: 1,
      quantityRejected: 2,
      rejectionReason: 'Two were dented',
      disposition: 'HOLD_DAMAGED',
      rejectedAssetIds: [line.assets[0]!.id],
    });
    expect(res.status).toBe(422);
    expect(res.body.detail).toContain('Name each unit');
  });

  it('refuses to condemn a unit from a different receipt', async () => {
    const [a, b] = await Promise.all([receivedAssets(1), receivedAssets(1)]);
    const res = await check(a.id, {
      quantityAccepted: 0,
      quantityRejected: 1,
      rejectionReason: 'Faulty',
      disposition: 'HOLD_DAMAGED',
      rejectedAssetIds: [b.assets[0]!.id],
    });
    expect(res.status).toBe(422);

    // The stranger is untouched: it was never part of this inspection.
    const untouched = await prisma.client.asset.findUniqueOrThrow({ where: { id: b.assets[0]!.id } });
    expect(untouched.status).toBe('RECEIVED');
  });

  it('will not inspect the same line twice by accident', async () => {
    const line = await receivedAssets(1);
    expect((await check(line.id, { quantityAccepted: 1, quantityRejected: 0 })).status).toBe(201);
    const again = await check(line.id, { quantityAccepted: 1, quantityRejected: 0 });
    expect(again.status).toBe(409);
  });

  it('does not drag an asset backwards if somebody already moved it on', async () => {
    const line = await receivedAssets(2);
    // Assigned before anyone got round to inspecting the delivery.
    await prisma.client.asset.update({
      where: { id: line.assets[0]!.id },
      data: { status: 'IN_STORAGE' },
    });

    const res = await check(line.id, { quantityAccepted: 2, quantityRejected: 0 });
    expect(res.status).toBe(201);

    const moved = await prisma.client.asset.findUniqueOrThrow({ where: { id: line.assets[0]!.id } });
    expect(moved.status).toBe('IN_STORAGE');
  });
});

describe('inspecting stock', () => {
  it('takes rejected stock back off the shelf', async () => {
    const { poId, lineId } = await issuedPo(10);
    const before = await prisma.client.stockLevel.findUnique({
      where: { inventoryItemId_stockLocationId: { inventoryItemId: itemId, stockLocationId } },
      select: { quantity: true },
    });
    const beforeQty = Number(before?.quantity ?? 0);

    await api(app)
      .post(`${base}/orders/${poId}/receive`)
      .set(auth(s.superAdmin))
      .send({
        lines: [
          { purchaseOrderLineId: lineId, quantity: 10, intake: 'STOCK', stockLocationId, inventoryItemId: itemId },
        ],
      });

    const received = await prisma.client.stockLevel.findUniqueOrThrow({
      where: { inventoryItemId_stockLocationId: { inventoryItemId: itemId, stockLocationId } },
      select: { quantity: true },
    });
    expect(Number(received.quantity)).toBe(beforeQty + 10);

    const grnLine = await prisma.client.goodsReceiptLine.findFirstOrThrow({
      where: { purchaseOrderLineId: lineId },
      select: { id: true },
    });
    const res = await check(grnLine.id, {
      quantityAccepted: 7,
      quantityRejected: 3,
      rejectionReason: 'Three boxes water damaged',
      disposition: 'RETURN_TO_VENDOR',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    // The three going back to the supplier must not be counted as on hand.
    const after = await prisma.client.stockLevel.findUniqueOrThrow({
      where: { inventoryItemId_stockLocationId: { inventoryItemId: itemId, stockLocationId } },
      select: { quantity: true },
    });
    expect(Number(after.quantity)).toBe(beforeQty + 7);

    const movement = await prisma.client.stockMovement.findFirst({
      where: { refType: 'QualityCheck', refId: res.body.data.id },
      select: { type: true, quantity: true },
    });
    expect(movement?.type).toBe('ADJUST_DOWN');
    expect(Number(movement?.quantity)).toBe(3);
  });
});

describe('who may inspect', () => {
  it('refuses an employee', async () => {
    const line = await receivedAssets(1);
    const res = await check(line.id, { quantityAccepted: 1, quantityRejected: 0 }, s.employee);
    expect(res.status).toBe(403);
  });

  it('gives an inspector the whole receipt in one call', async () => {
    // Three calls to assemble this on a loading dock is three chances to be
    // holding a stale answer.
    const line = await receivedAssets(2);
    const res = await api(app)
      .get(`${base}/receipts/${line.goodsReceiptId}`)
      .set(auth(s.superAdmin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const found = res.body.data.lines.find((l: { id: string }) => l.id === line.id);
    expect(found.intake).toBe('ASSET');
    expect(found.assets).toHaveLength(2);
    expect(found.qualityCheck).toBeNull();
    expect(res.body.data.purchaseOrder.poNumber).toBeTruthy();
  });

  it('does not show a receipt to an employee', async () => {
    const line = await receivedAssets(1);
    const res = await api(app)
      .get(`${base}/receipts/${line.goodsReceiptId}`)
      .set(auth(s.employee));
    expect(res.status).toBe(403);
  });

  it('shows the inspections recorded against a receipt', async () => {
    const line = await receivedAssets(1);
    await check(line.id, { quantityAccepted: 1, quantityRejected: 0 });
    const res = await api(app)
      .get(`${base}/receipts/${line.goodsReceiptId}/quality-checks`)
      .set(auth(s.superAdmin));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].inspectedBy.id).toBe(s.superAdmin.user.id);
  });
});
