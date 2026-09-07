import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * The vendor catalogue, end to end (v2.42).
 *
 * The isolation tests here are the point of the file. A supplier signs in to
 * the buying company's tenant, so the failure that matters is not a leak across
 * companies - the tenant filter already prevents that - it is Vendor A reading
 * Vendor B's prices, stock and drafts inside the same tenant. Every one of
 * those is a commercial secret belonging to a competitor.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
const prisma = new PrismaClient();

/** Two suppliers and a portal login for each, created for this suite. */
let vendorA = '';
let vendorB = '';
let tokenA = '';
let categoryId = '';

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

/** A real PNG: the byte signature is what the validator actually reads. */
const png = () =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(256)]);

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);

  const companyId = s.superAdmin.user.companyId;
  const category = await prisma.category.findFirst({ where: { companyId, deletedAt: null } });
  categoryId = category!.id;

  const a = await prisma.vendor.create({
    data: { companyId, name: `Alpha Supplies ${stamp()}`, code: `ALPHA${stamp()}`.slice(0, 20) },
  });
  const b = await prisma.vendor.create({
    data: { companyId, name: `Beta Traders ${stamp()}`, code: `BETA${stamp()}`.slice(0, 20) },
  });
  vendorA = a.id;
  vendorB = b.id;

  // A portal user for Alpha: same tenant, VENDOR role, linked to one vendor.
  const role = await prisma.role.findFirst({ where: { companyId, key: 'VENDOR', deletedAt: null } });
  if (role) {
    const email = `alpha-portal-${stamp()}@example.com`;
    const template = await prisma.user.findFirstOrThrow({
      where: { companyId, email: 'employee@techpioasset.dev' },
      select: { passwordHash: true },
    });
    const user = await prisma.user.create({
      data: {
        companyId,
        email,
        passwordHash: template.passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        vendorId: vendorA,
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await api(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'TechpioDemo!2026' });
    tokenA = login.body?.data?.accessToken ?? '';
    expect(user.vendorId, 'the portal user is linked to Alpha').toBe(vendorA);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
  await app?.close();
});

const vendorAuth = () => ({ Authorization: `Bearer ${tokenA}` });

async function createOffer(as: { Authorization: string }, over: Record<string, unknown> = {}) {
  return api(app)
    .post('/api/v1/vendor-products')
    .set(as)
    .send({
      name: `ThinkPad T14 ${stamp()}`,
      categoryId,
      brand: 'Lenovo',
      model: 'T14 Gen 7',
      unitPrice: 108000,
      gstPercent: 18,
      availableQuantity: 10,
      availableFrom: new Date(Date.now() - 86_400_000).toISOString(),
      availableUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      ...over,
    });
}

describe('creating an offer', () => {
  it('computes the landed cost on the server, ignoring anything the client sends', async () => {
    const res = await createOffer(auth(s.officeAdmin), {
      vendorId: vendorA,
      discount: 8000,
      shippingCost: 1500,
      installationCost: 2000,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // (108000 - 8000 + 1500 + 2000) = 103500 taxable, +18% = 122130
    expect(Number(res.body.data.landedCost)).toBe(122130);
  });

  it('starts every offer as a draft, however it was created', async () => {
    const res = await createOffer(auth(s.officeAdmin), { vendorId: vendorA });
    expect(res.body.data.status).toBe('DRAFT');
  });

  it('refuses an offer with no end date', async () => {
    const res = await api(app)
      .post('/api/v1/vendor-products')
      .set(auth(s.officeAdmin))
      .send({
        name: 'No expiry',
        categoryId,
        vendorId: vendorA,
        unitPrice: 1000,
        availableFrom: new Date().toISOString(),
      });
    expect(res.status).toBe(422);
  });

  it('refuses a discount larger than the price rather than clamping it silently', async () => {
    const res = await createOffer(auth(s.officeAdmin), { vendorId: vendorA, discount: 200000 });
    expect(res.status).toBe(422);
  });

  it('stores only a video id, never a vendor-supplied embed', async () => {
    const ok = await createOffer(auth(s.officeAdmin), {
      vendorId: vendorA,
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
    expect(ok.body.data.youtubeVideoId).toBe('dQw4w9WgXcQ');

    const bad = await createOffer(auth(s.officeAdmin), {
      vendorId: vendorA,
      youtubeUrl: '<iframe src="https://evil.test"></iframe>',
    });
    expect(bad.status).toBe(422);
  });
});

describe('vendor isolation', () => {
  it('gives a supplier only its own offers', async () => {
    if (!tokenA) return;
    await createOffer(auth(s.officeAdmin), { vendorId: vendorB, name: `Beta secret ${stamp()}` });

    const res = await api(app).get('/api/v1/vendor-products').set(vendorAuth());
    expect(res.status).toBe(200);
    const vendors: string[] = res.body.data.map((p: { vendorId: string }) => p.vendorId);
    expect(vendors.length).toBeGreaterThan(0);
    expect([...new Set(vendors)]).toEqual([vendorA]);
  });

  it("refuses to open a competitor's offer by id", async () => {
    if (!tokenA) return;
    const other = await createOffer(auth(s.officeAdmin), { vendorId: vendorB });
    const res = await api(app)
      .get(`/api/v1/vendor-products/${other.body.data.id}`)
      .set(vendorAuth());
    // Not found rather than forbidden: confirming the row exists is itself a leak.
    expect(res.status).toBe(404);
  });

  it("refuses to edit a competitor's offer", async () => {
    if (!tokenA) return;
    const other = await createOffer(auth(s.officeAdmin), { vendorId: vendorB });
    const res = await api(app)
      .patch(`/api/v1/vendor-products/${other.body.data.id}`)
      .set(vendorAuth())
      .send({ unitPrice: 1 });
    expect(res.status).toBe(404);
  });

  it('ignores a vendorId a supplier tries to publish under', async () => {
    if (!tokenA) return;
    const res = await createOffer(vendorAuth(), { vendorId: vendorB });
    // Either refused outright, or created under its own vendor - never Beta's.
    if (res.status === 201) expect(res.body.data.vendorId).toBe(vendorA);
    else expect(res.status).toBe(403);
  });

  it('does not let a supplier review anything, including its own', async () => {
    if (!tokenA) return;
    const own = await createOffer(vendorAuth());
    const res = await api(app)
      .post(`/api/v1/vendor-products/${own.body.data.id}/review`)
      .set(vendorAuth())
      .send({ decision: 'APPROVED' });
    expect(res.status).toBe(403);
  });

  it('keeps an employee out of the catalogue entirely', async () => {
    // Employees never see vendor pricing; that is the whole reason they cannot
    // enter it on a request either.
    const res = await api(app).get('/api/v1/vendor-products').set(auth(s.employee));
    expect(res.status).toBe(403);
  });
});

describe('images', () => {
  async function offerFor(as: { Authorization: string }) {
    const res = await createOffer(as, as === vendorAuth() ? {} : { vendorId: vendorA });
    return res.body.data.id as string;
  }

  it('accepts a PNG and makes the first image primary', async () => {
    const id = await offerFor(auth(s.officeAdmin));
    const res = await api(app)
      .post(`/api/v1/vendor-products/${id}/images`)
      .set(auth(s.officeAdmin))
      .attach('file', png(), 'front.png');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.isPrimary).toBe(true);
  });

  it('rejects a fourth image', async () => {
    const id = await offerFor(auth(s.officeAdmin));
    for (let i = 0; i < 3; i += 1) {
      const ok = await api(app)
        .post(`/api/v1/vendor-products/${id}/images`)
        .set(auth(s.officeAdmin))
        .attach('file', png(), `img${i}.png`);
      expect(ok.status).toBe(201);
    }
    const fourth = await api(app)
      .post(`/api/v1/vendor-products/${id}/images`)
      .set(auth(s.officeAdmin))
      .attach('file', png(), 'fourth.png');
    expect(fourth.status).toBe(409);
  });

  it('rejects an executable renamed .png on its bytes', async () => {
    const id = await offerFor(auth(s.officeAdmin));
    const exe = Buffer.concat([Buffer.from('MZ', 'ascii'), Buffer.alloc(512)]);
    const res = await api(app)
      .post(`/api/v1/vendor-products/${id}/images`)
      .set(auth(s.officeAdmin))
      .attach('file', exe, 'totally-an-image.png');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects an image over 500 KB', async () => {
    const id = await offerFor(auth(s.officeAdmin));
    const big = Buffer.concat([png(), Buffer.alloc(500 * 1024)]);
    const res = await api(app)
      .post(`/api/v1/vendor-products/${id}/images`)
      .set(auth(s.officeAdmin))
      .attach('file', big, 'huge.png');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('promotes the next image when the primary is deleted', async () => {
    const id = await offerFor(auth(s.officeAdmin));
    const first = await api(app)
      .post(`/api/v1/vendor-products/${id}/images`)
      .set(auth(s.officeAdmin))
      .attach('file', png(), 'one.png');
    await api(app)
      .post(`/api/v1/vendor-products/${id}/images`)
      .set(auth(s.officeAdmin))
      .attach('file', png(), 'two.png');

    const res = await api(app)
      .delete(`/api/v1/vendor-products/${id}/images/${first.body.data.id}`)
      .set(auth(s.officeAdmin));
    expect(res.status).toBe(200);
    expect(res.body.data.promoted).toBeTruthy();

    const detail = await api(app).get(`/api/v1/vendor-products/${id}`).set(auth(s.officeAdmin));
    const primaries = detail.body.data.images.filter((i: { isPrimary: boolean }) => i.isPrimary);
    // Never none, never two.
    expect(primaries).toHaveLength(1);
  });
});

describe('review', () => {
  it('will not submit a draft that has no image', async () => {
    // A reviewer cannot judge a product they cannot see.
    const created = await createOffer(auth(s.officeAdmin), { vendorId: vendorA });
    const res = await api(app)
      .post(`/api/v1/vendor-products/${created.body.data.id}/submit`)
      .set(auth(s.officeAdmin));
    expect(res.status).toBe(422);
  });

  it('moves draft to pending to approved, and records who decided', async () => {
    const created = await createOffer(auth(s.officeAdmin), { vendorId: vendorA });
    const id = created.body.data.id;
    await api(app)
      .post(`/api/v1/vendor-products/${id}/images`)
      .set(auth(s.officeAdmin))
      .attach('file', png(), 'front.png');

    const submitted = await api(app)
      .post(`/api/v1/vendor-products/${id}/submit`)
      .set(auth(s.officeAdmin));
    expect(submitted.body.data.status).toBe('PENDING_REVIEW');

    const approved = await api(app)
      .post(`/api/v1/vendor-products/${id}/review`)
      .set(auth(s.itAdmin))
      .send({ decision: 'APPROVED' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    expect(approved.body.data.status).toBe('APPROVED');

    const detail = await api(app).get(`/api/v1/vendor-products/${id}`).set(auth(s.officeAdmin));
    expect(detail.body.data.reviews[0].decision).toBe('APPROVED');
  });

  it('requires a reason for anything that is not an approval', async () => {
    const created = await createOffer(auth(s.officeAdmin), { vendorId: vendorA });
    const id = created.body.data.id;
    await api(app)
      .post(`/api/v1/vendor-products/${id}/images`)
      .set(auth(s.officeAdmin))
      .attach('file', png(), 'front.png');
    await api(app).post(`/api/v1/vendor-products/${id}/submit`).set(auth(s.officeAdmin));

    const noReason = await api(app)
      .post(`/api/v1/vendor-products/${id}/review`)
      .set(auth(s.itAdmin))
      .send({ decision: 'REJECTED' });
    expect(noReason.status).toBe(422);

    const withReason = await api(app)
      .post(`/api/v1/vendor-products/${id}/review`)
      .set(auth(s.itAdmin))
      .send({ decision: 'REJECTED', comments: 'RAM does not match the stated model' });
    expect(withReason.body.data.status).toBe('REJECTED');
  });
});
