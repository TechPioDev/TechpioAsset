import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Company contact details (v2.59) - the letterhead printed on exported reports.
 *
 * Pins what the settings form may save: phone numbers as people write them
 * (Indian mobiles with a +91 and spaces included), a real email address, and a
 * free-text address - and that an empty box clears the stored value rather than
 * saving an empty string.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let original: { contactPhone: string | null; contactEmail: string | null; address: string | null };

const save = (body: Record<string, unknown>, who: AccountKey = 'superAdmin') =>
  api(app).patch('/api/v1/company').set(auth(s[who])).send(body);
const read = () => api(app).get('/api/v1/company').set(auth(s.superAdmin));

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);
  original = await prisma.client.company.findUniqueOrThrow({
    where: { id: s.superAdmin.user.companyId },
    select: { contactPhone: true, contactEmail: true, address: true },
  });
});

afterAll(async () => {
  if (prisma && s) {
    await prisma.client.company.update({
      where: { id: s.superAdmin.user.companyId },
      data: original,
    });
  }
  await app?.close();
});

describe('company contact details', () => {
  it('saves valid values, normalised, and reads them back', async () => {
    const res = await save({
      contactPhone: '  +91 98765 43210 ',
      contactEmail: ' Accounts@TechPio.COM ',
      address: 'Plot 12, Phase 8\r\nIndustrial Area\nMohali 160071',
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

    const got = await read();
    expect(got.status).toBe(200);
    expect(got.body.data.contactPhone).toBe('+91 98765 43210');
    expect(got.body.data.contactEmail).toBe('accounts@techpio.com');
    expect(got.body.data.address).toBe('Plot 12, Phase 8\nIndustrial Area\nMohali 160071');

    for (const phone of ['(0172) 500-1234', '+1-202-555-0143', '9876543210']) {
      const ok = await save({ contactPhone: phone });
      expect(ok.status, phone).toBeLessThan(300);
    }
  });

  it('audits the previous and new values', async () => {
    await save({ contactPhone: '+91 98765 43210' });
    const res = await save({ contactPhone: '+91 99999 11111' });
    expect(res.status).toBeLessThan(300);
    const row = await prisma.client.auditLog.findFirst({
      where: {
        companyId: s.superAdmin.user.companyId,
        entityType: 'Company',
        action: 'SETTING_CHANGED',
      },
      orderBy: { createdAt: 'desc' },
      select: { previousValues: true, newValues: true },
    });
    expect((row?.previousValues as Record<string, unknown>).contactPhone).toBe('+91 98765 43210');
    expect((row?.newValues as Record<string, unknown>).contactPhone).toBe('+91 99999 11111');
  });

  it('refuses a malformed phone with a clear message and stores nothing', async () => {
    await save({ contactPhone: '+91 98765 43210' });
    const cases: [string, string][] = [
      ['12345', '6 to 20 characters'],
      ['+91 98765 43210 00000', '6 to 20 characters'],
      ['call 98765 43210', 'only digits'],
      ['98765-ext', 'only digits'],
      ['+( ) - 12', 'at least 6 digits'],
    ];
    for (const [phone, message] of cases) {
      const res = await save({ contactPhone: phone });
      expect(res.status, phone).toBe(422);
      expect(JSON.stringify(res.body), phone).toContain(message);
    }
    expect((await read()).body.data.contactPhone).toBe('+91 98765 43210');
  });

  it('refuses a malformed or over-long email', async () => {
    for (const email of ['not-an-email', 'a@b', `${'x'.repeat(250)}@example.com`]) {
      const res = await save({ contactEmail: email });
      expect(res.status, email).toBe(422);
      expect(JSON.stringify(res.body)).toMatch(/valid email|254 characters/);
    }
  });

  it('refuses an address over 500 characters', async () => {
    const res = await save({ address: 'x'.repeat(501) });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('500 characters');
  });

  it('clears a value when sent an empty string, and leaves omitted fields alone', async () => {
    await save({
      contactPhone: '+91 98765 43210',
      contactEmail: 'a@techpio.com',
      address: 'Mohali',
    });
    const res = await save({ contactPhone: '', address: '   ' });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    const got = await read();
    expect(got.body.data.contactPhone).toBeNull();
    expect(got.body.data.address).toBeNull();
    expect(got.body.data.contactEmail).toBe('a@techpio.com');
  });

  it('is closed to anyone without settings:manage', async () => {
    for (const who of ['finance', 'employee', 'itAdmin'] as const) {
      const res = await save({ contactPhone: '+91 98765 43210' }, who);
      expect(res.status, who).toBe(403);
      const get = await api(app).get('/api/v1/company').set(auth(s[who]));
      expect(get.status, who).toBe(403);
    }
  });
});
