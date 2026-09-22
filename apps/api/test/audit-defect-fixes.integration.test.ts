import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.12 — the defects the self-audit turned up, each pinned by a test.
 *
 *  assignmentCount was derived from a list capped at 20, so a device assigned
 *  more times under-reported. Request detail returned uncapped nested
 *  collections. The asset import trusted the filename over the bytes.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let companyId: string;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;
});

afterAll(async () => {
  await app?.close();
});

describe('assignmentCount is a real count, not the capped list length', () => {
  it('reports 25 for a device assigned 25 times (list stays capped at 20)', async () => {
    const asset = await prisma.client.asset.findFirst({
      where: { companyId },
      select: { id: true, condition: true, assignedUserId: true, status: true },
    });
    const original = asset!.assignedUserId;
    const originalStatus = asset!.status;
    // A holder needs a custody status (assets_holder_matches_status).
    await prisma.client.asset.update({
      where: { id: asset!.id },
      data: { assignedUserId: s.employee.user.id, status: 'ASSIGNED' },
    });

    const existing = await prisma.client.assetAssignment.count({ where: { assetId: asset!.id } });
    const toAdd = 25 - existing > 0 ? 25 - existing : 25;
    const made: string[] = [];
    for (let i = 0; i < toAdd; i++) {
      const row = await prisma.client.assetAssignment.create({
        data: {
          assetId: asset!.id,
          userId: s.employee.user.id,
          conditionOut: asset!.condition,
          assignedAt: new Date(Date.now() - (i + 1) * 86_400_000),
          returnedAt: new Date(Date.now() - i * 86_400_000),
        },
        select: { id: true },
      });
      made.push(row.id);
    }
    const total = await prisma.client.assetAssignment.count({ where: { assetId: asset!.id } });

    const res = await api(app).get(`/api/v1/assets/${asset!.id}`).set(auth(s.employee));
    expect(res.status).toBe(200);
    // The payload stays bounded...
    expect(res.body.data.assignments.length).toBeLessThanOrEqual(20);
    // ...but the number shown to the user is the truth.
    expect(res.body.data.assignmentCount).toBe(total);
    expect(res.body.data.assignmentCount).toBeGreaterThan(20);

    for (const id of made) {
      await prisma.client.$executeRawUnsafe('DELETE FROM asset_assignments WHERE id = $1', id);
    }
    await prisma.client.asset.update({
      where: { id: asset!.id },
      data: { assignedUserId: original, status: originalStatus },
    });
  }, 30_000);
});

describe('request detail collections are bounded', () => {
  it('caps comments and returns them oldest-first for reading', async () => {
    const created = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.employee))
      .send({
        type: 'ADDITIONAL_EQUIPMENT',
        businessReason: 'Bounded-collections fixture request',
        items: [{ description: 'Monitor', quantity: 1 }],
      });
    const id = created.body.data.id;

    // More comments than the cap.
    for (let i = 0; i < 105; i++) {
      await prisma.client.requestComment.create({
        data: { requestId: id, authorId: s.employee.user.id, body: `comment ${i}`, isInternal: false },
      });
    }

    const res = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.employee));
    expect(res.status).toBe(200);
    const comments = res.body.data.comments as { body: string; createdAt: string }[];
    expect(comments.length).toBeLessThanOrEqual(100);
    // Oldest-first within the returned window: readable as a conversation.
    const times = comments.map((c) => new Date(c.createdAt).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // The cap keeps the RECENT ones, so the last comment made is present.
    expect(comments.at(-1)?.body).toBe('comment 104');

    await prisma.client.$executeRawUnsafe('DELETE FROM request_comments WHERE "requestId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM request_items WHERE "requestId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM asset_requests WHERE id = $1', id);
  }, 30_000);
});

describe('asset import verifies bytes, not the filename', () => {
  it('refuses a non-spreadsheet posted as .xlsx', async () => {
    const res = await api(app)
      .post('/api/v1/assets/import')
      .set(auth(s.itAdmin))
      .attach('file', Buffer.from('id,name\n1,not really a workbook\n'), 'assets.xlsx');
    expect([400, 415, 422]).toContain(res.status);
  });
});
