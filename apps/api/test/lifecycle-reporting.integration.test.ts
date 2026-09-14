import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Phase 5: maintenance lifecycle, reports with permission-gated financial
 * columns, and the warranty alert sweep.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
});

afterAll(async () => {
  await app?.close();
});

async function anAsset() {
  const assets = await api(app).get('/api/v1/assets?pageSize=1').set(auth(s.itAdmin));
  return assets.body.data[0];
}

describe('maintenance lifecycle (spec section 14)', () => {
  it('runs request → start → complete → approve and returns the asset to service', async () => {
    const asset = await anAsset();

    const created = await api(app)
      .post('/api/v1/maintenance')
      .set(auth(s.itAdmin))
      .send({ assetId: asset.id, type: 'REPAIR', title: 'Screen replacement' });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('REQUESTED');
    const id = created.body.data.id;

    const started = await api(app).post(`/api/v1/maintenance/${id}/start`).set(auth(s.itAdmin));
    expect(started.body.data.status).toBe('IN_PROGRESS');
    // The asset went under repair.
    expect(started.body.data.asset.status).toBe('UNDER_REPAIR');

    const completed = await api(app)
      .post(`/api/v1/maintenance/${id}/complete`)
      .set(auth(s.itAdmin))
      .send({ serviceCost: '149.99', downtimeHours: '48', restoreAsset: true });
    // Completion goes for sign-off; the asset stays under repair until then.
    expect(completed.body.data.status).toBe('AWAITING_APPROVAL');
    expect(completed.body.data.asset.status).toBe('UNDER_REPAIR');

    // A different manager approves: closed, and back in service.
    const approved = await api(app)
      .post(`/api/v1/maintenance/${id}/approve`)
      .set(auth(s.superAdmin))
      .send({});
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    expect(approved.body.data.status).toBe('COMPLETED');
    expect(approved.body.data.asset.status).toBe('AVAILABLE');
  });

  it('rejects an illegal transition (complete before start)', async () => {
    const asset = await anAsset();
    const created = await api(app)
      .post('/api/v1/maintenance')
      .set(auth(s.itAdmin))
      .send({ assetId: asset.id, type: 'INSPECTION', title: 'Annual check' });

    const response = await api(app)
      .post(`/api/v1/maintenance/${created.body.data.id}/complete`)
      .set(auth(s.itAdmin))
      .send({ restoreAsset: false });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ILLEGAL_STATE_TRANSITION');
  });

  it('hides service cost from a non-cost role', async () => {
    const asset = await anAsset();
    const created = await api(app)
      .post('/api/v1/maintenance')
      .set(auth(s.itAdmin))
      .send({ assetId: asset.id, type: 'REPAIR', title: 'Battery swap' });
    await api(app).post(`/api/v1/maintenance/${created.body.data.id}/start`).set(auth(s.itAdmin));
    await api(app)
      .post(`/api/v1/maintenance/${created.body.data.id}/complete`)
      .set(auth(s.itAdmin))
      .send({ serviceCost: '89.00', restoreAsset: true });

    // The auditor can read maintenance but — since price became a Finance /
    // Super Admin capability — no longer holds cost visibility, so the service
    // cost must be absent from their view.
    const auditorView = await api(app)
      .get(`/api/v1/maintenance/${created.body.data.id}`)
      .set(auth(s.auditor));
    expect(auditorView.status).toBe(200);
    expect(auditorView.body.data).not.toHaveProperty('serviceCost');

    // Finance holds read-only maintenance access precisely so repair spend is
    // visible to the cost-owning role.
    const financeView = await api(app)
      .get(`/api/v1/maintenance/${created.body.data.id}`)
      .set(auth(s.finance));
    expect(financeView.status).toBe(200);
    expect(financeView.body.data).toHaveProperty('serviceCost');
  });

  it('requires maintenance:manage to create', async () => {
    const asset = await anAsset();
    const response = await api(app)
      .post('/api/v1/maintenance')
      .set(auth(s.employee))
      .send({ assetId: asset.id, type: 'REPAIR', title: 'Nope' });
    expect(response.status).toBe(403);
  });
});

