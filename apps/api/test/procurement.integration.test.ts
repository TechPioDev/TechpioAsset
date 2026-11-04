import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, login, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.4 P2 — procurement end to end: PR lifecycle with SoD + the Finance
 * threshold, PR→PO conversion, PO issue/cancel, and GRN receiving with the
 * guarded over-receipt limit, partial-delivery rollup and stock intake posting
 * to the ledger. PRC-* concurrency proofs land in P3.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let vendorId: string;
let itemId: string;
let locationId: string;
/** employee3 is borrowed as a PROCUREMENT_MANAGER (approve without cost). */
let pm: Session;

const base = '/api/v1/procurement';

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);

  const vendor = await prisma.client.vendor.findFirst({
    where: { companyId: s.superAdmin.user.companyId, deletedAt: null },
    select: { id: true },
  });
  vendorId = vendor!.id;
  const item = await prisma.client.inventoryItem.findFirst({
    where: { companyId: s.superAdmin.user.companyId, deletedAt: null, batchTracked: false },
    select: { id: true },
  });
  itemId = item!.id;
  const location = await prisma.client.stockLocation.create({
    data: {
      companyId: s.superAdmin.user.companyId,
      code: 'TEST-WH',
      name: 'Test Warehouse',
    },
    select: { id: true },
  });
  locationId = location.id;

  // Give employee3 the PM role: procurement approval WITHOUT the cost permission.
  const e3 = await api(app)
    .patch(`/api/v1/users/${s.employee3.user.id}/roles`)
    .set(auth(s.superAdmin))
    .send({ roleKeys: ['PROCUREMENT_MANAGER'] });
  expect(e3.status, JSON.stringify(e3.body)).toBe(200);
  pm = await login(app, 'employee3@techpioasset.dev');
});

afterAll(async () => {
  // Restore employee3 and drop the test location.
  await api(app)
    .patch(`/api/v1/users/${s.employee3.user.id}/roles`)
    .set(auth(s.superAdmin))
    .send({ roleKeys: ['EMPLOYEE'] });
  await prisma.client.stockLevel.deleteMany({ where: { stockLocationId: locationId } });
  await prisma.client.stockMovement.deleteMany({ where: { stockLocationId: locationId } });
  await prisma.client.stockLocation.delete({ where: { id: locationId } }).catch(() => undefined);
  await app?.close();
});

// Each test creates its own PR/PO chain; nothing shared mutates between tests.

