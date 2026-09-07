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
let laptopSubId = '';
let mouseSubId = '';
/** Same rule the server uses to group differently-spelled labels. */
const normalise = (label: string) =>
  label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
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

  // Two subcategories, so the tests can prove a field on one does not reach
  // the other - the whole reason subcategory-level fields exist.
  const laptopSub = await prisma.subcategory.create({
    data: { categoryId, key: `laptop-${stamp()}`, name: 'Laptop' },
  });
  const mouseSub = await prisma.subcategory.create({
    data: { categoryId, key: `mouse-${stamp()}`, name: 'Mouse' },
  });
  laptopSubId = laptopSub.id;
  mouseSubId = mouseSub.id;

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

  it('keeps a subcategory field away from a different subcategory', async () => {
    // RAM belongs to laptops. A mouse offer must never be asked about it.
    const res = await api(app)
      .post('/api/v1/spec-templates')
      .set(auth(s.officeAdmin))
      .send({
        categoryId,
        subcategoryId: laptopSubId,
        key: `dpi_${stamp()}`,
        label: 'Polling rate',
        dataType: 'NUMBER',
        unit: 'Hz',
        intent: 'AT_LEAST',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const key = res.body.data.key;

    const forLaptop = await api(app)
      .get('/api/v1/spec-templates')
      .query({ categoryId, subcategoryId: laptopSubId })
      .set(auth(s.officeAdmin));
    expect(forLaptop.body.data.some((f: { key: string }) => f.key === key)).toBe(true);

    const forMouse = await api(app)
      .get('/api/v1/spec-templates')
      .query({ categoryId, subcategoryId: mouseSubId })
      .set(auth(s.officeAdmin));
    expect(forMouse.body.data.some((f: { key: string }) => f.key === key)).toBe(false);
  });

  it('shares a category-level field with every subcategory', async () => {
    // Warranty is a question everything in the category has an answer to.
    const key = `warranty_note_${stamp()}`;
    await api(app)
      .post('/api/v1/spec-templates')
      .set(auth(s.officeAdmin))
      .send({ categoryId, key, label: 'Warranty note', dataType: 'TEXT' });

    for (const sub of [laptopSubId, mouseSubId]) {
      const res = await api(app)
        .get('/api/v1/spec-templates')
        .query({ categoryId, subcategoryId: sub })
        .set(auth(s.officeAdmin));
      expect(res.body.data.some((f: { key: string }) => f.key === key)).toBe(true);
    }
  });

  it('refuses a subcategory that belongs to another category', async () => {
    const other = await prisma.category.create({
      data: { companyId: s.superAdmin.user.companyId, key: `oth-${stamp()}`, name: `Oth ${stamp()}` },
    });
    const res = await api(app)
      .post('/api/v1/spec-templates')
      .set(auth(s.officeAdmin))
      .send({
        categoryId: other.id,
        subcategoryId: laptopSubId,
        key: `stray_${stamp()}`,
        label: 'Stray',
        dataType: 'TEXT',
      });
    expect(res.status).toBe(422);
  });

  it('lets the same key exist once per subcategory without clashing', async () => {
    const key = `screen_size_${stamp()}`;
    const body = { categoryId, key, label: 'Screen size', dataType: 'NUMBER', unit: 'in', intent: 'AT_LEAST' };
    const laptop = await api(app)
      .post('/api/v1/spec-templates')
      .set(auth(s.officeAdmin))
      .send({ ...body, subcategoryId: laptopSubId });
    const mouse = await api(app)
      .post('/api/v1/spec-templates')
      .set(auth(s.officeAdmin))
      .send({ ...body, subcategoryId: mouseSubId });
    expect(laptop.status, JSON.stringify(laptop.body)).toBe(201);
    expect(mouse.status, JSON.stringify(mouse.body)).toBe(201);

    // But twice in the same place is still a clash.
    const again = await api(app)
      .post('/api/v1/spec-templates')
      .set(auth(s.officeAdmin))
      .send({ ...body, subcategoryId: laptopSubId });
    expect(again.status).toBe(409);
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

describe('specifications suppliers volunteer', () => {
  /** An offer carrying extra fields the template never asked for. */
  async function offerWithProposals(
    vendorId: string,
    proposals: { label: string; value: string }[],
    specs: Record<string, string> = { ram_gb: '16' },
  ) {
    const res = await api(app)
      .post('/api/v1/vendor-products')
      .set(auth(s.officeAdmin))
      .send({
        vendorId,
        name: `Offer ${stamp()}`,
        categoryId,
        subcategoryId: laptopSubId,
        unitPrice: 100000,
        gstPercent: 18,
        availableQuantity: 5,
        specs,
        proposedSpecs: proposals,
        availableFrom: new Date(Date.now() - 86_400_000).toISOString(),
        availableUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  it('records what a supplier offered that nobody asked for', async () => {
    const id = await offerWithProposals(vendorA, [{ label: 'NPU TOPS', value: '45' }]);
    const res = await api(app).get(`/api/v1/vendor-products/${id}`).set(auth(s.officeAdmin));
    expect(res.body.data.proposedSpecs).toHaveLength(1);
    expect(res.body.data.proposedSpecs[0].label).toBe('NPU TOPS');
    expect(res.body.data.proposedSpecs[0].normalizedKey).toBe('npu_tops');
  });

  it('refuses a suggestion the template already asks for', async () => {
    // The same fact twice - once compared, once not - is two answers free to
    // disagree with each other.
    const res = await api(app)
      .post('/api/v1/vendor-products')
      .set(auth(s.officeAdmin))
      .send({
        vendorId: vendorA,
        name: `Offer ${stamp()}`,
        categoryId,
        subcategoryId: laptopSubId,
        unitPrice: 100000,
        gstPercent: 18,
        availableQuantity: 5,
        proposedSpecs: [{ label: 'RAM', value: '32' }],
        availableFrom: new Date(Date.now() - 86_400_000).toISOString(),
        availableUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });
    expect(res.status).toBe(422);
  });

  it('counts suppliers, not offers', async () => {
    const key = `battery_wh_${stamp()}`;
    const label = key.replace(/_/g, ' ');
    // One supplier, three offers, all listing the same thing.
    await offerWithProposals(vendorA, [{ label, value: '57' }]);
    await offerWithProposals(vendorA, [{ label, value: '61' }]);
    await offerWithProposals(vendorA, [{ label, value: '70' }]);

    const one = await api(app)
      .get('/api/v1/spec-templates/proposals')
      .query({ categoryId, subcategoryId: laptopSubId })
      .set(auth(s.officeAdmin));
    const beforeGroup = one.body.data.find((g: { key: string }) => g.key === normalise(label));
    expect(beforeGroup.vendorCount, 'three offers from one supplier is one opinion').toBe(1);
    expect(beforeGroup.worthAsking).toBe(false);

    // A second supplier saying the same thing moves the count, not the rows.
    await offerWithProposals(vendorB, [{ label, value: '54' }]);
    const two = await api(app)
      .get('/api/v1/spec-templates/proposals')
      .query({ categoryId, subcategoryId: laptopSubId })
      .set(auth(s.officeAdmin));
    const afterGroup = two.body.data.find((g: { key: string }) => g.key === normalise(label));
    expect(afterGroup.vendorCount).toBe(2);
  });

  it('does not let a supplier see what other suppliers suggested', async () => {
    const res = await api(app)
      .get('/api/v1/spec-templates/proposals')
      .query({ categoryId })
      .set(vendorAuth());
    expect([403, 404]).toContain(res.status);
  });

  it('promotes a suggestion and brings the answers already given with it', async () => {
    // The half that makes promotion worth doing: without the backfill the new
    // field compares nothing until every supplier edits their offer again.
    const label = `Certification ${stamp()}`;
    const key = normalise(label);
    const first = await offerWithProposals(vendorA, [{ label, value: 'MIL-STD-810H' }]);
    const second = await offerWithProposals(vendorB, [{ label, value: 'IP54' }]);

    const promoted = await api(app)
      .post('/api/v1/spec-templates/promote')
      .set(auth(s.officeAdmin))
      .send({
        normalizedKey: key,
        categoryId,
        subcategoryId: laptopSubId,
        label: 'Certification',
        dataType: 'TEXT',
      });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(201);
    expect(promoted.body.data.offersBackfilled).toBe(2);

    for (const [id, value] of [[first, 'MIL-STD-810H'], [second, 'IP54']] as const) {
      const offer = await api(app).get(`/api/v1/vendor-products/${id}`).set(auth(s.officeAdmin));
      expect(offer.body.data.specs[key], 'answer moved into the compared specification').toBe(value);
      // Moved, not copied: the same fact must not appear twice.
      expect(offer.body.data.proposedSpecs.some((p: { normalizedKey: string }) => p.normalizedKey === key)).toBe(false);
    }
  });

  it('will not promote something already in the template', async () => {
    const res = await api(app)
      .post('/api/v1/spec-templates/promote')
      .set(auth(s.officeAdmin))
      .send({ normalizedKey: 'ram_gb', categoryId, label: 'RAM', dataType: 'NUMBER', intent: 'AT_LEAST' });
    expect(res.status).toBe(409);
  });

  it('does not let a supplier promote its own suggestion', async () => {
    const label = `Sneaky ${stamp()}`;
    await offerWithProposals(vendorA, [{ label, value: 'yes' }]);
    const res = await api(app)
      .post('/api/v1/spec-templates/promote')
      .set(vendorAuth())
      .send({ normalizedKey: normalise(label), categoryId, label: 'Sneaky', dataType: 'TEXT' });
    expect(res.status).toBe(403);
  });
});

describe('what a supplier is offered on its dashboard', () => {
  it('offers no tile that leads somewhere it cannot open', async () => {
    // The failure this prevents: two tiles reading zero, both linking to pages
    // that answer "you do not have permission". A supplier holds neither
    // assets:read nor requests:read.
    const res = await api(app).get('/api/v1/dashboard').set(vendorAuth());
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const keys = res.body.data.tiles.map((t: { key: string }) => t.key);
    expect(keys).not.toContain('my-assets');
    expect(keys).not.toContain('my-open-requests');
  });

  it('offers tiles about the catalogue instead', async () => {
    const res = await api(app).get('/api/v1/dashboard').set(vendorAuth());
    const keys = res.body.data.tiles.map((t: { key: string }) => t.key);
    expect(keys).toContain('vendor-live-offers');
    expect(keys).toContain('vendor-awaiting-review');
    expect(keys).toContain('vendor-needs-you');
  });

  it('still gives an employee their own kit and requests', async () => {
    // The gate must not take these away from the people they were built for.
    const res = await api(app).get('/api/v1/dashboard').set(auth(s.employee));
    const keys = res.body.data.tiles.map((t: { key: string }) => t.key);
    expect(keys).toContain('my-assets');
    expect(keys).toContain('my-open-requests');
  });

  it('counts only that supplier’s own offers', async () => {
    // Vendor B's offers must never reach Vendor A's numbers.
    await liveOffer(vendorB, { ram_gb: '32' });
    const res = await api(app).get('/api/v1/dashboard').set(vendorAuth());
    const live = res.body.data.tiles.find((t: { key: string }) => t.key === 'vendor-live-offers');

    const mine = await prisma.vendorProduct.count({
      where: { vendorId: vendorA, status: 'APPROVED', deletedAt: null, availableUntil: { gt: new Date() } },
    });
    expect(live.value).toBe(mine);
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
