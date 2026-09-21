import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Physical verification of assets (v2.72).
 *
 * Proves the round counts what it should, that the people who handle equipment
 * can attest and a read-only Auditor cannot, that a label scanned twice is one
 * confirmation, and that another tenant's asset answers 404.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let assetId: string;
let goneAssetId: string;
let foreignCompanyId: string | null = null;
let foreignAssetId: string | null = null;

const tag = () => Math.random().toString(36).slice(2, 8).toUpperCase();

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);

  const company = s.superAdmin.user.companyId;
  const category = await prisma.client.category.findFirst({ where: { companyId: company } });
  const make = (status: 'AVAILABLE' | 'DISPOSED') =>
    prisma.client.asset.create({
      data: {
        companyId: company,
        assetTag: `VER-${tag()}`,
        name: `Verification test ${status.toLowerCase()}`,
        categoryId: category!.id,
        qrToken: `qr-ver-${tag()}${tag()}`,
        status,
        condition: 'GOOD',
      },
      select: { id: true },
    });
  assetId = (await make('AVAILABLE')).id;
  goneAssetId = (await make('DISPOSED')).id;

  const foreign = await prisma.client.company.create({
    data: { name: `Other Co ${tag()}`, legalName: 'Other Co Ltd.', baseCurrency: 'USD' },
    select: { id: true },
  });
  foreignCompanyId = foreign.id;
  const foreignCategory = await prisma.client.category.create({
    data: { companyId: foreign.id, key: 'hardware', name: 'Hardware' },
    select: { id: true },
  });
  foreignAssetId = (
    await prisma.client.asset.create({
      data: {
        companyId: foreign.id,
        assetTag: 'THEIRS-VER',
        name: 'Somebody else’s laptop',
        categoryId: foreignCategory.id,
        qrToken: `qr-foreign-${tag()}${tag()}`,
        status: 'AVAILABLE',
        condition: 'GOOD',
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await prisma.client.$executeRawUnsafe(
    'DELETE FROM asset_verifications WHERE "assetId" IN ($1, $2)',
    assetId,
    goneAssetId,
  );
  await prisma.client.$executeRawUnsafe('DELETE FROM assets WHERE id IN ($1, $2)', assetId, goneAssetId);
  if (foreignCompanyId) await prisma.client.company.delete({ where: { id: foreignCompanyId } });
  await app?.close();
});

const verify = (who: AccountKey, id = assetId, body: Record<string, unknown> = {}) =>
  api(app).post(`/api/v1/assets/${id}/verifications`).set(auth(s[who])).send(body);
const summary = (who: AccountKey = 'superAdmin') =>
  api(app).get('/api/v1/assets/verification/summary').set(auth(s[who]));
const getAsset = (who: AccountKey = 'itAdmin') =>
  api(app).get(`/api/v1/assets/${assetId}`).set(auth(s[who]));

describe('recording that an asset was seen', () => {
  it('starts with no confirmation on the asset, and the asset among those still to find', async () => {
    expect((await getAsset()).body.data.lastVerification).toBeNull();
    const before = (await summary()).body.data;
    expect(before.period.label).toMatch(/^Q[1-4] \d{4}$/);
    expect(before.total).toBe(before.verified + before.pending);
  });

  it('refuses a read-only Auditor and an employee: attesting is a write', async () => {
    expect((await verify('auditor')).status).toBe(403);
    expect((await verify('employee')).status).toBe(403);
    expect((await getAsset()).body.data.lastVerification).toBeNull();
  });

  it('lets somebody who handles equipment record it, and moves the count by exactly one', async () => {
    const before = (await summary()).body.data;
    const res = await verify('itAdmin');
    expect(res.status).toBeLessThan(300);
    expect(res.body.data.duplicate).toBe(false);

    const after = (await summary()).body.data;
    expect(after.total).toBe(before.total);
    expect(after.verified).toBe(before.verified + 1);
    expect(after.pending).toBe(before.pending - 1);
    expect(after.label).toBe(`${after.verified} of ${after.total} verified`);

    const last = (await getAsset()).body.data.lastVerification;
    expect(last.method).toBe('SCAN');
    expect(last.by).toBeTruthy();
  });

  it('treats a second scan of the same label straight away as the same confirmation', async () => {
    const before = (await summary()).body.data.verified;
    const again = await verify('itAdmin');
    expect(again.status).toBeLessThan(300);
    expect(again.body.data.duplicate).toBe(true);
    expect((await summary()).body.data.verified).toBe(before);
    const rows = await prisma.client.assetVerification.count({ where: { assetId } });
    expect(rows).toBe(1);
  });

  it('keeps a note, because a note is worth a second row', async () => {
    const res = await verify('itAdmin', assetId, { note: '  Label torn, re-printed  ', method: 'MANUAL' });
    expect(res.body.data.duplicate).toBe(false);
    const last = (await getAsset()).body.data.lastVerification;
    expect(last.note).toBe('Label torn, re-printed');
    expect(last.method).toBe('MANUAL');
  });

  it('shows the confirmation on a QR lookup too, which is what the scanner reads', async () => {
    const asset = await prisma.client.asset.findUniqueOrThrow({ where: { id: assetId }, select: { qrToken: true } });
    const res = await api(app).get(`/api/v1/assets/by-qr/${asset.qrToken}`).set(auth(s.itAdmin));
    expect(res.status).toBe(200);
    expect(res.body.data.lastVerification.note).toBe('Label torn, re-printed');
  });

  it('will not put a disposed asset into a round, and does not count it', async () => {
    const res = await verify('itAdmin', goneAssetId);
    expect(res.status).toBe(422);
    const pendingIds = ((await summary()).body.data.pendingAssets as { id: string }[]).map((a) => a.id);
    expect(pendingIds).not.toContain(goneAssetId);
  });

  it("answers 404 for another tenant's asset, not 403", async () => {
    expect((await verify('itAdmin', foreignAssetId!)).status).toBe(404);
    expect((await verify('superAdmin', 'no-such-asset')).status).toBe(404);
  });

  it('lets a read-only Auditor read where the round stands', async () => {
    const res = await summary('auditor');
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThan(0);
    expect(res.body.data.pendingAssets.length).toBeLessThanOrEqual(50);
  });

  it('scopes an employee’s round to their own equipment', async () => {
    const mine = (await summary('employee')).body.data;
    const company = (await summary('superAdmin')).body.data;
    expect(mine.total).toBeLessThan(company.total);
  });
});
