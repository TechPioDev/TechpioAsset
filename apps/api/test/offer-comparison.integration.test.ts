import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';

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

describe('a supplier account nobody linked to a supplier', () => {
  let unlinkedToken = '';

  beforeAll(async () => {
    // The VENDOR role without a vendorId: the setup step people forget.
    const companyId = s.superAdmin.user.companyId;
    const role = await prisma.role.findFirst({ where: { companyId, key: 'VENDOR', deletedAt: null } });
    const template = await prisma.user.findFirstOrThrow({
      where: { companyId, email: 'employee@techpioasset.dev' },
      select: { passwordHash: true },
    });
    const email = `unlinked-${stamp()}@example.com`;
    await prisma.user.create({
      data: {
        companyId,
        email,
        passwordHash: template.passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        roles: { create: { roleId: role!.id } },
      },
    });
    const login = await api(app).post('/api/v1/auth/login').send({ email, password: 'TechpioDemo!2026' });
    unlinkedToken = login.body?.data?.accessToken ?? '';
    expect(unlinkedToken, 'the unlinked vendor can still sign in').toBeTruthy();
  });

  it('is refused, and told why, rather than shown a server error', async () => {
    // Fail closed is right - the alternative hands one supplier every
    // competitor's prices. But a bare 500 leaves them with nothing to act on.
    const res = await api(app)
      .get('/api/v1/vendor-products')
      .set({ Authorization: `Bearer ${unlinkedToken}` });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.detail ?? res.body.title).toContain('not linked to a supplier');
  });

  it('never falls back to showing it everybody else’s offers', async () => {
    await liveOffer(vendorA, { ram_gb: '16' });
    const res = await api(app)
      .get('/api/v1/vendor-products')
      .set({ Authorization: `Bearer ${unlinkedToken}` });
    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
  });
});

describe('a supplier maintaining its own company details', () => {
  it('can read its own record', async () => {
    const res = await api(app).get('/api/v1/vendors/me').set(vendorAuth());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.id).toBe(vendorA);
  });

  it('never sees the buyer’s internal notes about it', async () => {
    // The one field a supplier must not read: it is where remarks about this
    // supplier are kept.
    await prisma.vendor.update({
      where: { id: vendorA },
      data: { notes: 'Slow to deliver, chase weekly' },
    });
    const res = await api(app).get('/api/v1/vendors/me').set(vendorAuth());
    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('chase weekly');
  });

  it('can update its contact details', async () => {
    const res = await api(app)
      .patch('/api/v1/vendors/me')
      .set(vendorAuth())
      .send({ contactPhone: '+91 98765 43210', city: 'Bengaluru' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.contactPhone).toBe('+91 98765 43210');
  });

  it('cannot rename itself or reactivate itself', async () => {
    // Identity and standing are the buyer's record of the supplier. Rejected
    // by the schema rather than ignored, so a caller is told rather than
    // quietly having half its request dropped.
    for (const body of [{ name: 'Something Else Ltd' }, { isActive: true }, { code: 'NEWCODE' }]) {
      const res = await api(app).patch('/api/v1/vendors/me').set(vendorAuth()).send(body);
      expect(res.status, `should refuse ${JSON.stringify(body)}`).toBe(422);
    }
  });

  it('reaches only its own record, with no id to tamper with', async () => {
    // There is no /vendors/:id a supplier can call, and /vendors/me resolves
    // from the account's link - so Vendor B is unreachable by construction.
    const res = await api(app).get('/api/v1/vendors/me').set(vendorAuth());
    expect(res.body.data.id).not.toBe(vendorB);
  });

  it('is refused for internal staff, who have the full vendors screen', async () => {
    const res = await api(app).get('/api/v1/vendors/me').set(auth(s.officeAdmin));
    expect([403, 404]).toContain(res.status);
  });
});

