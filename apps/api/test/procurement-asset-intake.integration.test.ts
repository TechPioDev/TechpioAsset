import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.9 C1 — receiving a laptop creates the laptop.
 *
 * Until this release an ASSET-intake receipt line was recorded and then
 * skipped, so every delivery was re-typed into the asset register by hand. The
 * invariant that makes automation safe is idempotency: the receipt line plus
 * the unit's position within it is the asset's identity, enforced by a unique
 * index rather than by remembering to check.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let vendorId: string;
let itemId: string;
let categoryId: string;
let companyId: string;

const base = '/api/v1/procurement';

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;

  const [vendor, item, category] = await Promise.all([
    prisma.client.vendor.findFirst({ where: { companyId, deletedAt: null }, select: { id: true } }),
    prisma.client.inventoryItem.findFirst({ where: { companyId, deletedAt: null }, select: { id: true } }),
    prisma.client.category.findFirst({ where: { companyId, deletedAt: null }, select: { id: true } }),
  ]);
  vendorId = vendor!.id;
  itemId = item!.id;
  categoryId = category!.id;
});

afterAll(async () => {
  // Leave the seeded tenant as we found it: every asset this suite created is
  // identifiable by the column that gave it its identity.
  await prisma.client.asset.deleteMany({ where: { companyId, sourceGrnLineId: { not: null } } });
  await app?.close();
});

/** An issued PO for `quantity` docks at `unitPrice`, ready to receive against. */
async function issuedPo(quantity: number, unitPrice = '40.00') {
  const pr = await api(app)
    .post(`${base}/requests`)
    .set(auth(s.employee))
    .send({
      justification: 'Integration probe: asset intake creates the things themselves.',
      lines: [{ description: 'USB-C dock', quantity, estimatedUnitPrice: unitPrice, inventoryItemId: itemId }],
    });
  expect(pr.status, JSON.stringify(pr.body)).toBe(201);
  const submitted = await api(app).post(`${base}/requests/${pr.body.data.id}/submit`).set(auth(s.employee));
  expect(submitted.status).toBe(201);
  const decided = await api(app)
    .post(`${base}/requests/${pr.body.data.id}/decision`)
    .set(auth(s.finance))
    .send({ decision: 'APPROVE' });
  expect(decided.status, JSON.stringify(decided.body)).toBe(201);
  const converted = await api(app)
    .post(`${base}/requests/${pr.body.data.id}/convert`)
    .set(auth(s.superAdmin))
    .send({ vendorId });
  expect(converted.status, JSON.stringify(converted.body)).toBe(201);
  const poId = converted.body.data.purchaseOrderId as string;
  const issued = await api(app).post(`${base}/orders/${poId}/issue`).set(auth(s.superAdmin));
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);
  const po = await api(app).get(`${base}/orders/${poId}`).set(auth(s.superAdmin));
  return { poId, lineId: po.body.data.lines[0].id as string, poNumber: po.body.data.poNumber as string };
}

const receive = (poId: string, body: unknown) =>
  api(app).post(`${base}/orders/${poId}/receive`).set(auth(s.superAdmin)).send(body);

