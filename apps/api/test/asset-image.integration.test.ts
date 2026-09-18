import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageProvider } from '../src/providers/storage/storage.provider.js';
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
  // v2.66 - the primary-picture tests hand the asset over to photograph it.
  await prisma.client.$executeRawUnsafe(
    'DELETE FROM asset_assignments WHERE "assetId" = $1',
    assetId,
  );
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

describe('up to five photographs of the unit (v2.65)', () => {
  const addPhoto = (who: AccountKey = 'itAdmin', replace?: string) =>
    api(app)
      .post(`/api/v1/assets/${assetId}/unit-photos${replace ? `?replace=${replace}` : ''}`)
      .set(auth(s[who]))
      .attach('file', PNG, 'unit.png');
  const photoIds = async () =>
    ((await getAsset()).body.data.photos as { id: string }[]).map((p) => p.id);

  const ids: string[] = [];

  it('refuses a caller without assets:update', async () => {
    expect((await addPhoto('employee')).status).toBe(403);
  });

  it('takes five, the first of them the cover, and lists them cover first', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await addPhoto();
      expect(res.status).toBeLessThan(300);
      expect(res.body.data.isCover).toBe(i === 0);
      ids.push(res.body.data.id);
    }
    const asset = (await getAsset()).body.data;
    expect(asset.photo.id).toBe(ids[0]);
    expect(await photoIds()).toEqual(ids);
    expect(asset.photos[0].sizeBytes).toBe(PNG.length);
  });

  it('refuses a sixth, and says what to do instead', async () => {
    const res = await addPhoto();
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('at most 5 photos');
    expect(await photoIds()).toHaveLength(5);
  });

  it('replaces one when full, and deletes the file it replaces', async () => {
    const before = await prisma.client.attachment.findUniqueOrThrow({
      where: { id: ids[2]! },
      select: { storageKey: true },
    });
    const res = await addPhoto('itAdmin', ids[2]);
    expect(res.status).toBeLessThan(300);
    expect(res.body.data.replaced).toBe(ids[2]);
    expect(res.body.data.isCover).toBe(false);

    expect((await readBytes(ids[2]!)).status).toBe(404);
    expect(await photoIds()).toHaveLength(5);
    // The bytes are gone from storage, not merely hidden.
    const storage = app.get(StorageProvider);
    await expect(storage.get(before.storageKey)).rejects.toBeDefined();
    ids[2] = res.body.data.id;
  });

  it('keeps the cover the cover when it is the one replaced', async () => {
    const res = await addPhoto('itAdmin', ids[0]);
    expect(res.body.data.isCover).toBe(true);
    ids[0] = res.body.data.id;
    expect((await getAsset()).body.data.photo.id).toBe(ids[0]);
  });

  it('will not replace a photograph that is not one of this asset’s', async () => {
    expect((await addPhoto('itAdmin', 'no-such-photo')).status).toBe(404);
  });

  it('makes another one the cover', async () => {
    const res = await api(app)
      .post(`/api/v1/assets/${assetId}/unit-photos/${ids[3]}/cover`)
      .set(auth(s.itAdmin));
    expect(res.status).toBe(200);
    expect((await getAsset()).body.data.photo.id).toBe(ids[3]);
    expect((await photoIds())[0]).toBe(ids[3]);
  });

  it('hands the cover to the oldest one left when the cover is removed', async () => {
    const res = await api(app)
      .delete(`/api/v1/assets/${assetId}/unit-photos/${ids[3]}`)
      .set(auth(s.itAdmin));
    expect(res.status).toBe(200);
    expect((await readBytes(ids[3]!)).status).toBe(404);
    const asset = (await getAsset()).body.data;
    expect(asset.photos).toHaveLength(4);
    expect(asset.photo.id).toBe(asset.photos[0].id);
    // Room for one more again.
    expect((await addPhoto()).status).toBeLessThan(300);
  });

  it('still serves the old single-photo route: it replaces the cover', async () => {
    const coverBefore = (await getAsset()).body.data.photo.id as string;
    const res = await setPhoto('itAdmin');
    expect(res.status).toBeLessThan(300);
    const asset = (await getAsset()).body.data;
    expect(asset.photo.id).toBe(res.body.data.id);
    expect(asset.photos).toHaveLength(5);
    expect((await readBytes(coverBefore)).status).toBe(404);
  });
});