describe('a supplier changing a live offer', () => {
  it('may edit an approved offer, which is the routine job', async () => {
    // The UI once hid Edit on anything but a draft, which hid it on exactly the
    // offers a supplier most needs to change. This pins the server's answer so
    // the screens cannot quietly become stricter than it again.
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    const res = await api(app)
      .patch(`/api/v1/vendor-products/${id}`)
      .set(vendorAuth())
      .send({ availableQuantity: 42 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.availableQuantity).toBe(42);
  });

  it('sends it back for review when the price changes', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    const res = await api(app)
      .patch(`/api/v1/vendor-products/${id}`)
      .set(vendorAuth())
      .send({ unitPrice: 123456 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // What was approved was a price, not a row.
    expect(res.body.data.status).toBe('PENDING_REVIEW');
  });

  it('leaves it live when only the stock figure changes', async () => {
    // Otherwise every restock would queue for a buyer's attention.
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    const res = await api(app)
      .patch(`/api/v1/vendor-products/${id}`)
      .set(vendorAuth())
      .send({ availableQuantity: 7 });
    expect(res.body.data.status).toBe('APPROVED');
  });

  it('still refuses to let a supplier edit a competitor’s offer', async () => {
    const theirs = await liveOffer(vendorB, { ram_gb: '16' });
    const res = await api(app)
      .patch(`/api/v1/vendor-products/${theirs}`)
      .set(vendorAuth())
      .send({ availableQuantity: 1 });
    expect([403, 404]).toContain(res.status);
  });
});

describe('keeping an offer on sale, and copying it', () => {
  it('extends the end date without sending the offer back for review', async () => {
    // Every offer carries an end date, and a supplier who is still selling the
    // thing has to move it or the catalogue quietly empties. Nothing about the
    // product changed, so the approval stands - if this ever regressed, every
    // renewal would queue for a buyer.
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    const later = new Date(Date.now() + 120 * 86_400_000).toISOString();
    const res = await api(app)
      .patch(`/api/v1/vendor-products/${id}`)
      .set(vendorAuth())
      .send({ availableUntil: later });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
    expect(new Date(res.body.data.availableUntil).toISOString()).toBe(later);
  });

  it('copies an offer into a fresh draft, with no pictures carried over', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    const res = await api(app).post(`/api/v1/vendor-products/${id}/duplicate`).set(vendorAuth());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.id).not.toBe(id);
    // A draft, because a variant is a new thing to review - and named so the
    // supplier can tell the two apart in the list before editing it.
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.name).toContain('(copy)');
    expect(res.body.data.specs).toEqual({ ram_gb: '16' });

    const copy = await prisma.vendorProduct.findUniqueOrThrow({
      where: { id: res.body.data.id },
      include: { images: true },
    });
    expect(copy.images).toHaveLength(0);
    expect(copy.vendorId).toBe(vendorA);
  });

  it('refuses to copy a competitor’s offer', async () => {
    const theirs = await liveOffer(vendorB, { ram_gb: '16' });
    const res = await api(app)
      .post(`/api/v1/vendor-products/${theirs}/duplicate`)
      .set(vendorAuth());
    expect([403, 404]).toContain(res.status);
  });
});