describe('a received unit knows the listing it came from (v2.47)', () => {
  it('carries the selected product onto every asset the receipt creates', async () => {
    // The chain the catalogue exists to serve: vendor -> listing -> selection
    // -> order line -> physical unit. Before this the order line described what
    // was bought in free text and the trail stopped there.
    const offer = await prisma.client.vendorProduct.create({
      data: {
        companyId,
        vendorId,
        name: `Chain probe dock ${Date.now()}`,
        brand: 'Anker',
        model: 'PowerExpand 13-in-1',
        categoryId,
        currency: 'INR',
        unitPrice: '4000.00',
        landedCost: '4720.00',
        availableQuantity: 50,
        availableFrom: new Date(Date.now() - 86_400_000),
        availableUntil: new Date(Date.now() + 86_400_000 * 30),
        status: 'APPROVED',
      },
      select: { id: true, name: true },
    });

    // The request asks for the product by the name the selection records, which
    // is how the order line and the listing are matched without asking anybody
    // to retype an id.
    const pr = await api(app)
      .post(`${base}/requests`)
      .set(auth(s.employee))
      .send({
        justification: 'Integration probe: the listing must reach the asset.',
        lines: [{ description: offer.name, quantity: 2, estimatedUnitPrice: '4000.00', inventoryItemId: itemId }],
      });
    expect(pr.status, JSON.stringify(pr.body)).toBe(201);
    const requestId = pr.body.data.id as string;

    await prisma.client.procurementSelection.create({
      data: {
        companyId,
        vendorProductId: offer.id,
        vendorId,
        purchaseRequestId: requestId,
        quantity: 2,
        currency: 'INR',
        unitPrice: '4000.00',
        gstPercent: '18.00',
        discount: '0.00',
        shippingCost: '0.00',
        installationCost: '0.00',
        otherCharges: '0.00',
        landedCost: '4720.00',
        totalCost: '9440.00',
        productName: offer.name,
        availableUntil: new Date(Date.now() + 86_400_000 * 30),
        selectedById: s.superAdmin.user.id,
      },
    });

    await api(app).post(`${base}/requests/${requestId}/submit`).set(auth(s.employee));
    await api(app)
      .post(`${base}/requests/${requestId}/decision`)
      .set(auth(s.finance))
      .send({ decision: 'APPROVE' });
    const converted = await api(app)
      .post(`${base}/requests/${requestId}/convert`)
      .set(auth(s.superAdmin))
      .send({ vendorId });
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    const poId = converted.body.data.purchaseOrderId as string;

    // The order line names the listing, not just a description of it.
    const line = await prisma.client.purchaseOrderLine.findFirstOrThrow({
      where: { purchaseOrderId: poId },
      select: { id: true, vendorProductId: true },
    });
    expect(line.vendorProductId).toBe(offer.id);

    await api(app).post(`${base}/orders/${poId}/issue`).set(auth(s.superAdmin));
    const received = await api(app)
      .post(`${base}/orders/${poId}/receive`)
      .set(auth(s.superAdmin))
      .send({ lines: [{ purchaseOrderLineId: line.id, quantity: 2, intake: 'ASSET', categoryId }] });
    expect(received.status, JSON.stringify(received.body)).toBe(201);

    const assets = await prisma.client.asset.findMany({
      where: { companyId, vendorProductId: offer.id },
      select: { vendorProductId: true, brand: true, model: true, vendorId: true },
    });
    expect(assets).toHaveLength(2);
    for (const asset of assets) {
      expect(asset.vendorProductId).toBe(offer.id);
      // Make and model come from the listing rather than being left blank, which
      // is what filled the register with units nobody could identify.
      expect(asset.brand).toBe('Anker');
      expect(asset.model).toBe('PowerExpand 13-in-1');
      expect(asset.vendorId).toBe(vendorId);
    }
  });

  it('leaves the link empty rather than guessing when nothing was selected', async () => {
    const { poId, lineId } = await issuedPo(1);
    await receive(poId, { lines: [{ purchaseOrderLineId: lineId, quantity: 1, intake: 'ASSET', categoryId }] });
    const line = await prisma.client.purchaseOrderLine.findUniqueOrThrow({
      where: { id: lineId },
      select: { vendorProductId: true },
    });
    // A guessed provenance is worse than an honest blank.
    expect(line.vendorProductId).toBeNull();
  });
});

