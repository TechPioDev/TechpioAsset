import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signDownloadLink } from '../src/common/signed-download-link.js';
import { AppConfig } from '../src/config/config.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  api,
  auth,
  createTestApp,
  login,
  loginAll,
  DEMO_PASSWORD,
  type AccountKey,
  type Session,
} from './harness.js';

/**
 * v2.59 expense report - Super Admin only.
 *
 * Fixtures are dated in 2011 so nothing the demo seed or other suites create
 * can land in the periods asserted on, and they live in an office and category
 * made for this run so the filtered data-gap counts are exact.
 *
 * In April 2011 (company zone Asia/Kolkata), unfiltered:
 *   ASSET        25,000.50  (A2)  - A4 is 1 May 00:30 IST, so May
 *   MAINTENANCE   1,500.25  (M1, approved)  - M2 awaits approval: not counted
 *   LICENCE      15,000.00  (L1 12,000 + renewal 3,000)
 *   total        41,500.75 ; EUR 999.99 listed separately ; deleted A7 excluded
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let secret: string;

const run = Date.now() % 1_000_000;
const tag = `EXP-${run}`;

let companyId = '';
let base = '';
let other = '';
let originalTimezone = '';
let officeId = '';
let categoryId = '';
let vendorId = '';
const assetIds: string[] = [];
const licenceIds: string[] = [];
let foreignCompanyId = '';

const APRIL = 'preset=CUSTOM&from=2011-04-01&to=2011-04-30';

const summary = (session: Session, query: string) =>
  api(app).get(`/api/v1/expenses/summary?${query}`).set(auth(session));

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  secret = app.get(AppConfig).get('JWT_ACCESS_SECRET') as string;
  s = await loginAll(app);
  companyId = s.superAdmin.user.companyId;

  const company = await prisma.client.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { baseCurrency: true, timezone: true },
  });
  base = company.baseCurrency.trim();
  other = base === 'EUR' ? 'GBP' : 'EUR';
  originalTimezone = company.timezone;
  await prisma.client.company.update({
    where: { id: companyId },
    data: { timezone: 'Asia/Kolkata' },
  });

  officeId = (
    await prisma.client.office.create({
      data: { companyId, code: tag, name: `Expense Office ${run}` },
    })
  ).id;
  const category = await prisma.client.category.create({
    data: { companyId, key: `exp-${run}`, name: `Expense Category ${run}` },
  });
  categoryId = category.id;
  const laptop = await prisma.client.subcategory.create({
    data: { categoryId, key: `exp-laptop-${run}`, name: `Expense Laptop ${run}` },
  });
  const chair = await prisma.client.subcategory.create({
    data: { categoryId, key: `exp-chair-${run}`, name: `Expense Chair ${run}` },
  });
  vendorId = (
    await prisma.client.vendor.create({
      data: { companyId, code: tag, name: `Expense Vendor ${run}` },
    })
  ).id;

  const asset = async (
    n: number,
    data: { cost?: string; currency?: string; date?: string; sub?: string; deleted?: boolean },
  ) => {
    const created = await prisma.client.asset.create({
      data: {
        companyId,
        assetTag: `${tag}-A${n}`,
        name: `${tag} asset ${n}`,
        categoryId,
        subcategoryId: data.sub ?? null,
        officeId,
        vendorId: n === 1 ? vendorId : null,
        qrToken: `${tag}-qr-${n}`,
        purchaseCost: data.cost ?? null,
        currency: data.cost ? (data.currency ?? base) : null,
        purchaseDate: data.date ? new Date(data.date) : null,
        deletedAt: data.deleted ? new Date() : null,
      },
    });
    assetIds.push(created.id);
    return created.id;
  };

  const a1 = await asset(1, { cost: '100000.00', date: '2011-03-10T06:00:00Z', sub: laptop.id });
  await asset(2, { cost: '25000.50', date: '2011-04-05T06:00:00Z', sub: chair.id });
  await asset(3, { cost: '999.99', currency: other, date: '2011-04-06T06:00:00Z', sub: chair.id });
  await asset(4, { cost: '5000.00', date: '2011-04-30T19:00:00Z', sub: chair.id }); // 1 May 00:30 IST
  await asset(5, {}); // no price
  await asset(6, { cost: '700.00' }); // priced, no date
  await asset(7, { cost: '1234.00', date: '2011-04-10T06:00:00Z', deleted: true });

  await prisma.client.maintenanceRecord.createMany({
    data: [
      {
        assetId: a1,
        type: 'REPAIR',
        status: 'COMPLETED',
        title: `${tag} approved repair`,
        serviceCost: '1500.25',
        currency: base,
        completedAt: new Date('2011-04-18T06:00:00Z'),
        approvedAt: new Date('2011-04-20T06:00:00Z'),
      },
      {
        assetId: a1,
        type: 'REPAIR',
        status: 'AWAITING_APPROVAL',
        title: `${tag} unapproved repair`,
        serviceCost: '900.00',
        currency: base,
        completedAt: new Date('2011-04-21T06:00:00Z'),
      },
      {
        assetId: a1,
        type: 'REPAIR',
        status: 'COMPLETED',
        title: `${tag} costless repair`,
        completedAt: new Date('2011-04-22T06:00:00Z'),
      },
    ],
  });

  const licence = await prisma.client.softwareLicense.create({
    data: {
      companyId,
      name: `${tag} licence`,
      family: 'SAAS',
      subscriptionType: 'SUBSCRIPTION',
      purchaseDate: new Date('2011-04-15T06:00:00Z'),
      seatsPurchased: 5,
      unitOfAssignment: 'USER',
      costAmount: '12000.00',
      costCurrency: base,
    },
  });
  licenceIds.push(licence.id);
  await prisma.client.licenseRenewal.create({
    data: {
      companyId,
      licenseId: licence.id,
      renewedAt: new Date('2011-04-25T06:00:00Z'),
      costAmount: '3000.00',
      costCurrency: base,
    },
  });

  // Another tenant with spend in the same month: must never appear.
  const foreign = await prisma.client.company.create({
    data: { name: `Expense Probe Tenant ${run}` },
  });
  foreignCompanyId = foreign.id;
  const foreignCategory = await prisma.client.category.create({
    data: { companyId: foreignCompanyId, key: `exp-probe-${run}`, name: 'Probe' },
  });
  await prisma.client.asset.create({
    data: {
      companyId: foreignCompanyId,
      assetTag: `${tag}-F`,
      name: `${tag} FOREIGN asset`,
      categoryId: foreignCategory.id,
      qrToken: `${tag}-qr-foreign`,
      purchaseCost: '777777.00',
      currency: base,
      purchaseDate: new Date('2011-04-10T06:00:00Z'),
    },
  });
});

afterAll(async () => {
  if (prisma) {
    await prisma.client.licenseRenewal.deleteMany({ where: { licenseId: { in: licenceIds } } });
    await prisma.client.softwareLicense.deleteMany({ where: { id: { in: licenceIds } } });
    await prisma.client.maintenanceRecord.deleteMany({ where: { assetId: { in: assetIds } } });
    await prisma.client.asset.deleteMany({ where: { id: { in: assetIds } } });
    await prisma.client.subcategory.deleteMany({ where: { categoryId } });
    await prisma.client.category.deleteMany({ where: { id: categoryId } });
    await prisma.client.office.deleteMany({ where: { id: officeId } });
    await prisma.client.vendor.deleteMany({ where: { id: vendorId } });
    if (foreignCompanyId)
      await prisma.client.company
        .delete({ where: { id: foreignCompanyId } })
        .catch(() => undefined);
    if (originalTimezone) {
      await prisma.client.company.update({
        where: { id: companyId },
        data: { timezone: originalTimezone },
      });
    }
  }
  await app?.close();
});

describe('the summary', () => {
  it('totals each source for the period in the company zone', async () => {
    const res = await summary(s.superAdmin, APRIL);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d = res.body.data;
    expect(d.currency).toBe(base);
    expect(d.period).toMatchObject({
      fromDate: '2011-04-01',
      toDate: '2011-04-30',
      timezone: 'Asia/Kolkata',
      granularity: 'DAY',
      from: '2011-03-31T18:30:00.000Z',
      to: '2011-04-30T18:30:00.000Z',
    });
    expect(d.totals.bySource).toEqual({
      ASSET: { total: '25000.50', count: 1 },
      MAINTENANCE: { total: '1500.25', count: 1 },
      LICENCE: { total: '15000.00', count: 2 },
    });
    expect(d.totals.total).toBe('41500.75');
    expect(d.totals.count).toBe(4);
  });

  it('lists another currency separately and never adds it', async () => {
    const d = (await summary(s.superAdmin, APRIL)).body.data;
    expect(d.otherCurrencies).toEqual([{ currency: other, total: '999.99', count: 1 }]);
    expect(JSON.stringify(d.topExpenses)).not.toContain(`${tag} asset 3`);
  });

  it('never includes a deleted asset, an unapproved repair, or another tenant', async () => {
    const d = (await summary(s.superAdmin, APRIL)).body.data;
    const text = JSON.stringify(d);
    expect(text).not.toContain(`${tag} asset 7`);
    expect(text).not.toContain('unapproved repair');
    expect(text).not.toContain('FOREIGN');
    expect(text).not.toContain('777777');
  });

  it('puts 00:30 IST on 1 May in May, and in April once the company runs on UTC', async () => {
    const may = (await summary(s.superAdmin, 'preset=CUSTOM&from=2011-05-01&to=2011-05-31')).body
      .data;
    expect(may.totals.bySource.ASSET).toEqual({ total: '5000.00', count: 1 });
    expect(may.series.find((p: { key: string }) => p.key === '2011-05-01').total).toBe('5000.00');

    await prisma.client.company.update({ where: { id: companyId }, data: { timezone: 'UTC' } });
    try {
      const april = (await summary(s.superAdmin, APRIL)).body.data;
      expect(april.period.timezone).toBe('UTC');
      expect(april.totals.bySource.ASSET).toEqual({ total: '30000.50', count: 2 });
      expect(april.series.find((p: { key: string }) => p.key === '2011-04-30').total).toBe(
        '5000.00',
      );
    } finally {
      await prisma.client.company.update({
        where: { id: companyId },
        data: { timezone: 'Asia/Kolkata' },
      });
    }
  });

  it('filters by office (licences belong to none) and compares with the previous equal period', async () => {
    const d = (await summary(s.superAdmin, `${APRIL}&officeId=${officeId}`)).body.data;
    expect(d.totals.total).toBe('26500.75');
    expect(d.totals.bySource.LICENCE).toEqual({ total: '0.00', count: 0 });
    expect(d.previousPeriod).toMatchObject({ fromDate: '2011-03-02', toDate: '2011-03-31' });
    expect(d.totals.previousTotal).toBe('100000.00');
    expect(d.totals.changePct).toBe(-73.5);

    expect(d.byType).toEqual([
      {
        id: expect.any(String),
        name: `Expense Chair ${run}`,
        total: '25000.50',
        count: 1,
        sharePct: 94.3,
      },
      {
        id: expect.any(String),
        name: `Expense Laptop ${run}`,
        total: '1500.25',
        count: 1,
        sharePct: 5.7,
      },
    ]);
    expect(d.byOffice).toEqual([
      { id: officeId, name: `Expense Office ${run}`, total: '26500.75', count: 2, sharePct: 100 },
    ]);
    expect(d.topExpenses[0]).toMatchObject({
      source: 'ASSET',
      title: `${tag} asset 2`,
      amount: '25000.50',
      localDate: '2011-04-05',
    });
  });

  it('classifies months against the median and names the highest', async () => {
    const d = (
      await summary(
        s.superAdmin,
        `preset=CUSTOM&from=2011-03-01&to=2011-05-31&officeId=${officeId}`,
      )
    ).body.data;
    expect(d.period.granularity).toBe('MONTH');
    expect(
      d.series.map((p: { key: string; total: string; level: string }) => [p.key, p.total, p.level]),
    ).toEqual([
      ['2011-03', '100000.00', 'HIGH'],
      ['2011-04', '26500.75', 'NORMAL'],
      ['2011-05', '5000.00', 'LOW'],
    ]);
    expect(d.highestBucket).toEqual({ key: '2011-03', label: 'Mar 2011', total: '100000.00' });
    expect(d.lowestBucket).toEqual({ key: '2011-05', label: 'May 2011', total: '5000.00' });
    expect(d.totals.changePct).toBeNull();
  });

  it('counts what is missing and says so in words', async () => {
    const d = (await summary(s.superAdmin, `${APRIL}&officeId=${officeId}`)).body.data;
    expect(d.dataGaps).toMatchObject({
      assetsWithoutPrice: 1,
      pricedAssetsWithoutDate: 1,
      maintenanceClosedWithoutCost: 1,
      maintenanceClosedWithoutDate: 0,
      licencesWithoutCost: 0,
    });
    expect(d.dataGaps.notes).toContain(
      '1 asset has no purchase price, so it is not counted in any total.',
    );
    expect(d.dataGaps.notes).toContain(
      '1 priced asset has no purchase date and is not in any period.',
    );

    const before = (await summary(s.superAdmin, APRIL)).body.data.dataGaps.licencesWithoutCost;
    const costless = await prisma.client.softwareLicense.create({
      data: {
        companyId,
        name: `${tag} costless licence`,
        family: 'OTHER',
        subscriptionType: 'PERPETUAL',
        purchaseDate: new Date('2011-04-01T06:00:00Z'),
        seatsPurchased: 1,
        unitOfAssignment: 'DEVICE',
      },
    });
    licenceIds.push(costless.id);
    const after = (await summary(s.superAdmin, APRIL)).body.data.dataGaps.licencesWithoutCost;
    expect(after).toBe(before + 1);
  });

  it('refuses a bad custom range and an office from another tenant', async () => {
    expect(
      (await summary(s.superAdmin, 'preset=CUSTOM&from=2011-04-30&to=2011-04-01')).status,
    ).toBe(422);
    expect((await summary(s.superAdmin, 'preset=CUSTOM&from=2011-04-01')).status).toBe(422);
    expect(
      (await summary(s.superAdmin, 'preset=CUSTOM&from=2000-01-01&to=2011-01-01')).status,
    ).toBe(422);
    const foreignOffice = await prisma.client.office.create({
      data: { companyId: foreignCompanyId, code: `${tag}-F`, name: 'Foreign office' },
    });
    expect((await summary(s.superAdmin, `${APRIL}&officeId=${foreignOffice.id}`)).status).toBe(404);
  });

  it('answers a preset with an empty-safe shape', async () => {
    const res = await summary(s.superAdmin, 'preset=TODAY');
    expect(res.status).toBe(200);
    expect(res.body.data.series).toHaveLength(1);
    expect(res.body.data.period.days).toBe(1);
  });
});

describe('Super Admin only', () => {
  const roles: AccountKey[] = ['finance', 'officeAdmin', 'itAdmin', 'auditor', 'employee'];

  it.each(roles)('%s gets 403 on summary, export and export-link', async (who) => {
    const sum = await summary(s[who], APRIL);
    expect(sum.status).toBe(403);
    expect(JSON.stringify(sum.body)).toContain('Only a Super Admin');
    expect(
      (await api(app).get(`/api/v1/expenses/export?format=pdf&${APRIL}`).set(auth(s[who]))).status,
    ).toBe(403);
    const link = await api(app)
      .post('/api/v1/expenses/export-link')
      .set(auth(s[who]))
      .send({ format: 'xlsx', preset: 'LAST_30_DAYS' });
    expect(link.status).toBe(403);
  });

  it('a Company Admin gets 403 too', async () => {
    const users = await api(app)
      .get('/api/v1/users?q=employee3&pageSize=1')
      .set(auth(s.superAdmin));
    const id = users.body.data[0].id as string;
    const set = await api(app)
      .patch(`/api/v1/users/${id}/roles`)
      .set(auth(s.superAdmin))
      .send({ roleKeys: ['COMPANY_ADMIN'] });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    try {
      const admin = await login(app, 'employee3@techpioasset.dev', DEMO_PASSWORD);
      expect(admin.user.roles).toContain('COMPANY_ADMIN');
      expect((await summary(admin, APRIL)).status).toBe(403);
      expect(
        (await api(app).get(`/api/v1/expenses/export?format=xlsx&${APRIL}`).set(auth(admin)))
          .status,
      ).toBe(403);
      expect(
        (
          await api(app)
            .post('/api/v1/expenses/export-link')
            .set(auth(admin))
            .send({ format: 'pdf', preset: 'TODAY' })
        ).status,
      ).toBe(403);
    } finally {
      await api(app)
        .patch(`/api/v1/users/${id}/roles`)
        .set(auth(s.superAdmin))
        .send({ roleKeys: ['EMPLOYEE'] });
    }
  });

  it('refuses without a sign-in', async () => {
    expect((await api(app).get(`/api/v1/expenses/summary?${APRIL}`)).status).toBe(401);
  });
});

/** Collect a binary supertest body. */
function binary(
  res: import('superagent').Response,
  callback: (err: Error | null, body: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

const exportsSince = (since: Date, actorId: string) =>
  prisma.client.auditLog.findMany({
    where: {
      action: 'REPORT_EXPORTED',
      entityId: 'EXPENSE_REPORT',
      actorId,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'asc' },
  });

describe('exports', () => {
  it('xlsx: right type, the sheets, the lines, nothing foreign - and audited', async () => {
    const since = new Date();
    const res = await api(app)
      .get(`/api/v1/expenses/export?format=xlsx&${APRIL}`)
      .set(auth(s.superAdmin))
      .buffer(true)
      .parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain(
      'pioassets-expenses-2011-04-01-2011-04-30.xlsx',
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Summary',
      'By day',
      'By type',
      'By category',
      'By office',
      'By vendor',
      'All expenses',
    ]);
    const lines = wb.getWorksheet('All expenses')!;
    const cells: string[] = [];
    lines.eachRow((row) => row.eachCell((cell) => cells.push(String(cell.value))));
    expect(cells).toContain(`${tag} asset 2`);
    expect(cells).toContain(`${tag} licence (renewal)`);
    expect(cells.join('|')).not.toContain('FOREIGN');
    expect(wb.getWorksheet('Summary')!.getImages()).toHaveLength(1);

    const audit = await exportsSince(since, s.superAdmin.user.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.newValues).toMatchObject({ format: 'XLSX', delivery: 'DOWNLOAD', rows: 5 });
  });

  it('pdf: right type and a real PDF', async () => {
    const since = new Date();
    const res = await api(app)
      .get(`/api/v1/expenses/export?format=pdf&${APRIL}&officeId=${officeId}`)
      .set(auth(s.superAdmin))
      .buffer(true)
      .parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const body = res.body as Buffer;
    expect(body.length).toBeGreaterThan(5_000);
    expect(body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const audit = await exportsSince(since, s.superAdmin.user.id);
    expect(audit.map((a) => (a.newValues as { format: string }).format)).toEqual(['PDF']);
  });
});

describe('signed links for the phone', () => {
  const mint = async (format: 'pdf' | 'xlsx') => {
    const res = await api(app)
      .post('/api/v1/expenses/export-link')
      .set(auth(s.superAdmin))
      .send({ format, preset: 'CUSTOM', from: '2011-04-01', to: '2011-04-30' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as { path: string; expiresAt: string; filename: string };
  };

  it('opens with no Authorization header and is audited as a link delivery', async () => {
    const link = await mint('xlsx');
    expect(link.path).toMatch(/^\/expenses\/export-links\/[\w-]+\.[\w-]+$/);
    expect(link.filename).toBe('pioassets-expenses-2011-04-01-2011-04-30.xlsx');
    expect(new Date(link.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(121_000);

    const since = new Date();
    const res = await api(app).get(`/api/v1${link.path}`).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    expect(wb.worksheets).toHaveLength(7);

    const audit = await exportsSince(since, s.superAdmin.user.id);
    expect(audit[0]!.newValues).toMatchObject({ delivery: 'SIGNED_LINK', format: 'XLSX' });
  });

  it('a pdf link returns a PDF', async () => {
    const link = await mint('pdf');
    const res = await api(app).get(`/api/v1${link.path}`).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('a forged signature is a 404', async () => {
    const link = await mint('pdf');
    const slash = link.path.lastIndexOf('/');
    const [payload, signature] = link.path.slice(slash + 1).split('.') as [string, string];
    const first = signature.slice(0, 1) === 'A' ? 'B' : 'A';
    const res = await api(app).get(
      `/api/v1/expenses/export-links/${payload}.${first}${signature.slice(1)}`,
    );
    expect(res.status).toBe(404);

    // Nor can the claims be edited under a genuine signature.
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    claims.c = foreignCompanyId;
    const swapped = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
    expect((await api(app).get(`/api/v1/expenses/export-links/${swapped}`)).status).toBe(404);
  });

  it('an expired link is a 401', async () => {
    const link = await mint('pdf');
    const realNow = Date.now;
    Date.now = () => realNow() + 5 * 60 * 1000;
    try {
      expect((await api(app).get(`/api/v1${link.path}`)).status).toBe(401);
    } finally {
      Date.now = realNow;
    }
  });

  it('a genuinely signed link naming another company serves nothing of it', async () => {
    const { token } = signDownloadLink(secret, 'expense-report-link', {
      fileId: JSON.stringify({
        u: s.superAdmin.user.id,
        f: 'xlsx',
        q: { preset: 'CUSTOM', from: '2011-04-01', to: '2011-04-30' },
      }),
      companyId: foreignCompanyId,
    });
    const res = await api(app).get(`/api/v1/expenses/export-links/${token}`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('FOREIGN');
  });

  it('a link signed for another kind of file does not open here', async () => {
    const { token } = signDownloadLink(secret, 'invoice-document-link', { fileId: 'x', companyId });
    expect((await api(app).get(`/api/v1/expenses/export-links/${token}`)).status).toBe(404);
  });

  it('a link stops working when its signer is no longer a Super Admin', async () => {
    const { token } = signDownloadLink(secret, 'expense-report-link', {
      fileId: JSON.stringify({ u: s.finance.user.id, f: 'pdf', q: { preset: 'TODAY' } }),
      companyId,
    });
    expect((await api(app).get(`/api/v1/expenses/export-links/${token}`)).status).toBe(403);
  });
});