describe('when a company stops reviewing supplier offers', () => {
  async function setPolicy(policy: 'REVIEW_REQUIRED' | 'PUBLISH_IMMEDIATELY') {
    const res = await api(app)
      .patch('/api/v1/company')
      .set(auth(s.superAdmin))
      .send({ vendorOfferPolicy: policy });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data;
  }

  /** A draft complete enough to be submitted: a picture and the required specs. */
  async function submittable(vendorId: string) {
    const id = await offer(vendorId, { ram_gb: '16' });
    await prisma.vendorProductImage.create({
      data: {
        companyId: s.officeAdmin.user.companyId,
        vendorProductId: id,
        storageKey: `test/${id}`,
        originalName: 'front.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        sha256: `test-${id}`,
        isPrimary: true,
        sortOrder: 0,
      },
    });
    return id;
  }

  afterEach(async () => {
    await setPolicy('REVIEW_REQUIRED');
  });

  it('defaults to reviewing, so no tenant’s workflow changes by itself', async () => {
    const res = await api(app).get('/api/v1/vendor-products/meta/policy').set(vendorAuth());
    expect(res.status).toBe(200);
    expect(res.body.data.policy).toBe('REVIEW_REQUIRED');
  });

  it('publishes a submitted offer at once once review is switched off', async () => {
    await setPolicy('PUBLISH_IMMEDIATELY');
    const id = await submittable(vendorA);
    const res = await api(app).post(`/api/v1/vendor-products/${id}/submit`).set(vendorAuth());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe('APPROVED');
  });

  it('still refuses an offer with no picture, because that gate is not the review', async () => {
    // The quality gate protects the buyer, not the reviewer: an offer with no
    // picture and blank specs wastes the buyer's time either way.
    await setPolicy('PUBLISH_IMMEDIATELY');
    const id = await offer(vendorA, { ram_gb: '16' });
    const res = await api(app).post(`/api/v1/vendor-products/${id}/submit`).set(vendorAuth());
    expect(res.status).toBe(422);
  });

  it('leaves an edited live offer live, rather than queueing it for nobody', async () => {
    await setPolicy('PUBLISH_IMMEDIATELY');
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    const res = await api(app)
      .patch(`/api/v1/vendor-products/${id}`)
      .set(vendorAuth())
      .send({ unitPrice: 111222 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Under review this becomes PENDING_REVIEW. With no reviewer, that would
    // take a live offer off sale until a queue nobody works is emptied.
    expect(res.body.data.status).toBe('APPROVED');
  });

  it('publishes whatever was already waiting when review is switched off', async () => {
    const id = await submittable(vendorA);
    await api(app).post(`/api/v1/vendor-products/${id}/submit`).set(vendorAuth());
    expect(
      (await prisma.vendorProduct.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('PENDING_REVIEW');

    await setPolicy('PUBLISH_IMMEDIATELY');

    // Otherwise it waits out of sight on a queue that no longer appears anywhere.
    expect((await prisma.vendorProduct.findUniqueOrThrow({ where: { id } })).status).toBe(
      'APPROVED',
    );
  });

  it('goes back to reviewing new submissions when it is switched on again', async () => {
    await setPolicy('PUBLISH_IMMEDIATELY');
    await setPolicy('REVIEW_REQUIRED');
    const id = await submittable(vendorA);
    const res = await api(app).post(`/api/v1/vendor-products/${id}/submit`).set(vendorAuth());
    expect(res.body.data.status).toBe('PENDING_REVIEW');
  });
});

describe('the chain from a listing to a physical unit', () => {
  it('counts the units a listing has put into service, and shows the supplier only the count', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    const companyId = s.officeAdmin.user.companyId;
    const category = await prisma.category.findFirstOrThrow({ where: { companyId } });

    // Two units of this listing, one of something else.
    await prisma.asset.createMany({
      data: [1, 2].map((n) => ({
        companyId,
        assetTag: `CHAIN-${stamp()}-${n}`,
        name: 'Unit from the listing',
        categoryId: category.id,
        qrToken: `chain-${stamp()}-${n}`,
        status: 'IN_USE' as const,
        vendorProductId: id,
      })),
    });
    await prisma.asset.create({
      data: {
        companyId,
        assetTag: `CHAIN-OTHER-${stamp()}`,
        name: 'Nothing to do with it',
        categoryId: category.id,
        qrToken: `chain-other-${stamp()}`,
        status: 'IN_USE',
      },
    });

    const res = await api(app).get(`/api/v1/vendor-products/${id}`).set(vendorAuth());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data._count.assets).toBe(2);
    // The count, and nothing about where any of it went.
    expect(JSON.stringify(res.body.data)).not.toContain('CHAIN-');
  });

  it('refuses to delete a listing that has physical units behind it', async () => {
    // Section 26's rule, enforced by the database rather than by remembering:
    // a product with assets is archived, never removed.
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    const companyId = s.officeAdmin.user.companyId;
    const category = await prisma.category.findFirstOrThrow({ where: { companyId } });
    await prisma.asset.create({
      data: {
        companyId,
        assetTag: `CHAIN-KEEP-${stamp()}`,
        name: 'In service',
        categoryId: category.id,
        qrToken: `chain-keep-${stamp()}`,
        status: 'IN_USE',
        vendorProductId: id,
      },
    });

    await expect(prisma.vendorProduct.delete({ where: { id } })).rejects.toThrow();

    // Withdrawing it is still fine - that is a soft delete, and the unit keeps
    // its provenance.
    const withdrawn = await api(app).delete(`/api/v1/vendor-products/${id}`).set(vendorAuth());
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
    const asset = await prisma.asset.findFirstOrThrow({ where: { vendorProductId: id } });
    expect(asset.vendorProductId).toBe(id);
  });

  it('still refuses a supplier the asset register itself', async () => {
    const res = await api(app).get('/api/v1/assets').set(vendorAuth());
    expect(res.status).toBe(403);
  });
});

describe('the identifiers a listing carries (v2.48)', () => {
  it('gives every new listing a readable code of its own', async () => {
    const res = await api(app)
      .post('/api/v1/vendor-products')
      .set(auth(s.officeAdmin))
      .send({
        vendorId: vendorA,
        name: `Coded ${stamp()}`,
        brand: 'Dell',
        model: 'Latitude 5420',
        categoryId,
        unitPrice: 100000,
        gstPercent: 18,
        availableQuantity: 5,
        specs: { ram_gb: '16' },
        availableFrom: new Date(Date.now() - 86_400_000).toISOString(),
        availableUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // Category, make, model, and which of that make and model this is.
    expect(res.body.data.productCode).toMatch(/^[A-Z]{3}-DELL-5420-\d{3}$/);
  });

  it('counts up rather than reusing a number when the same model is listed twice', async () => {
    const make = async () =>
      (
        await api(app)
          .post('/api/v1/vendor-products')
          .set(auth(s.officeAdmin))
          .send({
            vendorId: vendorA,
            name: `Series ${stamp()}`,
            brand: 'Lenovo',
            model: 'ThinkPad T14',
            categoryId,
            unitPrice: 90000,
            gstPercent: 18,
            availableQuantity: 5,
            specs: { ram_gb: '16' },
            availableFrom: new Date(Date.now() - 86_400_000).toISOString(),
            availableUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          })
      ).body.data.productCode as string;

    const first = await make();
    const second = await make();
    expect(first).not.toBe(second);
    expect(Number(second.slice(-3))).toBe(Number(first.slice(-3)) + 1);
  });

  it('refuses a SKU the same supplier is already using, and says which listing has it', async () => {
    const sku = `SKU-${stamp()}`;
    const first = await api(app)
      .post('/api/v1/vendor-products')
      .set(vendorAuth())
      .send({
        name: `First ${stamp()}`,
        vendorSku: sku,
        categoryId,
        unitPrice: 1000,
        gstPercent: 18,
        availableQuantity: 1,
        specs: { ram_gb: '8' },
        availableFrom: new Date(Date.now() - 86_400_000).toISOString(),
        availableUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    const clash = await api(app)
      .post('/api/v1/vendor-products')
      .set(vendorAuth())
      .send({
        name: `Second ${stamp()}`,
        vendorSku: sku,
        categoryId,
        unitPrice: 1000,
        gstPercent: 18,
        availableQuantity: 1,
        specs: { ram_gb: '8' },
        availableFrom: new Date(Date.now() - 86_400_000).toISOString(),
        availableUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });
    expect(clash.status).toBe(409);
    // Actionable: it names the listing holding the SKU, not a constraint.
    expect(clash.body.detail).toContain('First');
  });

  it('lets a different supplier use the same SKU, because it is their own namespace', async () => {
    const sku = `SHARED-${stamp()}`;
    const mine = await api(app)
      .post('/api/v1/vendor-products')
      .set(auth(s.officeAdmin))
      .send({
        vendorId: vendorA,
        name: `A ${stamp()}`,
        vendorSku: sku,
        categoryId,
        unitPrice: 1000,
        gstPercent: 18,
        availableQuantity: 1,
        specs: { ram_gb: '8' },
        availableFrom: new Date(Date.now() - 86_400_000).toISOString(),
        availableUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);

    const theirs = await api(app)
      .post('/api/v1/vendor-products')
      .set(auth(s.officeAdmin))
      .send({
        vendorId: vendorB,
        name: `B ${stamp()}`,
        vendorSku: sku,
        categoryId,
        unitPrice: 1000,
        gstPercent: 18,
        availableQuantity: 1,
        specs: { ram_gb: '8' },
        availableFrom: new Date(Date.now() - 86_400_000).toISOString(),
        availableUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });
    // Two suppliers may both call something "5420" and neither is wrong.
    expect(theirs.status, JSON.stringify(theirs.body)).toBe(201);
  });

  it('gives a copy its own code and no SKU, so it cannot collide with the original', async () => {
    const sku = `ORIG-${stamp()}`;
    const original = await api(app)
      .post('/api/v1/vendor-products')
      .set(vendorAuth())
      .send({
        name: `Original ${stamp()}`,
        brand: 'HP',
        model: 'EliteBook 840',
        vendorSku: sku,
        categoryId,
        unitPrice: 1000,
        gstPercent: 18,
        availableQuantity: 1,
        specs: { ram_gb: '8' },
        availableFrom: new Date(Date.now() - 86_400_000).toISOString(),
        availableUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });
    expect(original.status, JSON.stringify(original.body)).toBe(201);

    const copy = await api(app)
      .post(`/api/v1/vendor-products/${original.body.data.id}/duplicate`)
      .set(vendorAuth());
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    expect(copy.body.data.productCode).not.toBe(original.body.data.productCode);
    // Carrying the SKU over would collide on the very next save.
    expect(copy.body.data.vendorSku).toBeNull();
  });
});

describe('the paperwork a product comes with (v2.49)', () => {
  /** A real PDF: the %PDF signature is what the validator actually reads. */
  const pdf = () => Buffer.from('%PDF-1.7 paperwork');

  it('accepts a datasheet and lists it back without leaking where it is stored', async () => {
    const id = await offer(vendorA, { ram_gb: '16' });
    const res = await api(app)
      .post(`/api/v1/vendor-products/${id}/documents`)
      .set(vendorAuth())
      .field('kind', 'DATASHEET')
      .field('title', 'Latitude 5420 datasheet')
      .attach('file', pdf(), { filename: 'sheet.pdf', contentType: 'application/pdf' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.kind).toBe('DATASHEET');

    const list = await api(app).get(`/api/v1/vendor-products/${id}/documents`).set(vendorAuth());
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    // The internal bucket layout is not the caller's business.
    expect(JSON.stringify(list.body.data)).not.toContain('storageKey');
  });

  it('refuses a Word file even when it is called a PDF', async () => {
    // An Office file is a zip that can carry macros and these come from outside
    // the company. The bytes decide, never the name or the declared type.
    const id = await offer(vendorA, { ram_gb: '16' });
    const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
    const res = await api(app)
      .post(`/api/v1/vendor-products/${id}/documents`)
      .set(vendorAuth())
      .field('kind', 'USER_MANUAL')
      .attach('file', docx, { filename: 'manual.pdf', contentType: 'application/pdf' });
    expect([415, 422]).toContain(res.status);
  });

  it('sends the file back as an attachment rather than something the browser runs', async () => {
    const id = await offer(vendorA, { ram_gb: '16' });
    const added = await api(app)
      .post(`/api/v1/vendor-products/${id}/documents`)
      .set(vendorAuth())
      .field('kind', 'COMPLIANCE_CERTIFICATE')
      .attach('file', pdf(), { filename: 'cert.pdf', contentType: 'application/pdf' });
    expect(added.status).toBe(201);

    const bytes = await api(app)
      .get(`/api/v1/vendor-products/${id}/documents/${added.body.data.id}`)
      .set(vendorAuth());
    expect(bytes.status).toBe(200);
    // A PDF rendered inline is a PDF running in our origin.
    expect(bytes.headers['content-disposition']).toContain('attachment');
  });

  it('will not let a supplier read a competitor’s paperwork', async () => {
    const theirs = await offer(vendorB, { ram_gb: '16' });
    const added = await api(app)
      .post(`/api/v1/vendor-products/${theirs}/documents`)
      .set(auth(s.officeAdmin))
      .field('kind', 'BROCHURE')
      .attach('file', pdf(), { filename: 'b.pdf', contentType: 'application/pdf' });
    expect(added.status, JSON.stringify(added.body)).toBe(201);

    const peek = await api(app)
      .get(`/api/v1/vendor-products/${theirs}/documents`)
      .set(vendorAuth());
    expect([403, 404]).toContain(peek.status);

    const grab = await api(app)
      .get(`/api/v1/vendor-products/${theirs}/documents/${added.body.data.id}`)
      .set(vendorAuth());
    expect([403, 404]).toContain(grab.status);
  });

  it('keeps a removed document rather than destroying it', async () => {
    const id = await offer(vendorA, { ram_gb: '16' });
    const added = await api(app)
      .post(`/api/v1/vendor-products/${id}/documents`)
      .set(vendorAuth())
      .field('kind', 'WARRANTY')
      .attach('file', pdf(), { filename: 'w.pdf', contentType: 'application/pdf' });
    const documentId = added.body.data.id as string;

    const removed = await api(app)
      .delete(`/api/v1/vendor-products/${id}/documents/${documentId}`)
      .set(vendorAuth());
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);

    const list = await api(app).get(`/api/v1/vendor-products/${id}/documents`).set(vendorAuth());
    expect(list.body.data).toHaveLength(0);
    // Paperwork that justified a purchase has to survive it.
    const row = await prisma.vendorProductDocument.findUniqueOrThrow({ where: { id: documentId } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.storageKey).toBeTruthy();
  });
});

describe('telling the supplier what happened (v2.50)', () => {
  const notificationsFor = (userId: string, type: string) =>
    prisma.notification.findMany({
      where: { userId, type: type as never },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { title: true, body: true, entityId: true },
    });

  /** The supplier account the vendorAuth() token belongs to. */
  async function supplierUserId(): Promise<string> {
    const user = await prisma.user.findFirstOrThrow({
      where: { vendorId: vendorA, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    return user.id;
  }

  it('tells the supplier when its offer is approved', async () => {
    const id = await offer(vendorA, { ram_gb: '16' });
    await prisma.vendorProduct.update({ where: { id }, data: { status: 'PENDING_REVIEW' } });
    await prisma.vendorProductImage.create({
      data: {
        companyId: s.officeAdmin.user.companyId,
        vendorProductId: id,
        storageKey: `t/${id}`,
        originalName: 'a.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        sha256: `sha-${id}`,
        isPrimary: true,
        sortOrder: 0,
      },
    });

    const res = await api(app)
      .post(`/api/v1/vendor-products/${id}/review`)
      .set(auth(s.itAdmin))
      .send({ decision: 'APPROVED' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const notes = await notificationsFor(await supplierUserId(), 'VENDOR_PRODUCT_APPROVED');
    expect(notes.some((n) => n.entityId === id)).toBe(true);
  });

  it('carries the reason when an offer is turned down', async () => {
    const id = await offer(vendorA, { ram_gb: '16' });
    await prisma.vendorProduct.update({ where: { id }, data: { status: 'PENDING_REVIEW' } });

    const res = await api(app)
      .post(`/api/v1/vendor-products/${id}/review`)
      .set(auth(s.itAdmin))
      .send({ decision: 'REJECTED', comments: 'The RAM figure does not match the datasheet' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const notes = await notificationsFor(await supplierUserId(), 'VENDOR_PRODUCT_REJECTED');
    const mine = notes.find((n) => n.entityId === id);
    // Without the reason this is just bad news and the supplier has to ask.
    expect(mine?.body).toContain('does not match the datasheet');
  });

  it('tells the supplier when a buyer chooses its offer', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    const res = await api(app)
      .post(`/api/v1/vendor-products/${id}/select`)
      .set(auth(s.officeAdmin))
      .send({ quantity: 3 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const notes = await notificationsFor(await supplierUserId(), 'VENDOR_OFFER_SELECTED');
    const mine = notes.find((n) => n.entityId === id);
    expect(mine).toBeTruthy();
    expect(mine?.body).toContain('3 units');
  });

  it('never tells one supplier about another’s offer', async () => {
    const theirs = await liveOffer(vendorB, { ram_gb: '16' });
    await api(app)
      .post(`/api/v1/vendor-products/${theirs}/select`)
      .set(auth(s.officeAdmin))
      .send({ quantity: 1 });

    const mine = await notificationsFor(await supplierUserId(), 'VENDOR_OFFER_SELECTED');
    expect(mine.some((n) => n.entityId === theirs)).toBe(false);
  });
});

describe('the nightly sweep that chases a supplier (v2.50)', () => {
  it('warns about an offer coming off sale, once a week and not once a night', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    // Three days left: inside the week the sweep looks at.
    await prisma.vendorProduct.update({
      where: { id },
      data: { availableUntil: new Date(Date.now() + 3 * 86_400_000) },
    });

    const sweep = app.get(AlertSweepService);
    await sweep.runVendorOfferSweep();

    const user = await prisma.user.findFirstOrThrow({
      where: { vendorId: vendorA, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    const first = await prisma.notification.count({
      where: { userId: user.id, type: 'VENDOR_PRODUCT_EXPIRING', entityId: id },
    });
    expect(first).toBe(1);

    // A daily reminder about a date three weeks out is how people learn to
    // filter you, so the second pass must stay quiet.
    await sweep.runVendorOfferSweep();
    const second = await prisma.notification.count({
      where: { userId: user.id, type: 'VENDOR_PRODUCT_EXPIRING', entityId: id },
    });
    expect(second).toBe(1);
  });

  it('warns about an approved offer with nothing left to sell', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    await prisma.vendorProduct.update({
      where: { id },
      data: {
        availableQuantity: 0,
        // Well inside its dates, so this is only about the stock.
        availableUntil: new Date(Date.now() + 90 * 86_400_000),
      },
    });

    await app.get(AlertSweepService).runVendorOfferSweep();

    const user = await prisma.user.findFirstOrThrow({
      where: { vendorId: vendorA, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    const raised = await prisma.notification.findFirst({
      where: { userId: user.id, type: 'VENDOR_PRODUCT_OUT_OF_STOCK', entityId: id },
      select: { body: true },
    });
    expect(raised?.body).toContain('no units available');
  });
});

describe('stock depth on a listing (v2.51)', () => {
  const patch = (id: string, body: unknown) =>
    api(app).patch(`/api/v1/vendor-products/${id}`).set(vendorAuth()).send(body);

  it('takes committed units off what is left for the next buyer', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    await prisma.vendorProduct.update({ where: { id }, data: { availableQuantity: 10 } });

    const chosen = await api(app)
      .post(`/api/v1/vendor-products/${id}/select`)
      .set(auth(s.officeAdmin))
      .send({ quantity: 4 });
    expect(chosen.status, JSON.stringify(chosen.body)).toBe(201);

    const res = await api(app).get(`/api/v1/vendor-products/${id}`).set(vendorAuth());
    expect(res.status).toBe(200);
    expect(res.body.data.availableQuantity).toBe(10);
    expect(res.body.data.reservedQuantity).toBe(4);
    // Showing the reserved four as available is how two buyers are promised
    // the same units.
    expect(res.body.data.sellableQuantity).toBe(6);
    expect(res.body.data.stockStatus).toBe('IN_STOCK');
  });

  it('is out of stock when everything left is spoken for', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    await prisma.vendorProduct.update({ where: { id }, data: { availableQuantity: 2 } });
    await api(app)
      .post(`/api/v1/vendor-products/${id}/select`)
      .set(auth(s.officeAdmin))
      .send({ quantity: 2 });

    const res = await api(app).get(`/api/v1/vendor-products/${id}`).set(vendorAuth());
    expect(res.body.data.sellableQuantity).toBe(0);
    expect(res.body.data.stockStatus).toBe('OUT_OF_STOCK');
  });

  it('records every quantity move, and only when it actually moves', async () => {
    const id = await offer(vendorA, { ram_gb: '16' });
    expect((await patch(id, { availableQuantity: 40 })).status).toBe(200);
    expect((await patch(id, { availableQuantity: 12 })).status).toBe(200);
    // Saving without touching the number is not a stock change.
    expect((await patch(id, { leadTimeDays: 5 })).status).toBe(200);

    const res = await api(app).get(`/api/v1/vendor-products/${id}`).set(vendorAuth());
    const moves = res.body.data.stockChanges as {
      previousQuantity: number;
      newQuantity: number;
      delta: number;
    }[];
    expect(moves).toHaveLength(2);
    // Newest first.
    expect(moves[0]).toMatchObject({ previousQuantity: 40, newQuantity: 12, delta: -28 });
    expect(moves[1]!.newQuantity).toBe(40);
  });

  it('refuses a negative quantity', async () => {
    const id = await offer(vendorA, { ram_gb: '16' });
    const res = await patch(id, { availableQuantity: -5 });
    expect(res.status).toBe(422);
  });

  it('warns the supplier on the way past its own threshold, and not again after', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    await prisma.vendorProduct.update({
      where: { id },
      data: { availableQuantity: 40, lowStockThreshold: 5 },
    });
    const user = await prisma.user.findFirstOrThrow({
      where: { vendorId: vendorA, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    const countLow = () =>
      prisma.notification.count({
        where: { userId: user.id, type: 'VENDOR_PRODUCT_LOW_STOCK', entityId: id },
      });

    expect((await patch(id, { availableQuantity: 4 })).status).toBe(200);
    expect(await countLow()).toBe(1);

    // Already low yesterday is not news today.
    expect((await patch(id, { availableQuantity: 3 })).status).toBe(200);
    expect(await countLow()).toBe(1);
  });

  it('has no low band at all until the supplier sets one', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    await prisma.vendorProduct.update({ where: { id }, data: { availableQuantity: 40 } });
    const user = await prisma.user.findFirstOrThrow({
      where: { vendorId: vendorA, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });

    expect((await patch(id, { availableQuantity: 1 })).status).toBe(200);
    // Guessing a threshold would put every small supplier permanently in amber.
    expect(
      await prisma.notification.count({
        where: { userId: user.id, type: 'VENDOR_PRODUCT_LOW_STOCK', entityId: id },
      }),
    ).toBe(0);

    const res = await api(app).get(`/api/v1/vendor-products/${id}`).set(vendorAuth());
    expect(res.body.data.stockStatus).toBe('IN_STOCK');
  });

  it('leaves the threshold alone when an edit does not mention it', async () => {
    // The web form sends null for a blank box, which is an explicit "no
    // warning". Omitting the field entirely must mean "unchanged", or every
    // unrelated edit would quietly clear a line the supplier drew.
    const id = await offer(vendorA, { ram_gb: '16' });
    expect((await patch(id, { lowStockThreshold: 8 })).status).toBe(200);
    expect((await patch(id, { leadTimeDays: 3 })).status).toBe(200);

    const kept = await prisma.vendorProduct.findUniqueOrThrow({
      where: { id },
      select: { lowStockThreshold: true },
    });
    expect(kept.lowStockThreshold).toBe(8);

    // And null really does clear it.
    expect((await patch(id, { lowStockThreshold: null })).status).toBe(200);
    const cleared = await prisma.vendorProduct.findUniqueOrThrow({
      where: { id },
      select: { lowStockThreshold: true },
    });
    expect(cleared.lowStockThreshold).toBeNull();
  });

  it('never shows one supplier another’s stock position', async () => {
    const theirs = await liveOffer(vendorB, { ram_gb: '16' });
    const res = await api(app).get(`/api/v1/vendor-products/${theirs}`).set(vendorAuth());
    expect([403, 404]).toContain(res.status);
  });
});

describe('bulk import (v2.52)', () => {
  const HEADER = 'Product name,Category,Brand,Model,SKU,Unit price,GST %,Available quantity';

  /** The category this suite created, by the name the sheet must use. */
  let categoryName = '';
  beforeAll(async () => {
    const c = await prisma.category.findUniqueOrThrow({
      where: { id: categoryId },
      select: { name: true },
    });
    categoryName = c.name;
  });

  const upload = (csv: string, commit: boolean) =>
    api(app)
      .post('/api/v1/vendor-products/import')
      .set(vendorAuth())
      .field('commit', commit ? 'true' : 'false')
      .attach('file', Buffer.from(csv, 'utf8'), {
        filename: 'catalogue.csv',
        contentType: 'text/csv',
      });

  it('says what would happen without writing anything', async () => {
    const before = await prisma.vendorProduct.count({ where: { vendorId: vendorA } });
    const csv = [
      HEADER,
      `Preview laptop ${stamp()},${categoryName},Dell,Latitude 5420,,68000,18,10`,
    ].join('\n');

    const res = await upload(csv, false);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ totalRows: 1, valid: 1, failed: 0, imported: 0 });

    // Nothing written: that is the whole point of a preview.
    expect(await prisma.vendorProduct.count({ where: { vendorId: vendorA } })).toBe(before);
  });

  it('imports the rows that pass and names the ones that do not', async () => {
    const good = `Import good ${stamp()}`;
    const csv = [
      HEADER,
      `${good},${categoryName},Dell,Latitude 5420,,68000,18,10`,
      `,${categoryName},HP,x,,1000,18,1`,
      `Bad category ${stamp()},Nonsense Category,HP,x,,1000,18,1`,
      `Bad price ${stamp()},${categoryName},HP,x,,not-a-number,18,1`,
    ].join('\n');

    const res = await upload(csv, true);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const report = res.body.data;
    expect(report.totalRows).toBe(4);
    expect(report.imported).toBe(1);
    expect(report.failed).toBe(3);

    // Every failure names its line and says why, so it can be fixed and resent.
    const problems = (report.issues as { row: number; problem: string }[]).map((i) => i.problem);
    expect(problems).toContainEqual(expect.stringMatching(/No product name/));
    expect(problems).toContainEqual(expect.stringMatching(/No category called/));
    expect(problems).toContainEqual(expect.stringMatching(/not a number/));
    expect((report.issues as { row: number }[]).map((i) => i.row).sort()).toEqual([3, 4, 5]);

    const created = await prisma.vendorProduct.findFirstOrThrow({
      where: { vendorId: vendorA, name: good },
      select: { status: true, productCode: true, availableQuantity: true },
    });
    // A bulk upload is not a way round the picture and the required specs.
    expect(created.status).toBe('DRAFT');
    expect(created.productCode).toMatch(/-\d{3}$/);
    expect(created.availableQuantity).toBe(10);
  });

  it('catches a SKU that clashes inside the same file', async () => {
    const sku = `DUP-${stamp()}`;
    const csv = [
      HEADER,
      `First ${stamp()},${categoryName},Dell,A,${sku},1000,18,1`,
      `Second ${stamp()},${categoryName},Dell,B,${sku},1000,18,1`,
    ].join('\n');

    const res = await upload(csv, false);
    expect(res.body.data.valid).toBe(1);
    expect(res.body.data.failed).toBe(1);
    expect(res.body.data.issues[0].problem).toMatch(/also on row 2 of this file/);
  });

  it('catches a SKU the supplier is already using', async () => {
    const sku = `TAKEN-${stamp()}`;
    await api(app)
      .post('/api/v1/vendor-products')
      .set(vendorAuth())
      .send({
        name: `Existing ${stamp()}`,
        vendorSku: sku,
        categoryId,
        unitPrice: 1000,
        gstPercent: 18,
        availableQuantity: 1,
        availableFrom: new Date(Date.now() - 86_400_000).toISOString(),
        availableUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });

    const csv = [HEADER, `Clash ${stamp()},${categoryName},Dell,A,${sku},1000,18,1`].join('\n');
    const res = await upload(csv, false);
    expect(res.body.data.failed).toBe(1);
    expect(res.body.data.issues[0].problem).toMatch(/already have a product with the SKU/);
  });

  it('refuses a file that is not a spreadsheet at all', async () => {
    const res = await api(app)
      .post('/api/v1/vendor-products/import')
      .set(vendorAuth())
      .field('commit', 'false')
      .attach('file', Buffer.from([0x00, 0x01, 0x02, 0x03]), {
        filename: 'nope.csv',
        contentType: 'text/csv',
      });
    expect([400, 415, 422]).toContain(res.status);
  });

  it('will not let a supplier import into another supplier’s catalogue', async () => {
    const csv = [HEADER, `Sneaky ${stamp()},${categoryName},Dell,A,,1000,18,1`].join('\n');
    const res = await api(app)
      .post('/api/v1/vendor-products/import')
      .set(vendorAuth())
      .field('commit', 'true')
      .field('vendorId', vendorB)
      .attach('file', Buffer.from(csv, 'utf8'), {
        filename: 'c.csv',
        contentType: 'text/csv',
      });
    expect(res.status).toBe(403);
  });
});

describe('what became of the units bought from a listing (v2.53)', () => {
  async function unitsFor(productId: string, statuses: string[]) {
    const companyId = s.officeAdmin.user.companyId;
    const category = await prisma.category.findFirstOrThrow({ where: { companyId } });
    for (const [i, status] of statuses.entries()) {
      await prisma.asset.create({
        data: {
          companyId,
          assetTag: `ROLL-${stamp()}-${i}`,
          name: 'Unit from the listing',
          categoryId: category.id,
          qrToken: `roll-${stamp()}-${i}`,
          status: status as never,
          vendorProductId: productId,
        },
      });
    }
  }

  it('folds eighteen statuses into something a buyer can read', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    await unitsFor(id, ['IN_USE', 'IN_USE', 'ASSIGNED', 'AVAILABLE', 'DAMAGED', 'RETIRED']);

    const res = await api(app).get(`/api/v1/vendor-products/${id}`).set(auth(s.officeAdmin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.assetRollup).toMatchObject({
      inService: 3,
      available: 1,
      needsAttention: 1,
      gone: 1,
      total: 6,
    });
  });

  it('never shows the supplier how its units are faring', async () => {
    const id = await liveOffer(vendorA, { ram_gb: '16' });
    await unitsFor(id, ['DAMAGED', 'LOST', 'IN_USE']);

    const staff = await api(app).get(`/api/v1/vendor-products/${id}`).set(auth(s.officeAdmin));
    expect(staff.body.data.assetRollup.needsAttention).toBe(2);

    // The supplier keeps its own sales history - how many it supplied - and
    // learns nothing about how well its customer looks after them.
    const supplier = await api(app).get(`/api/v1/vendor-products/${id}`).set(vendorAuth());
    expect(supplier.status).toBe(200);
    expect(supplier.body.data.assetRollup).toBeUndefined();
    expect(supplier.body.data._count.assets).toBe(3);
  });

  it('sends the reader to exactly the assets it counted', async () => {
    // The rollup links to a filtered asset list. The filter has to exist, or
    // the link lands on the whole fleet and quietly lies about what it shows.
    const mine = await liveOffer(vendorA, { ram_gb: '16' });
    const other = await liveOffer(vendorA, { ram_gb: '32' });
    await unitsFor(mine, ['IN_USE', 'IN_USE']);
    await unitsFor(other, ['IN_USE']);

    const res = await api(app)
      .get(`/api/v1/assets?vendorProductId=${mine}&pageSize=50`)
      .set(auth(s.officeAdmin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data as { id: string }[];
    expect(rows).toHaveLength(2);
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
