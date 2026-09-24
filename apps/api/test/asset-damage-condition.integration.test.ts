import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.89 — reporting damage grades the condition too.
 *
 * The asset page showed "Damaged" and "Condition: Good" side by side, and the
 * owner reasonably asked which one to believe. Condition is graded at a
 * handover and then left alone, so a damage report changed the status and left
 * a stale grade behind it. The report IS a statement about the condition.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
const tags: string[] = [];

async function makeAsset(condition: string, status = 'AVAILABLE') {
  const companyId = s.itAdmin.user.companyId;
  const category = await prisma.client.category.findFirst({ where: { companyId } });
  const assetTag = `DC-${condition}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  tags.push(assetTag);
  const asset = await prisma.client.asset.create({
    data: {
      companyId,
      assetTag,
      name: `Damage condition ${condition}`,
      categoryId: category!.id,
      status: status as never,
      condition: condition as never,
      qrToken: `qr-${assetTag}`,
    },
    select: { id: true },
  });
  return asset.id;
}

const read = (id: string) =>
  prisma.client.asset.findUniqueOrThrow({
    where: { id },
    select: { status: true, condition: true },
  });

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await prisma?.client.asset.deleteMany({ where: { assetTag: { in: tags } } });
  await app?.close();
});

describe('reporting an asset damaged', () => {
  it('grades the condition down, so "Damaged / Good" cannot happen', async () => {
    const id = await makeAsset('GOOD');
    const res = await api(app)
      .post(`/api/v1/assets/${id}/status`)
      .set(auth(s.itAdmin))
      .send({ status: 'DAMAGED', reason: 'Screen cracked' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBeLessThan(300);

    const after = await read(id);
    expect(after.status).toBe('DAMAGED');
    expect(after.condition).toBe('DAMAGED');
  });

  it('does the same from New and Fair', async () => {
    for (const grade of ['NEW', 'FAIR'] as const) {
      const id = await makeAsset(grade);
      await api(app)
        .post(`/api/v1/assets/${id}/status`)
        .set(auth(s.itAdmin))
        .send({ status: 'DAMAGED' });
      expect((await read(id)).condition, grade).toBe('DAMAGED');
    }
  });

  it('does not talk a worse grade UP to "Damaged"', async () => {
    // An asset already graded Unusable is not improved by a damage report.
    const id = await makeAsset('UNUSABLE');
    await api(app).post(`/api/v1/assets/${id}/status`).set(auth(s.itAdmin)).send({ status: 'DAMAGED' });
    const after = await read(id);
    expect(after.status).toBe('DAMAGED');
    expect(after.condition).toBe('UNUSABLE');
  });

  it('leaves the condition alone for any other status change', async () => {
    // Only a damage report says something about the physical grade.
    const id = await makeAsset('GOOD');
    await api(app)
      .post(`/api/v1/assets/${id}/status`)
      .set(auth(s.itAdmin))
      .send({ status: 'IN_STORAGE' });
    expect((await read(id)).condition).toBe('GOOD');
  });

  it('takes an asset out of service when it is GRADED broken', async () => {
    // v2.90, the direction the owner asked for: change the condition on the
    // edit form and the status follows.
    for (const grade of ['DAMAGED', 'UNUSABLE'] as const) {
      const id = await makeAsset('GOOD');
      const res = await api(app)
        .patch(`/api/v1/assets/${id}`)
        .set(auth(s.itAdmin))
        .send({ condition: grade });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBeLessThan(300);
      expect((await read(id)).status, grade).toBe('DAMAGED');
    }
  });

  it('refuses to grade a damaged asset serviceable without saying where it goes', async () => {
    // "Good" does not name a status, and silently choosing one would put a
    // machine somebody reported broken back in the pool.
    const id = await makeAsset('DAMAGED', 'DAMAGED');
    const res = await api(app)
      .patch(`/api/v1/assets/${id}`)
      .set(auth(s.itAdmin))
      .send({ condition: 'GOOD' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toMatch(/status/i);
    // Nothing moved.
    expect(await read(id)).toMatchObject({ status: 'DAMAGED', condition: 'DAMAGED' });
  });

  it('allows it when the status is set in the same edit', async () => {
    const id = await makeAsset('DAMAGED', 'DAMAGED');
    const res = await api(app)
      .patch(`/api/v1/assets/${id}`)
      .set(auth(s.itAdmin))
      .send({ condition: 'GOOD', status: 'AVAILABLE' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBeLessThan(300);
    expect(await read(id)).toMatchObject({ status: 'AVAILABLE', condition: 'GOOD' });
  });

  it('leaves an ordinary regrade of a working asset alone', async () => {
    const id = await makeAsset('GOOD');
    await api(app).patch(`/api/v1/assets/${id}`).set(auth(s.itAdmin)).send({ condition: 'FAIR' });
    expect(await read(id)).toMatchObject({ status: 'AVAILABLE', condition: 'FAIR' });
  });

  it('records the previous grade, so nothing is lost', async () => {
    const id = await makeAsset('GOOD');
    await api(app).post(`/api/v1/assets/${id}/status`).set(auth(s.itAdmin)).send({ status: 'DAMAGED' });
    const entry = await prisma.client.auditLog.findFirst({
      where: { entityId: id, action: 'ASSET_STATUS_CHANGED' },
      orderBy: { createdAt: 'desc' },
      select: { previousValues: true },
    });
    expect(JSON.stringify(entry?.previousValues)).toContain('GOOD');
  });
});
