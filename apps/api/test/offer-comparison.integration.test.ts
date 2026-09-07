import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Spec templates, comparison and selection, end to end (v2.42).
 *
 * Two things are being proved here. First that the comparison says what it
 * means - a specification nobody filled in must never read as a match. Second
 * that neither a supplier nor an employee can reach any of it: how offers score
 * against each other belongs to the buyer, and vendor pricing is not employee
 * information.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
const prisma = new PrismaClient();

let categoryId = '';
let vendorA = '';
let vendorB = '';
let tokenA = '';
const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

/** A category of its own, so the template here cannot disturb another suite. */
beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  const companyId = s.superAdmin.user.companyId;

  const category = await prisma.category.create({
    data: { companyId, key: `laptops-${stamp()}`, name: `Laptops ${stamp()}` },
  });
  categoryId = category.id;

  const a = await prisma.vendor.create({
    data: { companyId, name: `Alpha ${stamp()}`, code: `CA${stamp()}`.slice(0, 20) },
  });
  const b = await prisma.vendor.create({
    data: { companyId, name: `Beta ${stamp()}`, code: `CB${stamp()}`.slice(0, 20) },
  });
  vendorA = a.id;
  vendorB = b.id;

  const role = await prisma.role.findFirst({ where: { companyId, key: 'VENDOR', deletedAt: null } });
  const template = await prisma.user.findFirstOrThrow({
    where: { companyId, email: 'employee@techpioasset.dev' },
    select: { passwordHash: true },
  });
  const email = `alpha-cmp-${stamp()}@example.com`;
  await prisma.user.create({
    data: {
      companyId,
      email,
      passwordHash: template.passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      vendorId: vendorA,
      roles: { create: { roleId: role!.id } },
    },
  });
  const login = await api(app).post('/api/v1/auth/login').send({ email, password: 'TechpioDemo!2026' });
  tokenA = login.body?.data?.accessToken ?? '';

  // The template every test below compares against.
  for (const field of [
    { key: 'ram_gb', label: 'RAM', dataType: 'NUMBER', unit: 'GB', intent: 'AT_LEAST', sortOrder: 1 },
    { key: 'weight_kg', label: 'Weight', dataType: 'NUMBER', unit: 'kg', intent: 'AT_MOST', sortOrder: 2 },
    { key: 'os', label: 'Operating system', dataType: 'TEXT', sortOrder: 3 },
  ]) {
    const res = await api(app)
      .post('/api/v1/spec-templates')
      .set(auth(s.superAdmin))
      .send({ categoryId, ...field });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
  await app?.close();
});

const vendorAuth = () => ({ Authorization: `Bearer ${tokenA}` });

