import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * The asset's own picture (v2.61).
 *
 * Distinct from condition photos: this is what the unit looks like, not
 * evidence of its state at a custody event. So the properties worth proving
 * are the ones that keep the two apart - it rides on GET /assets/:id, a second
 * upload replaces rather than accumulates, it needs assets:update rather than
 * a custody right, and the condition-photo routes can neither list nor remove
 * it.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;

/** A 1x1 PNG - real bytes, because uploads are validated by magic number. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let assetId: string;
/** A throwaway tenant, so the cross-tenant check never depends on seed data. */
let foreignCompanyId: string | null = null;
let foreignAssetId: string | null = null;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);

  const company = s.superAdmin.user.companyId;
  const category = await prisma.client.category.findFirst({ where: { companyId: company } });
  const created = await prisma.client.asset.create({
    data: {
      companyId: company,
      assetTag: `IMG-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      name: 'Image test laptop',
      categoryId: category!.id,
      qrToken: `qr-img-${Math.random().toString(36).slice(2, 10)}`,
      status: 'AVAILABLE',
      condition: 'GOOD',
    },
    select: { id: true },
  });
  assetId = created.id;

  const foreign = await prisma.client.company.create({
    data: {
      name: `Other Co ${Math.random().toString(36).slice(2, 8)}`,
      legalName: 'Other Co Ltd.',
      baseCurrency: 'USD',
      locale: 'en-US',
      timezone: 'UTC',
    },
    select: { id: true },
  });
  foreignCompanyId = foreign.id;
  const foreignCategory = await prisma.client.category.create({
    data: { companyId: foreign.id, key: 'hardware', name: 'Hardware' },
    select: { id: true },
  });
  const foreignAsset = await prisma.client.asset.create({
    data: {
      companyId: foreign.id,
      assetTag: 'THEIRS-1',
      name: 'Somebody else’s laptop',
      categoryId: foreignCategory.id,
      qrToken: `qr-foreign-${Math.random().toString(36).slice(2, 10)}`,
      status: 'AVAILABLE',
      condition: 'GOOD',
    },
    select: { id: true },
  });
  foreignAssetId = foreignAsset.id;
});

afterAll(async () => {
  // The FK from assets to attachments must be cleared before the rows go.
  await prisma.client.$executeRawUnsafe(
    'UPDATE assets SET "photoAttachmentId" = NULL WHERE id = $1',
    assetId,
  );
  await prisma.client.$executeRawUnsafe('DELETE FROM attachments WHERE "assetId" = $1', assetId);
  await prisma.client.$executeRawUnsafe('DELETE FROM assets WHERE id = $1', assetId);
  if (foreignCompanyId) {
    // Company cascades to its category and asset.
    await prisma.client.company.delete({ where: { id: foreignCompanyId } });
  }
  await app?.close();
});

const setPhoto = (who: AccountKey, id = assetId, bytes: Buffer = PNG, name = 'unit.png') =>
  api(app).post(`/api/v1/assets/${id}/photo`).set(auth(s[who])).attach('file', bytes, name);

const getAsset = (who: AccountKey = 'itAdmin') =>
  api(app).get(`/api/v1/assets/${assetId}`).set(auth(s[who]));

const readBytes = (photoId: string, who: AccountKey = 'itAdmin') =>
  api(app)
    .get(`/api/v1/assets/${assetId}/photos/${photoId}`)
    .set(auth(s[who]))
    .buffer()
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });

describe("the asset's own picture", () => {
  it('starts with none, and says so on the asset', async () => {
    const res = await getAsset();
    expect(res.status).toBe(200);
    expect(res.body.data.photo).toBeNull();
  });

  it('refuses a caller without assets:update', async () => {
    // An employee can photograph a handover of their own kit; that is a
    // custody act. Changing what the register shows as the unit is an edit.
    const res = await setPhoto('employee');
    expect(res.status).toBe(403);
  });

  it('rejects a file that is not an image, whatever it is called', async () => {
    const res = await setPhoto(
      'itAdmin',
      assetId,
      Buffer.from('%PDF-1.7 not a photograph'),
      'unit.png',
    );
    expect([400, 415, 422]).toContain(res.status);
    expect((await getAsset()).body.data.photo).toBeNull();
  });

  it("answers 404 for another tenant's asset, not 403", async () => {
    const res = await setPhoto('itAdmin', foreignAssetId!);
    expect(res.status).toBe(404);
  });

  let firstId: string;

  it('stores it, hangs it on GET /assets/:id and serves the bytes', async () => {
    const res = await setPhoto('itAdmin');
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    firstId = res.body.data.id;
    expect(res.body.data.mimeType).toBe('image/png');

    const asset = (await getAsset()).body.data;
    expect(asset.photo.id).toBe(firstId);
    expect(asset.photo.mimeType).toBe('image/png');

    const bytes = await readBytes(firstId);
    expect(bytes.status).toBe(200);
    expect(bytes.headers['content-type']).toContain('image/png');
    expect((bytes.body as Buffer).subarray(1, 4).toString()).toBe('PNG');
  });

  it('keeps it out of the condition-photo list', async () => {
    const groups = (await api(app).get(`/api/v1/assets/${assetId}/photos`).set(auth(s.itAdmin)))
      .body.data;
    // Nobody holds this asset, so there is no custody event to file under -
    // and the unit picture must not have invented one.
    expect(groups).toEqual([]);
  });

  it('cannot be removed through the condition-photo route', async () => {
    const res = await api(app)
      .delete(`/api/v1/assets/${assetId}/photos/${firstId}`)
      .set(auth(s.itAdmin));
    expect(res.status).toBe(404);
    expect((await getAsset()).body.data.photo.id).toBe(firstId);
  });

  it('replaces rather than accumulates', async () => {
    const res = await setPhoto('itAdmin', assetId, PNG, 'better.png');
    expect(res.status).toBeLessThan(300);
    const secondId = res.body.data.id;
    expect(secondId).not.toBe(firstId);

    expect((await getAsset()).body.data.photo.id).toBe(secondId);
    // The old one is retired: no longer served, and one row per asset.
    expect((await readBytes(firstId)).status).toBe(404);
    const live = await prisma.client.attachment.count({
      where: { assetId, entityType: 'AssetPhoto', deletedAt: null },
    });
    expect(live).toBe(1);
  });

  it('refuses removal without assets:update', async () => {
    const res = await api(app).delete(`/api/v1/assets/${assetId}/photo`).set(auth(s.employee));
    expect(res.status).toBe(403);
    expect((await getAsset()).body.data.photo).not.toBeNull();
  });

  it('removes it, and the asset goes back to having none', async () => {
    const current = (await getAsset()).body.data.photo.id as string;
    const res = await api(app).delete(`/api/v1/assets/${assetId}/photo`).set(auth(s.itAdmin));
    expect(res.status).toBe(200);
    expect(res.body.data.removed).toBe(true);

    expect((await getAsset()).body.data.photo).toBeNull();
    expect((await readBytes(current)).status).toBe(404);

    // Nothing left to remove.
    const again = await api(app).delete(`/api/v1/assets/${assetId}/photo`).set(auth(s.itAdmin));
    expect(again.status).toBe(404);
  });
});