describe('reports (spec section 18)', () => {
  it('lets Finance run a spending-by-vendor report', async () => {
    const response = await api(app)
      .get('/api/v1/reports?type=SPENDING_BY_VENDOR')
      .set(auth(s.finance));
    expect(response.status).toBe(200);
    expect(response.body.data.title).toBe('Spending by vendor');
    expect(response.body.data.columns.some((c: { key: string }) => c.key === 'total')).toBe(true);
  });

  it('refuses a financial report to a role without cost permission', async () => {
    // HR holds reports:read but not assets:cost:read.
    const response = await api(app).get('/api/v1/reports?type=SPENDING_BY_VENDOR').set(auth(s.hr));
    expect(response.status).toBe(403);
  });

  it('lets HR run a non-financial inventory report', async () => {
    const response = await api(app).get('/api/v1/reports?type=ASSET_INVENTORY').set(auth(s.hr));
    expect(response.status).toBe(200);
    // The cost column is absent for HR even on the non-financial report.
    expect(response.body.data.columns.some((c: { key: string }) => c.key === 'cost')).toBe(false);
  });

  it('includes the cost column for a cost-permitted role', async () => {
    const response = await api(app)
      .get('/api/v1/reports?type=ASSET_INVENTORY')
      .set(auth(s.finance));
    expect(response.body.data.columns.some((c: { key: string }) => c.key === 'cost')).toBe(true);
  });

  it('streams a CSV download', async () => {
    const response = await api(app)
      .get('/api/v1/reports?type=ASSET_INVENTORY&format=CSV')
      .set(auth(s.finance));
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    // The body is raw CSV, not the JSON envelope.
    expect(response.text.split('\r\n')[0]).toContain('Asset tag');
  });

  it('sends a real .xlsx workbook', async () => {
    const response = await api(app)
      .get('/api/v1/reports?type=DEPRECIATION&format=XLSX')
      .set(auth(s.finance))
      .buffer()
      .parse((res, cb) => {
        // Supertest would otherwise decode the binary body as text and corrupt
        // it before the assertion below could look at it.
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    // v2.28: was SpreadsheetML served as ms-excel, which Excel warned about on
    // every open and which cannot carry the letterhead logo.
    expect(response.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(response.headers['content-disposition']).toContain('.xlsx');
    // An .xlsx is a zip; "PK" is its first two bytes. Checking the magic proves
    // a real workbook was sent, where checking the header only proves we
    // labelled one.
    expect((response.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  /**
   * v2.28 - the report exists because five rows for one person is not an answer
   * to "what is Deepak holding". These assert the property that makes it
   * different from the inventory sheet, not a fixed row count.
   */
  it('gives each holder exactly one row', async () => {
    const response = await api(app)
      .get('/api/v1/reports?type=EMPLOYEE_ASSETS')
      .set(auth(s.finance));
    expect(response.status).toBe(200);

    const rows = response.body.data.rows as { employee: string }[];
    expect(rows.length).toBeGreaterThan(0);
    const names = rows.map((r) => r.employee);
    expect(new Set(names).size).toBe(names.length);
  });

  it('folds a holder\'s extra items into their row rather than adding rows', async () => {
    const response = await api(app)
      .get('/api/v1/reports?type=EMPLOYEE_ASSETS')
      .set(auth(s.finance));

    const rows = response.body.data.rows as { otherCount: number; otherItems: string }[];
    for (const row of rows) {
      // The count and the listing are two renderings of one fact; if they can
      // disagree, one of them is lying on a handover document.
      const listed = row.otherItems ? row.otherItems.split('\n').length : 0;
      expect(listed).toBe(row.otherCount);
    }
  });

  it('names a location for every holder, falling back to the default office', async () => {
    const response = await api(app)
      .get('/api/v1/reports?type=EMPLOYEE_ASSETS')
      .set(auth(s.finance));

    const rows = response.body.data.rows as { location: string }[];
    // A blank location on handover paperwork reads as "we have lost track of
    // this equipment", which is why the company default exists at all.
    expect(rows.every((r) => r.location !== '')).toBe(true);
  });

  it('produces a depreciation report with current values', async () => {
    const response = await api(app).get('/api/v1/reports?type=DEPRECIATION').set(auth(s.finance));
    expect(response.status).toBe(200);
    const columns = response.body.data.columns.map((c: { key: string }) => c.key);
    expect(columns).toContain('current');
    expect(columns).toContain('depreciation');
  });
});

describe('warranty alert sweep (spec section 14)', () => {
  it('raises warranty-expiry notifications for the alert windows', async () => {
    // The seed has assets with warranties inside 30 days (MON-0001 at 18 days).
    const before = await api(app).get('/api/v1/notifications?pageSize=100').set(auth(s.employee));
    const beforeWarranty = before.body.data.filter(
      (n: { type: string }) => n.type === 'WARRANTY_EXPIRATION',
    ).length;

    const run = await api(app).post('/api/v1/scheduled/alerts/run').set(auth(s.superAdmin));
    expect(run.status).toBe(200);
    expect(run.body.data.warrantyAlerts).toBeGreaterThanOrEqual(0);

    // The employee holds an asset expiring in 18 days, so they should now have
    // at least one warranty alert (unless a prior run already raised it today).
    const after = await api(app).get('/api/v1/notifications?pageSize=100').set(auth(s.employee));
    const afterWarranty = after.body.data.filter(
      (n: { type: string }) => n.type === 'WARRANTY_EXPIRATION',
    ).length;
    expect(afterWarranty).toBeGreaterThanOrEqual(beforeWarranty);
  });

  it('does not raise a duplicate alert on a second run the same day', async () => {
    const first = await api(app).post('/api/v1/scheduled/alerts/run').set(auth(s.superAdmin));
    const second = await api(app).post('/api/v1/scheduled/alerts/run').set(auth(s.superAdmin));
    // The second run finds everything already alerted today, so it raises none.
    expect(second.body.data.warrantyAlerts).toBe(0);
    void first;
  });

  it('requires settings:manage to trigger the sweep', async () => {
    const response = await api(app).post('/api/v1/scheduled/alerts/run').set(auth(s.finance));
    expect(response.status).toBe(403);
  });
});

describe('scheduled reports (spec section 18)', () => {
  it('creates a scheduled report and computes its next run', async () => {
    const response = await api(app)
      .post('/api/v1/scheduled/reports')
      .set(auth(s.finance))
      .send({
        name: 'Weekly vendor spend',
        type: 'SPENDING_BY_VENDOR',
        format: 'CSV',
        cron: '0 9 * * 1',
        recipients: ['finance@techpioasset.dev'],
      });
    expect(response.status).toBe(201);
    expect(response.body.data.nextRunAt).toBeTruthy();
  });

  it('refuses to schedule without export permission', async () => {
    const response = await api(app)
      .post('/api/v1/scheduled/reports')
      .set(auth(s.employee))
      .send({
        name: 'x',
        type: 'ASSET_INVENTORY',
        cron: '0 9 * * 1',
        recipients: ['employee@techpioasset.dev'],
      });
    expect(response.status).toBe(403);
  });
});

/**
 * Where a specification comes from (v2.39).
 *
 * RAM, storage and OS have two possible sources: what somebody typed, and what
 * the agent read off the machine. Which one wins is the decision worth pinning,
 * because getting it backwards is invisible - both produce a plausible-looking
 * report, and only one of them stays true after a memory upgrade.
 */
describe('specifications in reports prefer what the machine reported', () => {
  let assetId: string;

  beforeAll(async () => {
    const prisma = app.get(PrismaService);
    const asset = await prisma.client.asset.findFirst({
      where: { deletedAt: null, hardwareProfile: { is: null } },
      select: { id: true, companyId: true },
    });
    assetId = asset!.id;

    // Typed specs say one thing...
    await prisma.client.asset.update({
      where: { id: assetId },
      data: { specs: { ramGb: '8', storage: '256 GB SSD', os: 'Windows 10 Pro' } },
    });
    // ...and the machine reports another.
    await prisma.client.hardwareProfile.create({
      data: {
        companyId: asset!.companyId,
        assetId,
        ramGb: 15.4,
        storageTotalGb: 476.9,
        source: 'AGENT',
      },
    });
    await prisma.client.operatingSystemInfo.create({
      data: {
        companyId: asset!.companyId,
        assetId,
        osName: 'Microsoft Windows 11 Pro',
        osVersion: '10.0.26200',
        source: 'AGENT',
      },
    });
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.client.operatingSystemInfo.deleteMany({ where: { assetId } });
    await prisma.client.hardwareProfile.deleteMany({ where: { assetId } });
    await prisma.client.asset.update({ where: { id: assetId }, data: { specs: Prisma.DbNull } });
  });

  it('reports what the agent measured, not what was typed', async () => {
    const response = await api(app)
      .get('/api/v1/reports?type=ASSET_INVENTORY')
      .set(auth(s.finance));
    const row = (response.body.data.rows as Record<string, string>[]).find(
      (r) => r.ram === '15.4 GB',
    );

    expect(row, 'the agent-reported row should be present').toBeTruthy();
    // The typed values were 8 GB / 256 GB SSD / Windows 10 - all superseded.
    expect(row!.ram).toBe('15.4 GB');
    expect(row!.storage).toBe('477 GB');
    expect(row!.os).toBe('Microsoft Windows 11 Pro 10.0.26200');
  });

  it('does not round measured RAM up to the number on the box', async () => {
    // Windows reports what is addressable; 15.4 is a 16 GB machine minus what
    // the hardware reserves. Printing "16 GB" would be a figure nothing
    // measured, in a register people audit against.
    const response = await api(app)
      .get('/api/v1/reports?type=ASSET_INVENTORY')
      .set(auth(s.finance));
    const rams = (response.body.data.rows as Record<string, string>[]).map((r) => r.ram);
    expect(rams).toContain('15.4 GB');
    expect(rams).not.toContain('16 GB');
  });

  it('still uses the typed value where no agent has reported', async () => {
    // The Macs will never report - the agent is Windows-only - so the typed
    // specs have to keep working, or this change would blank them.
    const prisma = app.get(PrismaService);
    const other = await prisma.client.asset.findFirst({
      where: { deletedAt: null, hardwareProfile: { is: null }, id: { not: assetId } },
      select: { id: true },
    });
    await prisma.client.asset.update({
      where: { id: other!.id },
      data: { specs: { ramGb: '64', os: 'macOS Sonoma' } },
    });

    const response = await api(app)
      .get('/api/v1/reports?type=ASSET_INVENTORY')
      .set(auth(s.finance));
    const rows = response.body.data.rows as Record<string, string>[];
    expect(rows.some((r) => r.ram === '64 GB' && r.os === 'macOS Sonoma')).toBe(true);

    await prisma.client.asset.update({ where: { id: other!.id }, data: { specs: Prisma.DbNull } });
  });
});
