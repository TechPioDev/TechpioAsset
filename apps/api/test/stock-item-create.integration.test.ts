import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Sep 2026 - creating a stock item, and adding quantity to it.
 *
 * Stock used to arrive only through purchase-order receiving, so a tenant with
 * no procurement flow could not put anything on a shelf. Creating an item
 * describes it; quantity still arrives through /stock/adjust so the ledger
 * stays the only way units reach a location.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let companyId: string;
let categoryId: string;
let locationId: string;
let foreignCompanyId: string;
let foreignItemId: string;

const run = Date.now() % 1_000_000;
const sku = `NEWITEM-${run}`;
const created: string[] = [];
const base = '/api/v1/stock';

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;

  const category = await prisma.client.category.findFirst({
    where: { companyId, deletedAt: null },
    select: { id: true },
  });
  categoryId = category!.id;

  const loc = await api(app)
    .post(`${base}/locations`)
    .set(auth(s.superAdmin))
    .send({ code: `WH-NI-${run}`, name: 'New-item suite shelf' });
  expect(loc.status, JSON.stringify(loc.body)).toBe(201);
  locationId = loc.body.data.id;

  // A second tenant holding an item with the SAME SKU: neither side may see the
  // other's, and the clash check must not reach across companies.
  const company = await prisma.client.company.create({
    data: { name: `Stock Item Probe Tenant ${run}` },
    select: { id: true },
  });
  foreignCompanyId = company.id;
  const foreignCategory = await prisma.client.category.create({
    data: { companyId: foreignCompanyId, key: `probe-${run}`, name: 'Probe' },
    select: { id: true },
  });
  const foreign = await prisma.client.inventoryItem.create({
    data: { companyId: foreignCompanyId, sku, name: 'Foreign twin', categoryId: foreignCategory.id },
    select: { id: true },
  });
  foreignItemId = foreign.id;
});

afterAll(async () => {
  const ids = [...created, foreignItemId];
  await prisma.client.stockMovement.deleteMany({ where: { inventoryItemId: { in: ids } } });
  await prisma.client.stockLevel.deleteMany({ where: { inventoryItemId: { in: ids } } });
  await prisma.client.auditLog
    .deleteMany({ where: { entityType: 'InventoryItem', entityId: { in: ids } } })
    .catch(() => undefined);
  await prisma.client.inventoryItem.deleteMany({ where: { id: { in: ids } } });
  await prisma.client.stockLocation.deleteMany({ where: { id: locationId } });
  await prisma.client.company.delete({ where: { id: foreignCompanyId } }).catch(() => undefined);
  await app?.close();
});

const create = (who: Session, body: Record<string, unknown>) =>
  api(app).post(`${base}/items`).set(auth(who)).send(body);

