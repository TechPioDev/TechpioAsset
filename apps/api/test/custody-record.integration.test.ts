import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { IMPORT_BACKFILL_METHOD } from '../src/assets/custody-record.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * A held asset with no custody record (v2.74).
 *
 * Both importers set `assignedUserId` and never wrote the open assignment, so
 * on the live register Record return answered "This asset has no open
 * assignment to return" for 97 assets that plainly named their holder. These
 * prove the three parts of the repair: return and hand-over heal the record,
 * the migration restores it in bulk without emailing anybody, and an asset
 * that really has no holder is still refused.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
const made: string[] = [];

const tag = () => Math.random().toString(36).slice(2, 8).toUpperCase();

/** An asset exactly as the importers left it: a holder, and no assignment row. */
async function importedAsset(holderId: string | null, status: 'ASSIGNED' | 'AVAILABLE' = 'ASSIGNED') {
  const company = s.superAdmin.user.companyId;
  const category = await prisma.client.category.findFirst({ where: { companyId: company } });
  const asset = await prisma.client.asset.create({
    data: {
      companyId: company,
      assetTag: `ACCT-${tag()}`,
      name: 'Imported headset',
      categoryId: category!.id,
      qrToken: `qr-cust-${tag()}${tag()}`,
      status,
      condition: 'GOOD',
      assignedUserId: holderId,
      assignmentDate: holderId ? new Date('2026-08-14T00:00:00Z') : null,
    },
    select: { id: true },
  });
  made.push(asset.id);
  return asset.id;
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);
});

afterAll(async () => {
  for (const id of made) {
    await prisma.client.$executeRawUnsafe(
      'DELETE FROM asset_returns WHERE "assignmentId" IN (SELECT id FROM asset_assignments WHERE "assetId" = $1)',
      id,
    );
    await prisma.client.$executeRawUnsafe('DELETE FROM asset_assignments WHERE "assetId" = $1', id);
    await prisma.client.$executeRawUnsafe('DELETE FROM assets WHERE id = $1', id);
  }
  await app?.close();
});

const returnIt = (id: string, who: AccountKey = 'itAdmin') =>
  api(app)
    .post(`/api/v1/assets/${id}/return`)
    .set(auth(s[who]))
    .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });

describe('returning an imported asset that has a holder but no custody record', () => {
  it('records the return instead of refusing, and leaves the history honest', async () => {
    const holder = s.employee.user.id;
    const id = await importedAsset(holder);

    const res = await returnIt(id);
    expect(res.status).toBeLessThan(300);

    const asset = await prisma.client.asset.findUniqueOrThrow({
      where: { id },
      select: { status: true, assignedUserId: true },
    });
    expect(asset).toEqual({ status: 'AVAILABLE', assignedUserId: null });

    const rows = await prisma.client.assetAssignment.findMany({
      where: { assetId: id },
      select: { userId: true, returnedAt: true, acknowledgedAt: true, acknowledgementMethod: true, assignedAt: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(holder);
    expect(rows[0]!.returnedAt).not.toBeNull();
    // Nobody confirmed receipt, and the record does not pretend they did.
    expect(rows[0]!.acknowledgedAt).toBeNull();
    expect(rows[0]!.acknowledgementMethod).toBe(IMPORT_BACKFILL_METHOD);
    // Dated from the register, not from the moment of the repair.
    expect(rows[0]!.assignedAt.toISOString()).toBe('2026-08-14T00:00:00.000Z');
  });

  it('hands it over to somebody else the same way', async () => {
    const id = await importedAsset(s.employee.user.id);
    const res = await api(app)
      .post(`/api/v1/assets/${id}/reassign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee2.user.id, conditionIn: 'GOOD', conditionOut: 'GOOD' });
    expect(res.status).toBeLessThan(300);

    const open = await prisma.client.assetAssignment.findMany({
      where: { assetId: id, returnedAt: null },
      select: { userId: true },
    });
    expect(open).toEqual([{ userId: s.employee2.user.id }]);
  });

  it('still refuses an asset that really has no holder', async () => {
    const id = await importedAsset(null, 'AVAILABLE');
    const res = await returnIt(id);
    expect(res.status).toBe(422);
    expect(await prisma.client.assetAssignment.count({ where: { assetId: id } })).toBe(0);
  });
});

describe('the migration that restores the records in bulk', () => {
  const sql = readFileSync(
    new URL('../prisma/migrations/20260921160000_restore_custody_records/migration.sql', import.meta.url),
    'utf8',
  );

  it('writes one open record per held asset, once, and leaves an odd one alone', async () => {
    const held = await importedAsset(s.employee.user.id);
    // Names a holder but is Available: a different inconsistency, not papered over.
    const odd = await importedAsset(s.employee.user.id, 'AVAILABLE');

    await prisma.client.$executeRawUnsafe(sql);
    await prisma.client.$executeRawUnsafe(sql);

    const rows = await prisma.client.assetAssignment.findMany({
      where: { assetId: held },
      select: { returnedAt: true, acknowledgedAt: true, acknowledgementMethod: true, conditionOut: true },
    });
    expect(rows).toEqual([
      { returnedAt: null, acknowledgedAt: null, acknowledgementMethod: IMPORT_BACKFILL_METHOD, conditionOut: 'GOOD' },
    ]);
    expect(await prisma.client.assetAssignment.count({ where: { assetId: odd } })).toBe(0);

    // And the restored record is what a return now closes.
    expect((await returnIt(held)).status).toBeLessThan(300);
  });

  it('does not set the receipt reminders off for the people it restored', async () => {
    const id = await importedAsset(s.employee.user.id);
    await prisma.client.$executeRawUnsafe(sql);
    const assignment = await prisma.client.assetAssignment.findFirstOrThrow({
      where: { assetId: id, returnedAt: null },
      select: { id: true },
    });

    await app.get(AlertSweepService).runReceiptSweep(new Date('2026-12-01T00:00:00Z'));

    const chased = await prisma.client.notification.count({
      where: { entityId: assignment.id, type: 'RECEIPT_CONFIRMATION' },
    });
    expect(chased).toBe(0);
  });
});