describe('choosing the primary picture (v2.66)', () => {
  const setPrimary = (photoId: string | null, who: AccountKey = 'itAdmin') =>
    api(app)
      .patch(`/api/v1/assets/${assetId}/primary-photo`)
      .set(auth(s[who]))
      .send({ photoId });

  let handoverPhotoId: string;
  let unitPhotoIds: string[];

  it('sets up: the asset is handed over and photographed', async () => {
    const assigned = await api(app)
      .post(`/api/v1/assets/${assetId}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });
    expect(assigned.status).toBeLessThan(300);
    const shot = await api(app)
      .post(`/api/v1/assets/${assetId}/photos`)
      .set(auth(s.itAdmin))
      .field('stage', 'HANDOVER')
      .attach('file', PNG, 'handover.png');
    expect(shot.status).toBeLessThan(300);
    handoverPhotoId = shot.body.data.id;
    unitPhotoIds = ((await getAsset()).body.data.photos as { id: string }[]).map((p) => p.id);
    expect(unitPhotoIds.length).toBeGreaterThan(1);
  });

  it('refuses a caller without assets:update', async () => {
    expect((await setPrimary(handoverPhotoId, 'employee')).status).toBe(403);
  });

  it('lets a handover photo lead the asset, and says which kind it is', async () => {
    expect((await setPrimary(handoverPhotoId)).status).toBe(200);
    const asset = (await getAsset()).body.data;
    expect(asset.photo.id).toBe(handoverPhotoId);
    expect(asset.photo.entityType).toBe('AssetAssignment');
    // The unit's own photographs are all still there.
    expect(asset.photos.map((p: { id: string }) => p.id).sort()).toEqual([...unitPhotoIds].sort());
  });

  it('lets one of the unit photographs lead instead, and lists it first', async () => {
    expect((await setPrimary(unitPhotoIds[1]!)).status).toBe(200);
    const asset = (await getAsset()).body.data;
    expect(asset.photo.id).toBe(unitPhotoIds[1]);
    expect(asset.photo.entityType).toBe('AssetPhoto');
    expect(asset.photos[0].id).toBe(unitPhotoIds[1]);
  });

  it('will not take a photo from somewhere else, or nonsense', async () => {
    expect((await setPrimary('no-such-photo')).status).toBe(404);
    const bad = await api(app)
      .patch(`/api/v1/assets/${assetId}/primary-photo`)
      .set(auth(s.itAdmin))
      .send({ photoId: 42 });
    expect(bad.status).toBe(422);
  });

  it('never deletes a condition photo through the old replace route', async () => {
    await setPrimary(handoverPhotoId);
    // Make room: the old route adds beside a condition photo rather than replacing it.
    const spare = unitPhotoIds[0]!;
    await api(app).delete(`/api/v1/assets/${assetId}/unit-photos/${spare}`).set(auth(s.itAdmin));
    const res = await setPhoto('itAdmin');
    expect(res.status).toBeLessThan(300);
    expect((await getAsset()).body.data.photo.id).toBe(res.body.data.id);
    expect((await readBytes(handoverPhotoId)).status).toBe(200);
  });

  it('only un-chooses a condition photo through the old remove route', async () => {
    await setPrimary(handoverPhotoId);
    const res = await api(app).delete(`/api/v1/assets/${assetId}/photo`).set(auth(s.itAdmin));
    expect(res.status).toBe(200);
    expect((await getAsset()).body.data.photo).toBeNull();
    expect((await readBytes(handoverPhotoId)).status).toBe(200);
  });

  it('clears the choice when asked, and when the chosen condition photo is removed', async () => {
    await setPrimary(handoverPhotoId);
    expect((await setPrimary(null)).status).toBe(200);
    expect((await getAsset()).body.data.photo).toBeNull();

    await setPrimary(handoverPhotoId);
    const removed = await api(app)
      .delete(`/api/v1/assets/${assetId}/photos/${handoverPhotoId}`)
      .set(auth(s.itAdmin));
    expect(removed.status).toBe(200);
    expect((await getAsset()).body.data.photo).toBeNull();
  });
});
