import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AssetsService } from '../src/assets/assets.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v3.6 — the nightly fleet snapshot, and the trend it makes possible.
 *
 * The dashboard mock asked for "+12% vs last month" on every card. Nothing in
 * the product had ever recorded yesterday's count, so that figure could only
 * have been decoration. These tests cover the two halves of making it real:
 * the recorder that writes one row per company per day, and the read that
 * refuses to say anything when there is no honest comparison to make.
 *
 * The one that matters most is "no baseline, no trend". A dashboard that
 * reports 0% when nobody measured is worse than one that reports nothing, and
 * 0% is exactly what the obvious implementation produces.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let assets: AssetsService;
let companyId = '';
const tags: string[] = [];

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  assets = app.get(AssetsService);
  companyId = s.itAdmin.user.companyId;
});

afterAll(async () => {
  await prisma?.client.asset.deleteMany({ where: { assetTag: { in: tags } } });
  await prisma?.client.fleetSnapshot.deleteMany({ where: { companyId } });
  await app?.close();
});

// Each test starts from "nothing has ever been recorded", so a trend that
// appears can only have come from the row that test wrote.
beforeEach(async () => {
  await prisma.client.fleetSnapshot.deleteMany({ where: { companyId } });
});

const midnightUtc = (daysAgo: number) => {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/**
 * Every count is required by the schema - there is no `@default(0)` on any of
 * them - so a baseline has to be stated in full. That is deliberate: for a
 * count column 0 is a real value, so a default would let a half-written row
 * read as a measurement of an empty fleet. The whole fleet goes in `assigned`
 * here; these tests only ever read `total`.
 */
async function seedBaseline(daysAgo: number, total: number, forCompany = companyId) {
  return prisma.client.fleetSnapshot.create({
    data: {
      companyId: forCompany,
      takenOn: midnightUtc(daysAgo),
      total,
      assigned: total,
      available: 0,
      inStock: 0,
      onOrder: 0,
      underRepair: 0,
      critical: 0,
      retired: 0,
      other: 0,
    },
    select: { id: true, takenOn: true },
  });
}

const stats = async () => {
  const res = await api(app).get('/api/v1/assets/stats').set(auth(s.itAdmin));
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  return res.body.data as {
    total: number;
    trend: {
      change: number;
      changePercent: number | null;
      ageDays: number;
      direction: string;
    } | null;
  };
};

describe('recording the snapshot', () => {
  it('writes one row for today, at midnight UTC', async () => {
    await assets.recordFleetSnapshots();

    const rows = await prisma.client.fleetSnapshot.findMany({ where: { companyId } });
    expect(rows).toHaveLength(1);
    const takenOn = rows[0].takenOn;
    // The row describes a DAY. If the sweep's clock leaked into the value,
    // two runs on the same evening would land on different keys and the
    // upsert below would insert instead of update.
    expect(takenOn.getUTCHours()).toBe(0);
    expect(takenOn.getUTCMinutes()).toBe(0);
    expect(takenOn.getUTCSeconds()).toBe(0);
    expect(takenOn.getUTCMilliseconds()).toBe(0);
  });

  it('a second run on the same day updates rather than duplicating', async () => {
    await assets.recordFleetSnapshots();
    const first = await prisma.client.fleetSnapshot.findFirstOrThrow({ where: { companyId } });

    await assets.recordFleetSnapshots();

    const rows = await prisma.client.fleetSnapshot.findMany({ where: { companyId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
  });

  it('the parts sum to the total it recorded', async () => {
    await assets.recordFleetSnapshots();
    const r = await prisma.client.fleetSnapshot.findFirstOrThrow({ where: { companyId } });

    // The same invariant the cards are held to: a breakdown that does not add
    // up to the headline is how this dashboard showed 169 assets over a bar
    // summing to 100.
    const parts =
      r.assigned +
      r.available +
      r.inStock +
      r.onOrder +
      r.underRepair +
      r.critical +
      r.retired +
      r.other;
    expect(parts).toBe(r.total);
  });

  it('counts the same population the dashboard reports', async () => {
    await assets.recordFleetSnapshots();
    const r = await prisma.client.fleetSnapshot.findFirstOrThrow({ where: { companyId } });

    // Not a restatement of the implementation: the endpoint counts through the
    // caller's scope and the soft-delete filter, the recorder counts straight
    // from the table. If those two ever diverge, every trend is a comparison
    // between two different fleets.
    const live = await stats();
    expect(r.total).toBe(live.total);
  });

  it('records a row per company, not one for whoever ran first', async () => {
    await assets.recordFleetSnapshots();

    const companies = await prisma.client.company.count({ where: { deletedAt: null } });
    const rows = await prisma.client.fleetSnapshot.count({ where: { takenOn: midnightUtc(0) } });
    expect(rows).toBe(companies);

    // Written for other tenants too, so clean up what this test created
    // outside the company the afterAll sweeps.
    await prisma.client.fleetSnapshot.deleteMany({ where: { takenOn: midnightUtc(0) } });
  });
});

describe('the trend on /assets/stats', () => {
  it('is null when nothing was ever recorded', async () => {
    const { trend } = await stats();
    // The whole point of Phase B: silence, not a confident 0%.
    expect(trend).toBeNull();
  });

  it('is null when the only snapshot is too young to call last month', async () => {
    await seedBaseline(3, 1);
    const { trend } = await stats();
    expect(trend).toBeNull();
  });

  it('is null when the only snapshot is older than the window', async () => {
    await seedBaseline(120, 1);
    const { trend } = await stats();
    expect(trend).toBeNull();
  });

  it('reports the change, the percentage and the real age', async () => {
    const live = await stats();
    const baselineTotal = Math.max(1, live.total - 4);
    await seedBaseline(30, baselineTotal);

    const { trend } = await stats();
    expect(trend).not.toBeNull();
    expect(trend!.change).toBe(live.total - baselineTotal);
    expect(trend!.changePercent).toBe(
      Math.round(((live.total - baselineTotal) / baselineTotal) * 100),
    );
    // The window is 20-45 days, so the dashboard states the gap it measured
    // instead of rounding it to the word "month".
    expect(trend!.ageDays).toBe(30);
    expect(trend!.direction).toBe(live.total > baselineTotal ? 'up' : 'flat');
  });

  it('prefers the freshest eligible snapshot over an older one', async () => {
    await seedBaseline(44, 1);
    await seedBaseline(21, 2);

    const { trend } = await stats();
    expect(trend!.ageDays).toBe(21);
  });

  it('is null for a caller who cannot see the whole fleet', async () => {
    const live = await stats();
    await seedBaseline(30, Math.max(1, live.total - 4));

    // The snapshot counts the company; an employee's total counts the three
    // things they hold. Showing the difference would tell them their fleet
    // shrank by a hundred and sixty assets.
    const res = await api(app).get('/api/v1/assets/stats').set(auth(s.employee));
    expect(res.status).toBe(200);
    expect(res.body.data.trend).toBeNull();

    // And the admin, on the same baseline, does get one - so this test fails
    // if the gate is wired to something that is simply always null.
    const mine = await stats();
    expect(mine.trend).not.toBeNull();
  });

  it('ignores another company’s snapshots', async () => {
    const other = await prisma.client.company.findFirst({
      where: { id: { not: companyId }, deletedAt: null },
      select: { id: true },
    });
    if (!other) return; // single-tenant fixture, nothing to prove here

    await seedBaseline(30, 9_999, other.id);

    const { trend } = await stats();
    // A tenant with no history of its own must not inherit someone else's.
    expect(trend).toBeNull();

    await prisma.client.fleetSnapshot.deleteMany({ where: { companyId: other.id } });
  });
});