describe('POST /stock/items', () => {
  it('creates an item (201), upper-casing the SKU, and audits it', async () => {
    const res = await create(s.officeAdmin, {
      name: 'HDMI cable 2m',
      sku: sku.toLowerCase(),
      categoryId,
      unit: 'pcs',
      minStock: 3,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.sku).toBe(sku);
    expect(res.body.data.unit).toBe('pcs');
    expect(Number(res.body.data.minStock)).toBe(3);
    expect(Number(res.body.data.quantityOnHand)).toBe(0);
    // Office Admin holds no cost permission: the cost fields do not leave the API.
    expect(res.body.data).not.toHaveProperty('unitCost');
    created.push(res.body.data.id);

    const audit = await prisma.client.auditLog.findFirst({
      where: { entityType: 'InventoryItem', entityId: res.body.data.id, actorId: s.officeAdmin.user.id },
    });
    expect(audit?.action).toBe('INVENTORY_ADJUSTED');
    expect((audit?.newValues as { kind?: string } | null)?.kind).toBe('ITEM_CREATED');
  });

  it('refuses a duplicate SKU in the same company, case-insensitively (409)', async () => {
    const dup = await create(s.superAdmin, { name: 'Another cable', sku: sku.toLowerCase(), categoryId });
    expect(dup.status).toBe(409);
    expect(dup.body.detail ?? dup.body.message).toContain('HDMI cable 2m');
  });

  it('needs inventory:adjust (403)', async () => {
    for (const who of [s.employee, s.finance, s.auditor]) {
      const denied = await create(who, { name: 'Nope', sku: `NOPE-${run}`, categoryId });
      expect(denied.status).toBe(403);
    }
  });

  it('purchase cost is refused from roles without the cost permission and kept for those with it', async () => {
    const refused = await create(s.itAdmin, {
      name: 'Priced by IT',
      sku: `COST-IT-${run}`,
      categoryId,
      unitCost: '450.00',
    });
    expect(refused.status).toBe(403);
    expect(
      await prisma.client.inventoryItem.findFirst({ where: { companyId, sku: `COST-IT-${run}` } }),
    ).toBeNull();

    const priced = await create(s.superAdmin, {
      name: 'Priced by admin',
      sku: `COST-SA-${run}`,
      categoryId,
      unitCost: '450.00',
    });
    expect(priced.status, JSON.stringify(priced.body)).toBe(201);
    created.push(priced.body.data.id);
    expect(Number(priced.body.data.unitCost)).toBe(450);
    expect(priced.body.data.currency).toBe('INR');
  });

  it("refuses another tenant's category (404)", async () => {
    const foreignCategory = await prisma.client.category.findFirst({
      where: { companyId: foreignCompanyId },
      select: { id: true },
    });
    const res = await create(s.superAdmin, { name: 'Cross', sku: `CROSS-${run}`, categoryId: foreignCategory!.id });
    expect(res.status).toBe(404);
  });

  it("another tenant's item with the same SKU is invisible and untouchable", async () => {
    const list = await api(app).get(`${base}/items?q=${sku}`).set(auth(s.superAdmin));
    expect(list.status).toBe(200);
    const ids = list.body.data.map((i: { id: string }) => i.id);
    expect(ids).toContain(created[0]);
    expect(ids).not.toContain(foreignItemId);

    const adjust = await api(app)
      .post(`${base}/adjust`)
      .set(auth(s.superAdmin))
      .send({ inventoryItemId: foreignItemId, stockLocationId: locationId, delta: 5, reason: 'Should not land' });
    expect(adjust.status).toBe(404);
  });
});

describe('add quantity = adjust with a positive delta', () => {
  it('shows in levels and the ledger, with an audit row', async () => {
    const itemId = created[0]!;
    const res = await api(app)
      .post(`${base}/adjust`)
      .set(auth(s.officeAdmin))
      .send({ inventoryItemId: itemId, stockLocationId: locationId, delta: 12, reason: 'Opening stock count' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const levels = await api(app)
      .get(`${base}/levels?inventoryItemId=${itemId}`)
      .set(auth(s.officeAdmin));
    expect(levels.status).toBe(200);
    expect(levels.body.data).toHaveLength(1);
    expect(Number(levels.body.data[0].quantity)).toBe(12);
    expect(levels.body.data[0].stockLocation.id).toBe(locationId);

    const ledger = await api(app)
      .get(`${base}/movements?inventoryItemId=${itemId}`)
      .set(auth(s.officeAdmin));
    expect(ledger.body.data).toHaveLength(1);
    expect(ledger.body.data[0]).toMatchObject({ type: 'ADJUST_UP', reason: 'Opening stock count' });
    expect(Number(ledger.body.data[0].quantity)).toBe(12);

    const item = await prisma.client.inventoryItem.findUnique({
      where: { id: itemId },
      select: { quantityOnHand: true },
    });
    expect(Number(item?.quantityOnHand)).toBe(12);

    const audit = await prisma.client.auditLog.findMany({
      where: { entityType: 'InventoryItem', entityId: itemId, action: 'INVENTORY_ADJUSTED' },
      select: { newValues: true, reason: true },
    });
    expect(audit.some((a) => (a.newValues as { kind?: string }).kind === 'ADJUST_UP' && a.reason === 'Opening stock count')).toBe(true);
  });
});
