import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v3.16 - a tag or serial that is already taken is refused BY NAME.
 *
 * The owner registered a webcam with the tag "C270" and got "A record with
 * these values already exists". The tag was on another asset ("Camera",
 * C270, with Banti Kumar); nothing on screen said which value or which
 * asset. Now the refusal names both and points the form at the box. And an
 * asset that was deleted no longer reserves its tag and serial for ever.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let categoryId: string;

const stamp = Date.now().toString(36);
const tags: string[] = [];
const tag = (suffix: string) => {
  const t = `ID-${suffix}-${stamp}`;
  tags.push(t);
  return t;
};

const create = (body: Record<string, unknown>, session: Session = s.itAdmin) =>
  api(app)
    .post('/api/v1/assets')
    .set(auth(session))
    .send({ categoryId, status: 'AVAILABLE', condition: 'GOOD', ...body });

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  const category = await prisma.client.category.findFirstOrThrow({
    where: { companyId: s.itAdmin.user.companyId },
    select: { id: true },
  });
  categoryId = category.id;
});

afterAll(async () => {
  await prisma?.client.asset.deleteMany({ where: { assetTag: { in: tags } } });
  await app?.close();
});

describe('a tag that is already taken', () => {
  const taken = tag('CAM');
  const serial = `SN-ID-${stamp}`;

  it('is refused naming the asset that has it, and pointing at the box', async () => {
    const first = await create({ assetTag: taken, name: 'Camera', serialNumber: serial });
    expect([200, 201]).toContain(first.status);

    const again = await create({
      assetTag: taken,
      name: 'C270 HD WebCAM',
      serialNumber: 'OTHER-' + serial,
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('DUPLICATE_ASSET_TAG');
    expect(again.body.detail).toContain('Camera');
    expect(again.body.detail).toContain(taken);
    expect(again.body.detail).not.toMatch(/record with these values/i);
    expect(again.body.errors).toEqual([
      { path: 'assetTag', message: expect.stringContaining('Camera') },
    ]);
  });

  it('is refused the same way when an existing asset is renamed onto it', async () => {
    const other = await create({ assetTag: tag('OTHER'), name: 'Other' });
    expect([200, 201]).toContain(other.status);
    const res = await api(app)
      .patch(`/api/v1/assets/${other.body.data.id}`)
      .set(auth(s.itAdmin))
      .send({ assetTag: taken, version: other.body.data.version });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_ASSET_TAG');
    expect(res.body.errors?.[0]?.path).toBe('assetTag');

    // Re-saving an asset under its own tag is not a clash.
    const same = await api(app)
      .patch(`/api/v1/assets/${other.body.data.id}`)
      .set(auth(s.itAdmin))
      .send({
        assetTag: other.body.data.assetTag,
        name: 'Other, renamed',
        version: other.body.data.version,
      });
    expect(same.status, JSON.stringify(same.body).slice(0, 200)).toBe(200);
  });

  it('a serial that is taken says which asset has it, in the same shape', async () => {
    const res = await create({ assetTag: tag('SER'), name: 'Second webcam', serialNumber: serial });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_SERIAL_NUMBER');
    expect(res.body.detail).toContain('Camera');
    expect(res.body.detail).toContain(taken);
    expect(res.body.detail).not.toMatch(/duplicateExceptionReason|spec section/);
    expect(res.body.errors?.[0]?.path).toBe('serialNumber');
  });

  it('says when the holder of the tag has left service', async () => {
    const scrapped = tag('SCRAP');
    const made = await create({ assetTag: scrapped, name: 'Old projector' });
    expect([200, 201]).toContain(made.status);
    await prisma.client.asset.update({
      where: { id: made.body.data.id },
      data: { status: 'DISPOSED' },
    });
    const res = await create({ assetTag: scrapped, name: 'New projector' });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/disposed/);
  });
});

describe('a deleted asset no longer reserves its identity', () => {
  it('frees its tag and serial for a new record, and keeps them on the old row', async () => {
    const reused = tag('REUSE');
    const serial = `SN-REUSE-${stamp}`;
    const first = await create({ assetTag: reused, name: 'Mistaken entry', serialNumber: serial });
    expect([200, 201]).toContain(first.status);

    const gone = await api(app)
      .delete(`/api/v1/assets/${first.body.data.id}`)
      .set(auth(s.superAdmin));
    expect([200, 204]).toContain(gone.status);

    const second = await create({ assetTag: reused, name: 'Correct entry', serialNumber: serial });
    expect(second.status, JSON.stringify(second.body).slice(0, 300)).toBe(first.status);
    expect(second.body.data.id).not.toBe(first.body.data.id);

    // The deleted row keeps its values: "who had that tag in 2025" survives.
    const old = await prisma.client.asset.findFirst({
      where: { id: first.body.data.id, includeDeleted: true } as never,
      select: { assetTag: true, serialNumber: true, deletedAt: true },
    });
    expect(old).toMatchObject({ assetTag: reused, serialNumber: serial });
    expect(old?.deletedAt).not.toBeNull();
  });
});
