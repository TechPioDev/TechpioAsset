import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * The price sheet (v2.59): purchase price and date for existing assets, by an
 * Excel round-trip.
 *
 * Every test here goes through the real file: the sheet is downloaded from the
 * API, filled in with ExcelJS the way a person fills it in Excel, and uploaded
 * back. The rules proven are the ones that make a bulk money write safe - a
 * recorded price is never overwritten, a recorded date is never overwritten,
 * nothing crosses a tenant, and every write lands in the audit trail.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let companyId: string;
/** Blank Currency cells take the company's base currency. */
let baseCurrency: string;
const startedAt = new Date();
const run = Date.now().toString(36);

/** Seeded assets by role in the story. */
const ids: Record<string, string> = {};
const tag = (key: string) => `PS-${run}-${key}`;
let foreignCompanyId: string;
let foreignAssetId: string;
const foreignTag = `PSF-${run}`;

const binary = (
  res: NodeJS.ReadableStream,
  callback: (err: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

const download = (who: AccountKey) =>
  api(app).get('/api/v1/assets/price-sheet').set(auth(s[who])).buffer(true).parse(binary);

const upload = (who: AccountKey, file: Buffer, dryRun?: boolean) =>
  api(app)
    .post(`/api/v1/assets/price-sheet${dryRun === undefined ? '' : `?dryRun=${dryRun}`}`)
    .set(auth(s[who]))
    .attach('file', file, 'price-sheet.xlsx');

interface RowResult {
  row: number;
  assetTag: string;
  outcomes: string[];
  messages: string[];
  applied: boolean;
}

/** Download the sheet as Finance, apply `fill` to rows by tag, return the bytes. */
async function filledSheet(
  fill: Record<string, { price?: ExcelJS.CellValue; date?: ExcelJS.CellValue; currency?: string }>,
  extraRows: { tag: string; price?: ExcelJS.CellValue; date?: ExcelJS.CellValue }[] = [],
): Promise<Buffer> {
  const res = await download('finance');
  expect(res.status).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body as ArrayBuffer);
  const ws = wb.worksheets[0]!;
  const { headerRow, col } = locate(ws);
  let last = headerRow;
  for (let r = headerRow + 1; r <= ws.rowCount; r += 1) {
    const t = ws.getRow(r).getCell(col.tag).value;
    if (!t) continue;
    last = r;
    const f = fill[String(t)];
    if (!f) continue;
    if (f.price !== undefined) ws.getRow(r).getCell(col.price).value = f.price;
    if (f.date !== undefined) ws.getRow(r).getCell(col.date).value = f.date;
    if (f.currency !== undefined) ws.getRow(r).getCell(col.currency).value = f.currency;
  }
  for (const [i, extra] of extraRows.entries()) {
    const row = ws.getRow(last + 1 + i);
    row.getCell(col.tag).value = extra.tag;
    if (extra.price !== undefined) row.getCell(col.price).value = extra.price;
    if (extra.date !== undefined) row.getCell(col.date).value = extra.date;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function locate(ws: ExcelJS.Worksheet) {
  for (let r = 1; r <= 40; r += 1) {
    const values = (ws.getRow(r).values as ExcelJS.CellValue[]).map((v) => String(v ?? ''));
    const tagCol = values.indexOf('Asset tag');
    if (tagCol > 0) {
      return {
        headerRow: r,
        headings: values,
        col: {
          tag: tagCol,
          price: values.indexOf('New purchase price'),
          date: values.indexOf('New purchase date (YYYY-MM-DD)'),
          currency: values.indexOf('Currency'),
          currentPrice: values.indexOf('Current purchase price'),
        },
      };
    }
  }
  throw new Error('No header row');
}

const byTag = (results: RowResult[], key: string) => {
  const found = results.find((r) => r.assetTag === tag(key));
  if (!found) throw new Error(`No result for ${key}`);
  return found;
};

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);
  companyId = s.superAdmin.user.companyId;
  baseCurrency = (
    await prisma.client.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { baseCurrency: true },
    })
  ).baseCurrency;

  const category = await prisma.client.category.findFirstOrThrow({
    where: { companyId },
    select: { id: true },
  });
  const make = async (key: string, extra: Record<string, unknown> = {}) => {
    const a = await prisma.client.asset.create({
      data: {
        companyId,
        assetTag: tag(key),
        name: `Price sheet probe ${key}`,
        categoryId: category.id,
        qrToken: `ps-${run}-${key}`,
        ...extra,
      },
      select: { id: true },
    });
    ids[key] = a.id;
  };
  await make('fresh'); // unpriced, undated - gets both
  await make('priced', {
    purchaseCost: '50000.00',
    currency: 'INR',
    purchaseDate: new Date('2023-01-10T00:00:00.000Z'),
  });
  await make('dateCell'); // date typed as a real Excel date
  await make('negative');
  await make('decimals');
  await make('zero');
  await make('words');
  await make('future');
  await make('ancient');
  await make('badFormat');
  await make('usd');

  const foreign = await prisma.client.company.create({
    data: { name: `Price Sheet Probe Tenant ${run}` },
    select: { id: true },
  });
  foreignCompanyId = foreign.id;
  const foreignCategory = await prisma.client.category.create({
    data: { companyId: foreignCompanyId, key: `ps-${run}`, name: 'Probe' },
    select: { id: true },
  });
  foreignAssetId = (
    await prisma.client.asset.create({
      data: {
        companyId: foreignCompanyId,
        assetTag: foreignTag,
        name: 'Foreign laptop',
        categoryId: foreignCategory.id,
        qrToken: `psf-${run}`,
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  if (prisma) {
    const all = [...Object.values(ids), foreignAssetId].filter(Boolean);
    await prisma.client.$executeRawUnsafe(
      `DELETE FROM audit_logs WHERE "entityId" = ANY($1::text[])`,
      all,
    );
    await prisma.client.$executeRawUnsafe(
      `DELETE FROM audit_logs WHERE "entityId" IN ('ASSET_PRICE_SHEET', 'bulk-price-sheet') AND "createdAt" >= $1`,
      startedAt,
    );
    await prisma.client.$executeRawUnsafe(`DELETE FROM assets WHERE id = ANY($1::text[])`, all);
    await prisma.client.category
      .deleteMany({ where: { companyId: foreignCompanyId } })
      .catch(() => undefined);
    await prisma.client.company.delete({ where: { id: foreignCompanyId } }).catch(() => undefined);
  }
  await app?.close();
});

describe('downloading the price sheet', () => {
  it('is a branded xlsx of every asset in the company and none from another', async () => {
    const res = await download('finance');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toMatch(/price-sheet-\d{4}-\d{2}-\d{2}\.xlsx/);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe('Price sheet');
    expect(wb.getWorksheet('Instructions')).toBeTruthy();
    // The logo survives the wrapper reopening the report workbook.
    expect(ws.getImages().length).toBeGreaterThan(0);

    const { headerRow, headings, col } = locate(ws);
    for (const heading of [
      'Asset tag',
      'Name',
      'Category',
      'Type',
      'Office',
      'Assigned to',
      'Current purchase price',
      'Currency',
      'Current purchase date',
      'New purchase price',
      'New purchase date (YYYY-MM-DD)',
    ]) {
      expect(headings).toContain(heading);
    }

    const tags: string[] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r += 1) {
      const v = ws.getRow(r).getCell(col.tag).value;
      if (v) tags.push(String(v));
    }
    const expected = await prisma.client.asset.count({ where: { companyId } });
    expect(tags.length).toBe(expected);
    expect(tags).toContain(tag('fresh'));
    expect(tags).not.toContain(foreignTag);

    // The key column is locked; the input columns are not.
    const firstData = ws.getRow(headerRow + 1);
    expect(firstData.getCell(col.tag).protection?.locked).not.toBe(false);
    expect(firstData.getCell(col.price).protection?.locked).toBe(false);

    const pricedRow = tags.indexOf(tag('priced')) + headerRow + 1;
    expect(ws.getRow(pricedRow).getCell(col.currentPrice).value).toBe(50000);
  });

  it('is closed to roles without cost visibility, and to cost without write rights', async () => {
    for (const who of ['employee', 'itAdmin', 'officeAdmin', 'hr', 'manager'] as const) {
      const res = await download(who);
      expect(res.status, who).toBe(403);
    }
    // A few bytes, not a real sheet. The permission refusal comes before the
    // body is read, and with the full sheet - every asset in the test database -
    // the server answered 403 and closed while supertest was still sending, so
    // the test failed with ECONNRESET about two runs in three. What is under
    // test is who may upload, not what.
    const file = Buffer.from('not read before the refusal');
    for (const who of ['employee', 'itAdmin', 'officeAdmin'] as const) {
      const res = await upload(who, file, true);
      expect(res.status, who).toBe(403);
    }
    expect((await download('superAdmin')).status).toBe(200);
  });
});

describe('uploading a filled price sheet', () => {
  it('previews every outcome without changing anything', async () => {
    const file = await filledSheet(
      {
        [tag('fresh')]: { price: '68,000.50', date: '2024-03-15' },
        [tag('priced')]: { price: 60000, date: '2023-01-10' },
        [tag('dateCell')]: { date: new Date('2024-02-29T00:00:00.000Z') },
        [tag('negative')]: { price: -5 },
        [tag('decimals')]: { price: '12.345' },
        [tag('zero')]: { price: 0 },
        [tag('words')]: { price: 'about 5k' },
        [tag('future')]: { date: '2099-01-01' },
        [tag('ancient')]: { date: '1985-05-01' },
        [tag('badFormat')]: { date: '15/03/2024' },
        [tag('usd')]: { price: 999.99, currency: 'usd' },
      },
      [
        { tag: foreignTag, price: 1000 },
        { tag: `NOPE-${run}`, price: 1000 },
      ],
    );

    const res = await upload('finance', file); // no dryRun param = preview
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body.data;
    expect(body.dryRun).toBe(true);
    const results = body.results as RowResult[];

    expect(byTag(results, 'fresh').outcomes).toEqual(['WILL_SET_PRICE', 'WILL_SET_DATE']);
    expect(byTag(results, 'dateCell').outcomes).toEqual(['WILL_SET_DATE']);
    expect(byTag(results, 'usd').outcomes).toEqual(['WILL_SET_PRICE']);

    const priced = byTag(results, 'priced');
    expect(priced.outcomes).toEqual(['ERROR']);
    expect(priced.messages.join()).toContain('Price already recorded (₹50,000.00)');

    const expectError = (key: string, text: string) => {
      const r = byTag(results, key);
      expect(r.outcomes, key).toEqual(['ERROR']);
      expect(r.messages.join(' | '), key).toContain(text);
    };
    expectError('negative', 'cannot be negative');
    expectError('decimals', 'more than 2 decimal places');
    expectError('zero', 'more than zero');
    expectError('words', 'is not a number');
    expectError('future', 'in the future');
    expectError('ancient', 'before 1990');
    expectError('badFormat', 'YYYY-MM-DD');

    const foreign = results.find((r) => r.assetTag === foreignTag)!;
    expect(foreign.outcomes).toEqual(['ERROR']);
    expect(foreign.messages.join()).toContain('No asset with tag');
    const unknown = results.find((r) => r.assetTag === `NOPE-${run}`)!;
    expect(unknown.outcomes).toEqual(['ERROR']);

    // Untouched rows are unchanged, not errors.
    expect(body.counts.unchanged).toBeGreaterThan(0);
    expect(body.counts.pricesToSet).toBeGreaterThanOrEqual(2);
    expect(body.applied).toEqual({ rows: 0, prices: 0, dates: 0 });

    const fresh = await prisma.client.asset.findUniqueOrThrow({
      where: { id: ids.fresh },
      select: { purchaseCost: true, purchaseDate: true },
    });
    expect(fresh.purchaseCost).toBeNull();
    expect(fresh.purchaseDate).toBeNull();
    const foreignAsset = await prisma.client.asset.findUniqueOrThrow({
      where: { id: foreignAssetId },
      select: { purchaseCost: true },
    });
    expect(foreignAsset.purchaseCost).toBeNull();
  });

  it('applies the valid rows, audits each write, and never overwrites a recorded price', async () => {
    const file = await filledSheet(
      {
        [tag('fresh')]: { price: '68,000.50', date: '2024-03-15' },
        [tag('priced')]: { price: 60000 },
        [tag('dateCell')]: { date: new Date('2024-02-29T00:00:00.000Z') },
        [tag('negative')]: { price: -5, date: '2024-01-01' },
      },
      [{ tag: foreignTag, price: 1000 }],
    );

    const res = await upload('finance', file, false);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body.data;
    expect(body.dryRun).toBe(false);
    expect(body.applied).toEqual({ rows: 2, prices: 1, dates: 2 });
    const results = body.results as RowResult[];
    expect(byTag(results, 'fresh').applied).toBe(true);
    expect(byTag(results, 'priced').applied).toBe(false);

    const fresh = await prisma.client.asset.findUniqueOrThrow({
      where: { id: ids.fresh },
      select: { purchaseCost: true, currency: true, purchaseDate: true, version: true },
    });
    expect(fresh.purchaseCost?.toFixed(2)).toBe('68000.50');
    expect(fresh.currency).toBe(baseCurrency);
    expect(fresh.purchaseDate?.toISOString()).toBe('2024-03-15T00:00:00.000Z');

    const dated = await prisma.client.asset.findUniqueOrThrow({
      where: { id: ids.dateCell },
      select: { purchaseCost: true, purchaseDate: true },
    });
    expect(dated.purchaseDate?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(dated.purchaseCost).toBeNull();

    // A row with any error changes nothing - not even its valid date.
    const negative = await prisma.client.asset.findUniqueOrThrow({
      where: { id: ids.negative },
      select: { purchaseDate: true },
    });
    expect(negative.purchaseDate).toBeNull();

    const priced = await prisma.client.asset.findUniqueOrThrow({
      where: { id: ids.priced },
      select: { purchaseCost: true },
    });
    expect(priced.purchaseCost?.toFixed(2)).toBe('50000.00');

    const foreign = await prisma.client.asset.findUniqueOrThrow({
      where: { id: foreignAssetId },
      select: { purchaseCost: true },
    });
    expect(foreign.purchaseCost).toBeNull();

    const costAudit = await prisma.client.auditLog.findMany({
      where: { companyId, entityId: ids.fresh, action: 'ASSET_COST_CHANGED' },
      select: { actorId: true, newValues: true },
    });
    expect(costAudit).toHaveLength(1);
    expect(costAudit[0]!.actorId).toBe(s.finance.user.id);
    expect(costAudit[0]!.newValues).toMatchObject({
      purchaseCost: '68000.50',
      currency: baseCurrency,
      source: 'price-sheet',
    });
    const dateAudit = await prisma.client.auditLog.findMany({
      where: { companyId, entityId: { in: [ids.fresh!, ids.dateCell!] }, action: 'ASSET_UPDATED' },
      select: { entityId: true, newValues: true },
    });
    expect(dateAudit).toHaveLength(2);
    expect(dateAudit.find((a) => a.entityId === ids.dateCell)?.newValues).toMatchObject({
      purchaseDate: '2024-02-29',
    });
    expect(await prisma.client.auditLog.count({ where: { companyId: foreignCompanyId } })).toBe(0);

    // Uploading the same sheet again is harmless: what was saved reads as unchanged.
    const again = await upload('finance', file, false);
    expect(again.status).toBe(200);
    const second = again.body.data.results as RowResult[];
    expect(byTag(second, 'fresh').outcomes).toEqual(['UNCHANGED']);
    expect(byTag(second, 'dateCell').outcomes).toEqual(['UNCHANGED']);
    expect(again.body.data.applied.rows).toBe(0);
  });

  it('refuses a different date where one is already recorded', async () => {
    const file = await filledSheet({ [tag('dateCell')]: { date: '2024-03-01' } });
    const res = await upload('superAdmin', file, false);
    expect(res.status).toBe(200);
    const r = byTag(res.body.data.results as RowResult[], 'dateCell');
    expect(r.outcomes).toEqual(['ERROR']);
    expect(r.messages.join()).toContain('Purchase date already recorded (2024-02-29)');
    const dated = await prisma.client.asset.findUniqueOrThrow({
      where: { id: ids.dateCell },
      select: { purchaseDate: true },
    });
    expect(dated.purchaseDate?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });

  it('a Super Admin still cannot overwrite a recorded price through the sheet', async () => {
    const file = await filledSheet({ [tag('priced')]: { price: 1 } });
    const res = await upload('superAdmin', file, false);
    expect(res.status).toBe(200);
    expect(byTag(res.body.data.results as RowResult[], 'priced').outcomes).toEqual(['ERROR']);
    const priced = await prisma.client.asset.findUniqueOrThrow({
      where: { id: ids.priced },
      select: { purchaseCost: true },
    });
    expect(priced.purchaseCost?.toFixed(2)).toBe('50000.00');
  });

  it('rejects files that are not a price sheet', async () => {
    const notSheet = await upload('finance', Buffer.from('hello, world'), true);
    expect(notSheet.status).toBe(400);

    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Other').addRow(['Serial', 'Cost']);
    const wrong = await upload('finance', Buffer.from(await wb.xlsx.writeBuffer()), true);
    expect(wrong.status).toBe(400);
    expect(JSON.stringify(wrong.body)).toContain('price sheet');

    const bad = await upload('finance', await filledSheet({}), 'maybe' as unknown as boolean);
    expect(bad.status).toBe(422);
  });
});