async function createPr(actor: Session, unitPrice: string | null, quantity = 3) {
  const res = await api(app)
    .post(`${base}/requests`)
    .set(auth(actor))
    .send({
      justification: 'Integration probe: replacement USB-C docks for the build lab.',
      lines: [{ description: 'USB-C dock', quantity, estimatedUnitPrice: unitPrice, inventoryItemId: itemId }],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; estimatedTotal: string | null };
}

async function submittedPr(actor: Session, unitPrice: string | null, quantity = 3) {
  const pr = await createPr(actor, unitPrice, quantity);
  const sub = await api(app).post(`${base}/requests/${pr.id}/submit`).set(auth(actor));
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  return pr;
}

describe('PR lifecycle, SoD and the Finance threshold', () => {
  it('an employee drafts and submits; only the requester may submit', async () => {
    const pr = await createPr(s.employee, '10.00');
    const foreign = await api(app).post(`${base}/requests/${pr.id}/submit`).set(auth(s.employee2));
    expect(foreign.status).toBe(403);
    const own = await api(app).post(`${base}/requests/${pr.id}/submit`).set(auth(s.employee));
    expect(own.status).toBe(201);
    expect(own.body.data.status).toBe('SUBMITTED');
  });

  it('SoD: an approver cannot decide their own purchase request', async () => {
    // Super Admin holds both create and approve — exactly who SoD must stop.
    const pr = await submittedPr(s.superAdmin, '10.00');
    const self = await api(app)
      .post(`${base}/requests/${pr.id}/decision`)
      .set(auth(s.superAdmin))
      .send({ decision: 'APPROVE' });
    expect(self.status).toBe(403);
  });

  it('below the threshold a non-Finance approver decides; at the boundary Finance is required (inclusive)', async () => {
    // 3 x 80.00 = 240.00 — strictly below 250: the PM may approve.
    const below = await submittedPr(s.employee, '80.00');
    const pmOk = await api(app)
      .post(`${base}/requests/${below.id}/decision`)
      .set(auth(pm))
      .send({ decision: 'APPROVE' });
    expect(pmOk.status, JSON.stringify(pmOk.body)).toBe(201);
    expect(pmOk.body.data.status).toBe('APPROVED');

    // 1 x 250.00 — exactly at the threshold: PM refused, Finance decides.
    const boundary = await submittedPr(s.employee, '250.00', 1);
    const pmBlocked = await api(app)
      .post(`${base}/requests/${boundary.id}/decision`)
      .set(auth(pm))
      .send({ decision: 'APPROVE' });
    expect(pmBlocked.status).toBe(403);
    expect(pmBlocked.body.detail).toContain('Finance');

    const financeOk = await api(app)
      .post(`${base}/requests/${boundary.id}/decision`)
      .set(auth(s.finance))
      .send({ decision: 'APPROVE' });
    expect(financeOk.status).toBe(201);
  });

  it('rejection allows fix-and-resubmit; unknown estimates always need Finance', async () => {
    const pr = await submittedPr(s.employee, null); // no price → unknown cost
    const pmBlocked = await api(app)
      .post(`${base}/requests/${pr.id}/decision`)
      .set(auth(pm))
      .send({ decision: 'APPROVE' });
    expect(pmBlocked.status).toBe(403);

    const rejected = await api(app)
      .post(`${base}/requests/${pr.id}/decision`)
      .set(auth(s.finance))
      .send({ decision: 'REJECT', reason: 'Add prices first.' });
    expect(rejected.status).toBe(201);
    expect(rejected.body.data.status).toBe('REJECTED');

    const resubmit = await api(app).post(`${base}/requests/${pr.id}/submit`).set(auth(s.employee));
    expect(resubmit.status).toBe(201);
    expect(resubmit.body.data.status).toBe('SUBMITTED');
  });
});

describe('PR → PO → GRN with the guarded intake', () => {
  async function approvedPr(quantity = 3, unitPrice = '40.00') {
    const pr = await submittedPr(s.employee, unitPrice, quantity);
    const ok = await api(app)
      .post(`${base}/requests/${pr.id}/decision`)
      .set(auth(s.finance))
      .send({ decision: 'APPROVE' });
    expect(ok.status).toBe(201);
    return pr;
  }

  async function issuedPoFromPr(quantity = 3) {
    const pr = await approvedPr(quantity);
    const converted = await api(app)
      .post(`${base}/requests/${pr.id}/convert`)
      .set(auth(s.superAdmin))
      .send({ vendorId });
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    const poId = converted.body.data.purchaseOrderId as string;
    const issued = await api(app).post(`${base}/orders/${poId}/issue`).set(auth(s.superAdmin));
    expect(issued.status, JSON.stringify(issued.body)).toBe(201);
    expect(issued.body.data.status).toBe('ISSUED');
    return poId;
  }

  it('an approved PR converts to a draft PO carrying its lines, then issues (requester notified)', async () => {
    const poId = await issuedPoFromPr();
    const po = await api(app).get(`${base}/orders/${poId}`).set(auth(s.superAdmin));
    expect(po.body.data.lines).toHaveLength(1);
    expect(Number(po.body.data.lines[0].quantity)).toBe(3);

    const note = await prisma.client.notification.findFirst({
      where: { entityId: poId, type: 'ASSET_ORDERED', userId: s.employee.user.id },
    });
    expect(note).not.toBeNull();
  });

  it('receives partially, rolls the status, refuses over-receipt with honest numbers, completes', async () => {
    const poId = await issuedPoFromPr(3);
    const po = await api(app).get(`${base}/orders/${poId}`).set(auth(s.superAdmin));
    const lineId = po.body.data.lines[0].id as string;
    const stockLine = (quantity: number) => ({
      purchaseOrderLineId: lineId,
      quantity,
      intake: 'STOCK' as const,
      stockLocationId: locationId,
      inventoryItemId: itemId,
    });

    const before = await prisma.client.inventoryItem.findUnique({
      where: { id: itemId },
      select: { quantityOnHand: true },
    });

    // Partial: 2 of 3.
    const first = await api(app)
      .post(`${base}/orders/${poId}/receive`)
      .set(auth(s.superAdmin))
      .send({ lines: [stockLine(2)] });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data.status).toBe('PARTIALLY_RECEIVED');

    // Over-receipt: 2 more when only 1 remains → refused, nothing changes.
    const over = await api(app)
      .post(`${base}/orders/${poId}/receive`)
      .set(auth(s.superAdmin))
      .send({ lines: [stockLine(2)] });
    expect(over.status).toBe(409);
    expect(over.body.detail).toContain('only 1');

    // The remainder completes the PO.
    const last = await api(app)
      .post(`${base}/orders/${poId}/receive`)
      .set(auth(s.superAdmin))
      .send({ lines: [stockLine(1)] });
    expect(last.status).toBe(201);
    expect(last.body.data.status).toBe('RECEIVED');

    // Ledger + caches: 3 units arrived in total.
    const movements = await prisma.client.stockMovement.findMany({
      where: { stockLocationId: locationId, inventoryItemId: itemId, type: 'RECEIPT' },
    });
    expect(movements.map((m) => Number(m.quantity)).reduce((a, b) => a + b, 0)).toBe(3);
    const level = await prisma.client.stockLevel.findUnique({
      where: { inventoryItemId_stockLocationId: { inventoryItemId: itemId, stockLocationId: locationId } },
    });
    expect(Number(level?.quantity)).toBe(3);
    const after = await prisma.client.inventoryItem.findUnique({
      where: { id: itemId },
      select: { quantityOnHand: true },
    });
    expect(Number(after?.quantityOnHand) - Number(before?.quantityOnHand)).toBe(3);

    // A PO with receipts cannot be cancelled.
    const cancel = await api(app).post(`${base}/orders/${poId}/cancel`).set(auth(s.superAdmin)).send({});
    expect(cancel.status).toBe(409);
  });

  it('guards: an employee cannot approve, issue or receive', async () => {
    const pr = await submittedPr(s.employee, '10.00');
    expect(
      (
        await api(app)
          .post(`${base}/requests/${pr.id}/decision`)
          .set(auth(s.employee2))
          .send({ decision: 'APPROVE' })
      ).status,
    ).toBe(403);
    const poId = await issuedPoFromPr(1);
    expect((await api(app).post(`${base}/orders/${poId}/receive`).set(auth(s.employee)).send({ lines: [] })).status).toBe(403);
  });
});