describe('ASSET intake creates the assets', () => {
  it('receiving 3 units creates exactly 3 assets carrying their purchase history', async () => {
    const { poId, lineId, poNumber } = await issuedPo(3);
    const res = await receive(poId, {
      lines: [{ purchaseOrderLineId: lineId, quantity: 3, intake: 'ASSET', categoryId }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.assetsCreated).toHaveLength(3);

    const assets = await prisma.client.asset.findMany({
      where: { companyId, purchaseOrderNumber: poNumber },
      select: {
        assetTag: true,
        name: true,
        status: true,
        categoryId: true,
        vendorId: true,
        purchaseCost: true,
        currency: true,
        qrToken: true,
        sourceUnitIndex: true,
        sourceGrnLine: { select: { purchaseOrderLineId: true } },
      },
      orderBy: { sourceUnitIndex: 'asc' },
    });
    expect(assets).toHaveLength(3);
    expect(assets.map((a) => a.sourceUnitIndex)).toEqual([1, 2, 3]);
    for (const asset of assets) {
      expect(asset.name).toBe('USB-C dock');
      // In the building, but nobody has checked or configured it yet.
      expect(asset.status).toBe('RECEIVED');
      expect(asset.categoryId).toBe(categoryId);
      expect(asset.vendorId).toBe(vendorId);
      // The cost flows from procurement into the register - the point of the loop.
      expect(asset.purchaseCost?.toString()).toBe('40');
      expect(asset.currency).toBeTruthy();
      expect(asset.sourceGrnLine?.purchaseOrderLineId).toBe(lineId);
    }
    // Tags and QR tokens are per unit, not per line.
    expect(new Set(assets.map((a) => a.assetTag)).size).toBe(3);
    expect(new Set(assets.map((a) => a.qrToken)).size).toBe(3);
    // Every one of them is auditable as an asset in its own right.
    const audits = await prisma.client.auditLog.findMany({
      where: { companyId, action: 'ASSET_CREATED', entityType: 'Asset', actorId: s.superAdmin.user.id },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { newValues: true },
    });
    expect(audits).toHaveLength(3);
    expect(JSON.stringify(audits[0]!.newValues)).toContain('Goods receipt');
  });

  it('serials and labels captured at the dock attach in unit order; unknown units go without', async () => {
    const { poId, lineId, poNumber } = await issuedPo(3);
    const res = await receive(poId, {
      lines: [
        {
          purchaseOrderLineId: lineId,
          quantity: 3,
          intake: 'ASSET',
          categoryId,
          serialNumbers: ['C1-SER-A', 'C1-SER-B'],
          assetTags: ['C1-TAG-A'],
        },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const assets = await prisma.client.asset.findMany({
      where: { companyId, purchaseOrderNumber: poNumber },
      select: { assetTag: true, serialNumber: true, sourceUnitIndex: true },
      orderBy: { sourceUnitIndex: 'asc' },
    });
    expect(assets.map((a) => a.serialNumber)).toEqual(['C1-SER-A', 'C1-SER-B', null]);
    expect(assets[0]!.assetTag).toBe('C1-TAG-A');
    // Unlabelled units get a provisional tag that says where they came from.
    expect(assets[1]!.assetTag).toMatch(/^GRN-/);
  });

  it('a partial delivery creates only what arrived, and the rest on the second visit', async () => {
    const { poId, lineId, poNumber } = await issuedPo(3);
    expect(
      (await receive(poId, { lines: [{ purchaseOrderLineId: lineId, quantity: 1, intake: 'ASSET', categoryId }] }))
        .status,
    ).toBe(201);
    expect(await prisma.client.asset.count({ where: { companyId, purchaseOrderNumber: poNumber } })).toBe(1);

    const second = await receive(poId, {
      lines: [{ purchaseOrderLineId: lineId, quantity: 2, intake: 'ASSET', categoryId }],
    });
    expect(second.status).toBe(201);
    expect(second.body.data.status).toBe('RECEIVED');
    expect(await prisma.client.asset.count({ where: { companyId, purchaseOrderNumber: poNumber } })).toBe(3);
  });

  it('mixed intake on one receipt: stock posts to the ledger, assets become assets', async () => {
    const { poId, lineId, poNumber } = await issuedPo(2);
    const location = await prisma.client.stockLocation.create({
      data: { companyId, code: 'C1-WH', name: 'C1 Warehouse' },
      select: { id: true },
    });
    const before = await prisma.client.inventoryItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { quantityOnHand: true },
    });
    const res = await receive(poId, {
      lines: [
        { purchaseOrderLineId: lineId, quantity: 1, intake: 'ASSET', categoryId },
        {
          purchaseOrderLineId: lineId,
          quantity: 1,
          intake: 'STOCK',
          stockLocationId: location.id,
          inventoryItemId: itemId,
        },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.assetsCreated).toHaveLength(1);

    const after = await prisma.client.inventoryItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { quantityOnHand: true },
    });
    expect(Number(after.quantityOnHand) - Number(before.quantityOnHand)).toBe(1);
    expect(await prisma.client.asset.count({ where: { companyId, purchaseOrderNumber: poNumber } })).toBe(1);

    await prisma.client.asset.deleteMany({ where: { companyId, purchaseOrderNumber: poNumber } });
    await prisma.client.stockLevel.deleteMany({ where: { stockLocationId: location.id } });
    await prisma.client.stockMovement.deleteMany({ where: { stockLocationId: location.id } });
    await prisma.client.stockLocation.delete({ where: { id: location.id } });
  });
});

describe('creation is idempotent, and refusals take nothing', () => {
  it('re-posting a completed receipt is refused and creates no second set of assets', async () => {
    const { poId, lineId, poNumber } = await issuedPo(2);
    const line = { purchaseOrderLineId: lineId, quantity: 2, intake: 'ASSET' as const, categoryId };
    expect((await receive(poId, { lines: [line] })).status).toBe(201);

    const replay = await receive(poId, { lines: [line] });
    expect(replay.status).toBe(409);
    // The PO is fully received, so the state guard refuses before the intake runs.
    expect(replay.body.detail).toMatch(/RECEIVED PO cannot receive/i);
    expect(await prisma.client.asset.count({ where: { companyId, purchaseOrderNumber: poNumber } })).toBe(2);
  });

  it('over-receiving an ASSET line is refused with the real numbers and creates nothing', async () => {
    const { poId, lineId, poNumber } = await issuedPo(2);
    expect(
      (await receive(poId, { lines: [{ purchaseOrderLineId: lineId, quantity: 1, intake: 'ASSET', categoryId }] }))
        .status,
    ).toBe(201);

    const greedy = await receive(poId, {
      lines: [{ purchaseOrderLineId: lineId, quantity: 2, intake: 'ASSET', categoryId }],
    });
    expect(greedy.status).toBe(409);
    expect(greedy.body.detail).toMatch(/1 of 2/);
    // The refusal took nothing: one asset from the honest delivery, no more.
    expect(await prisma.client.asset.count({ where: { companyId, purchaseOrderNumber: poNumber } })).toBe(1);
  });

  it('the database itself refuses a duplicate unit, so a replay cannot slip past the service', async () => {
    const { poId, lineId } = await issuedPo(1);
    expect(
      (await receive(poId, { lines: [{ purchaseOrderLineId: lineId, quantity: 1, intake: 'ASSET', categoryId }] }))
        .status,
    ).toBe(201);
    const asset = await prisma.client.asset.findFirstOrThrow({
      where: { companyId, sourceGrnLineId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { sourceGrnLineId: true, sourceUnitIndex: true },
    });

    // Exactly what a retried job or a double-processed receipt would attempt.
    await expect(
      prisma.client.asset.create({
        data: {
          companyId,
          assetTag: 'C1-REPLAY',
          name: 'Replay attempt',
          categoryId,
          qrToken: 'c1-replay-token',
          sourceGrnLineId: asset.sourceGrnLineId,
          sourceUnitIndex: asset.sourceUnitIndex,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('refuses ASSET intake with no category, a fractional quantity, or more serials than units', async () => {
    const { poId, lineId, poNumber } = await issuedPo(2);
    const bad = [
      { purchaseOrderLineId: lineId, quantity: 1, intake: 'ASSET' as const },
      { purchaseOrderLineId: lineId, quantity: 1.5, intake: 'ASSET' as const, categoryId },
      {
        purchaseOrderLineId: lineId,
        quantity: 1,
        intake: 'ASSET' as const,
        categoryId,
        serialNumbers: ['C1-X', 'C1-Y'],
      },
      {
        purchaseOrderLineId: lineId,
        quantity: 2,
        intake: 'ASSET' as const,
        categoryId,
        serialNumbers: ['C1-SAME', 'C1-SAME'],
      },
    ];
    for (const line of bad) {
      const res = await receive(poId, { lines: [line] });
      expect(res.status, JSON.stringify(line)).toBe(422);
    }
    // Nothing was received and nothing was created by any of those attempts.
    expect(await prisma.client.asset.count({ where: { companyId, purchaseOrderNumber: poNumber } })).toBe(0);
    const po = await api(app).get(`${base}/orders/${poId}`).set(auth(s.superAdmin));
    expect(Number(po.body.data.lines[0].receivedQuantity)).toBe(0);
    expect(po.body.data.status).toBe('ISSUED');
  });

  it('refuses a serial already recorded on another asset, naming it, and receives nothing', async () => {
    const first = await issuedPo(1);
    expect(
      (
        await receive(first.poId, {
          lines: [
            {
              purchaseOrderLineId: first.lineId,
              quantity: 1,
              intake: 'ASSET',
              categoryId,
              serialNumbers: ['C1-DUPLICATE'],
            },
          ],
        })
      ).status,
    ).toBe(201);

    const second = await issuedPo(1);
    const clash = await receive(second.poId, {
      lines: [
        {
          purchaseOrderLineId: second.lineId,
          quantity: 1,
          intake: 'ASSET',
          categoryId,
          serialNumbers: ['C1-DUPLICATE'],
        },
      ],
    });
    expect(clash.status).toBe(409);
    expect(clash.body.detail).toContain('C1-DUPLICATE');
    expect(await prisma.client.asset.count({ where: { companyId, purchaseOrderNumber: second.poNumber } })).toBe(0);
  });

  it('refuses a category from another tenant rather than filing an asset under it', async () => {
    const foreign = await prisma.client.category.findFirst({
      where: { companyId: { not: companyId } },
      select: { id: true },
    });
    const { poId, lineId, poNumber } = await issuedPo(1);
    const res = await receive(poId, {
      lines: [
        {
          purchaseOrderLineId: lineId,
          quantity: 1,
          intake: 'ASSET',
          categoryId: foreign?.id ?? 'no-such-category',
        },
      ],
    });
    expect(res.status).toBe(404);
    expect(await prisma.client.asset.count({ where: { companyId, purchaseOrderNumber: poNumber } })).toBe(0);
  });
});