async function offer(
  vendorId: string,
  specs: Record<string, string>,
  over: Record<string, unknown> = {},
) {
  const res = await api(app)
    .post('/api/v1/vendor-products')
    .set(auth(s.officeAdmin))
    .send({
      vendorId,
      name: `Offer ${stamp()}`,
      categoryId,
      unitPrice: 100000,
      gstPercent: 18,
      availableQuantity: 25,
      specs,
      availableFrom: new Date(Date.now() - 86_400_000).toISOString(),
      availableUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      ...over,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id as string;
}

/** Approved and live, which is what selection requires. */
async function liveOffer(vendorId: string, specs: Record<string, string>, over = {}) {
  const id = await offer(vendorId, specs, over);
  await prisma.vendorProduct.update({ where: { id }, data: { status: 'APPROVED' } });
  return id;
}

describe('spec templates', () => {
  it('refuses a number field that does not say which way it points', async () => {
    // Without this, a weight limit would be compared as "at least 1.4 kg".
    const res = await api(app)
      .post('/api/v1/spec-templates')
      .set(auth(s.superAdmin))
      .send({ categoryId, key: `screen_${stamp()}`, label: 'Screen', dataType: 'NUMBER', unit: 'in' });
    expect(res.status).toBe(422);
  });

  it('refuses a list with fewer than two choices', async () => {
    const res = await api(app)
      .post('/api/v1/spec-templates')
      .set(auth(s.superAdmin))
      .send({ categoryId, key: `colour_${stamp()}`, label: 'Colour', dataType: 'ENUM', options: ['black'] });
    expect(res.status).toBe(422);
  });

  it('refuses a key that is not a machine key', async () => {
    const res = await api(app)
      .post('/api/v1/spec-templates')
      .set(auth(s.superAdmin))
      .send({ categoryId, key: 'Screen Size!', label: 'Screen', dataType: 'TEXT' });
    expect(res.status).toBe(422);
  });

  it('will not let an employee edit the template', async () => {
    const res = await api(app)
      .post('/api/v1/spec-templates')
      .set(auth(s.employee))
      .send({ categoryId, key: `x_${stamp()}`, label: 'X', dataType: 'TEXT' });
    expect(res.status).toBe(403);
  });

  it('lets an office admin edit the template, not only a super admin', async () => {
    // The people who assess offers decide what an offer is described by. Gating
    // this on the categories permission would leave it to Super Admin alone,
    // which is nobody who actually runs the catalogue.
    const res = await api(app)
      .post('/api/v1/spec-templates')
      .set(auth(s.officeAdmin))
      .send({ categoryId, key: `ports_${stamp()}`, label: 'Ports', dataType: 'TEXT' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it('will not let a supplier edit the template it is judged on', async () => {
    // A vendor holds vendor-products:manage for its own drafts, so the route
    // permission alone would not keep it out of here.
    const res = await api(app)
      .post('/api/v1/spec-templates')
      .set(vendorAuth())
      .send({ categoryId, key: `sneaky_${stamp()}`, label: 'Sneaky', dataType: 'TEXT' });
    expect(res.status).toBe(403);
  });

  it('lets a vendor read the template it has to fill in', async () => {
    const res = await api(app).get('/api/v1/spec-templates').query({ categoryId }).set(vendorAuth());
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
  });

  it('refuses to rename a key once offers exist in the category', async () => {
    await offer(vendorA, { ram_gb: '16' });
    const field = await prisma.categorySpecField.findFirstOrThrow({
      where: { categoryId, key: 'os', deletedAt: null },
    });
    const res = await api(app)
      .patch(`/api/v1/spec-templates/${field.id}`)
      .set(auth(s.superAdmin))
      .send({ key: 'operating_system' });
    expect(res.status).toBe(409);
  });
});

describe('comparison', () => {
  it('marks a specification the vendor never filled in as a fail that says so', async () => {
    const a = await liveOffer(vendorA, { ram_gb: '16', os: 'Windows 11' });
    const b = await liveOffer(vendorB, { os: 'Windows 11' });

    const res = await api(app)
      .post('/api/v1/vendor-products/compare')
      .set(auth(s.officeAdmin))
      .send({
        categoryId,
        vendorProductIds: [a, b],
        requirements: [{ key: 'ram_gb', value: '16' }],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const rowB = res.body.data.offers.find((o: { id: string }) => o.id === b);
    const ram = rowB.comparison.fields.find((f: { key: string }) => f.key === 'ram_gb');
    expect(ram.outcome).toBe('FAIL');
    expect(ram.reason).toBe('Not stated by the vendor');
    expect(ram.offered).toBeNull();
  });

  it('reads an at-most requirement as a limit, not a target', async () => {
    const light = await liveOffer(vendorA, { weight_kg: '1.2' });
    const heavy = await liveOffer(vendorB, { weight_kg: '2.6' });

    const res = await api(app)
      .post('/api/v1/vendor-products/compare')
      .set(auth(s.officeAdmin))
      .send({
        categoryId,
        vendorProductIds: [light, heavy],
        requirements: [{ key: 'weight_kg', value: '1.5' }],
      });

    const outcome = (id: string) =>
      res.body.data.offers
        .find((o: { id: string }) => o.id === id)
        .comparison.fields.find((f: { key: string }) => f.key === 'weight_kg').outcome;
    expect(outcome(light)).toBe('PASS');
    expect(outcome(heavy)).toBe('FAIL');
  });

  it('ranks an offer that meets a mandatory requirement above a cheaper one that does not', async () => {
    const cheapButWrong = await liveOffer(vendorA, { ram_gb: '8' }, { unitPrice: 40000 });
    const dearButRight = await liveOffer(vendorB, { ram_gb: '32' }, { unitPrice: 150000 });

    const res = await api(app)
      .post('/api/v1/vendor-products/compare')
      .set(auth(s.officeAdmin))
      .send({
        categoryId,
        vendorProductIds: [cheapButWrong, dearButRight],
        requirements: [{ key: 'ram_gb', value: '16', mandatory: true }],
      });
    expect(res.body.data.offers[0].id).toBe(dearButRight);
    expect(res.body.data.offers[0].comparison.meetsMandatory).toBe(true);
  });

  it('refuses an offer that is not in the category rather than quietly dropping it', async () => {
    const other = await prisma.category.create({
      data: { companyId: s.superAdmin.user.companyId, key: `other-${stamp()}`, name: `Other ${stamp()}` },
    });
    const outsider = await prisma.vendorProduct.create({
      data: {
        companyId: s.superAdmin.user.companyId,
        vendorId: vendorA,
        categoryId: other.id,
        name: 'Chair',
        unitPrice: 5000,
        landedCost: 5000,
        availableFrom: new Date(),
        availableUntil: new Date(Date.now() + 86_400_000),
      },
    });
    const inside = await liveOffer(vendorA, { ram_gb: '16' });

    const res = await api(app)
      .post('/api/v1/vendor-products/compare')
      .set(auth(s.officeAdmin))
      .send({ categoryId, vendorProductIds: [inside, outsider.id], requirements: [] });
    expect(res.status).toBe(422);
  });

  it('does not let a supplier compare anything', async () => {
    const a = await liveOffer(vendorA, { ram_gb: '16' });
    const b = await liveOffer(vendorA, { ram_gb: '32' });
    const res = await api(app)
      .post('/api/v1/vendor-products/compare')
      .set(vendorAuth())
      .send({ categoryId, vendorProductIds: [a, b], requirements: [] });
    // Even its own two offers: a scoreboard is the buyer's, not the seller's.
    expect([403, 404]).toContain(res.status);
  });

  it('does not let an employee compare, because that would show them vendor pricing', async () => {
    const a = await liveOffer(vendorA, { ram_gb: '16' });
    const b = await liveOffer(vendorB, { ram_gb: '32' });
    const res = await api(app)
      .post('/api/v1/vendor-products/compare')
      .set(auth(s.employee))
      .send({ categoryId, vendorProductIds: [a, b], requirements: [] });
    expect(res.status).toBe(403);
  });
});

describe('selection', () => {
  it('snapshots the price so a later change cannot rewrite the decision', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' }, { unitPrice: 100000, gstPercent: 18 });
    const res = await api(app)
      .post(`/api/v1/vendor-products/${id}/select`)
      .set(auth(s.officeAdmin))
      .send({ quantity: 2 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(Number(res.body.data.landedCost)).toBe(118000);
    expect(Number(res.body.data.totalCost)).toBe(236000);

    // The vendor moves its price; the recorded decision must not move with it.
    await prisma.vendorProduct.update({
      where: { id },
      data: { unitPrice: 500000, landedCost: 590000 },
    });
    const after = await prisma.procurementSelection.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect(Number(after.totalCost)).toBe(236000);
  });

  it('refuses an expired offer', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    await prisma.vendorProduct.update({
      where: { id },
      data: { availableUntil: new Date(Date.now() - 86_400_000) },
    });
    const res = await api(app)
      .post(`/api/v1/vendor-products/${id}/select`)
      .set(auth(s.officeAdmin))
      .send({ quantity: 1 });
    expect(res.status).toBe(409);
    expect(res.body.detail).toContain('stopped honouring');
  });

  it('refuses more than the vendor has', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' }, { availableQuantity: 3 });
    const res = await api(app)
      .post(`/api/v1/vendor-products/${id}/select`)
      .set(auth(s.officeAdmin))
      .send({ quantity: 10 });
    expect(res.status).toBe(409);
  });

  it('refuses less than the minimum order', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' }, { minOrderQuantity: 5 });
    const res = await api(app)
      .post(`/api/v1/vendor-products/${id}/select`)
      .set(auth(s.officeAdmin))
      .send({ quantity: 2 });
    expect(res.status).toBe(409);
  });

  it('refuses a draft that was never approved', async () => {
    const id = await offer(vendorA, { ram_gb: '16' });
    const res = await api(app)
      .post(`/api/v1/vendor-products/${id}/select`)
      .set(auth(s.officeAdmin))
      .send({ quantity: 1 });
    expect(res.status).toBe(409);
  });

  it('does not let a supplier choose its own offer', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    const res = await api(app)
      .post(`/api/v1/vendor-products/${id}/select`)
      .set(vendorAuth())
      .send({ quantity: 1 });
    expect(res.status).toBe(403);
  });

  it('does not let an employee choose', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    const res = await api(app)
      .post(`/api/v1/vendor-products/${id}/select`)
      .set(auth(s.employee))
      .send({ quantity: 1 });
    expect(res.status).toBe(403);
  });

  it('keeps an undone choice as a dated row rather than deleting it', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    const made = await api(app)
      .post(`/api/v1/vendor-products/${id}/select`)
      .set(auth(s.officeAdmin))
      .send({ quantity: 1 });
    const selectionId = made.body.data.id;

    const undone = await api(app)
      .delete(`/api/v1/vendor-products/selections/${selectionId}`)
      .set(auth(s.officeAdmin));
    expect(undone.status).toBe(200);

    const row = await prisma.procurementSelection.findUniqueOrThrow({ where: { id: selectionId } });
    expect(row.deselectedAt).not.toBeNull();
    expect(row.deselectedById).toBe(s.officeAdmin.user.id);
  });

  it('does not show a supplier what was chosen', async () => {
    const res = await api(app).get('/api/v1/vendor-products/selections/list').set(vendorAuth());
    expect([403, 404]).toContain(res.status);
  });
});
