import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * The company timezone (v2.57).
 *
 * The mobile app has always offered it as free text, and the server took any
 * string, so "IST" or "India" would be saved as-is. The runtime's own zone
 * check is too forgiving to lean on alone - it takes "IST" and "+05:30" and
 * turns "EST" into America/Panama - so these pin exactly what gets through.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let original: string;

const save = (timezone: string) =>
  api(app).patch('/api/v1/company').set(auth(s.superAdmin)).send({ timezone });

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);
  const company = await prisma.client.company.findUniqueOrThrow({
    where: { id: s.superAdmin.user.companyId },
    select: { timezone: true },
  });
  original = company.timezone;
});

afterAll(async () => {
  await prisma.client.company.update({
    where: { id: s.superAdmin.user.companyId },
    data: { timezone: original },
  });
  await app?.close();
});

describe('saving the company timezone', () => {
  it('accepts a real region/city zone and UTC, and reads them back', async () => {
    for (const zone of ['Asia/Kolkata', 'America/Argentina/Buenos_Aires', 'UTC']) {
      const res = await save(zone);
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      const read = await api(app).get('/api/v1/company').set(auth(s.superAdmin));
      expect(read.body.data.timezone).toBe(zone);
    }
  });

  it('refuses abbreviations, offsets, lower case and made-up places', async () => {
    await save('Asia/Kolkata');
    for (const junk of ['IST', 'EST', '+05:30', 'GMT+5:30', 'asia/kolkata', 'India', 'Asia/Atlantis']) {
      const res = await save(junk);
      expect(res.status, junk).toBe(422);
      expect(JSON.stringify(res.body)).toContain('Asia/Kolkata or UTC');
    }
    // Nothing refused was stored.
    const read = await api(app).get('/api/v1/company').set(auth(s.superAdmin));
    expect(read.body.data.timezone).toBe('Asia/Kolkata');
  });
});

describe('scheduled reports run on the company clock', () => {
  it('arms a 09:00 schedule at 09:00 company time, and re-arms it when the zone changes', async () => {
    expect((await save('Asia/Kolkata')).status).toBeLessThan(300);

    const created = await api(app)
      .post('/api/v1/scheduled/reports')
      .set(auth(s.superAdmin))
      .send({
        name: `TZ-${Date.now()} daily inventory`,
        type: 'ASSET_INVENTORY',
        format: 'CSV',
        cron: '0 9 * * *',
        recipients: ['tz-check@techpioasset.dev'],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;
    try {
      // 09:00 in India is 03:30 UTC. Read in the server's zone it was 09:00Z.
      expect(new Date(created.body.data.nextRunAt).toISOString()).toMatch(/T03:30:00\.000Z$/);

      expect((await save('UTC')).status).toBeLessThan(300);
      const rearmed = await prisma.client.scheduledReport.findUniqueOrThrow({
        where: { id },
        select: { nextRunAt: true },
      });
      expect(rearmed.nextRunAt?.toISOString()).toMatch(/T09:00:00\.000Z$/);
    } finally {
      await prisma.client.scheduledReport.delete({ where: { id } });
    }
  });
});

