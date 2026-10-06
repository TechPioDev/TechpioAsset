import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v3.9 — two asset types with the same name, in different categories.
 *
 * Type names are unique within a category, not across them, so a tenant can
 * genuinely hold a "Laptop" under Hardware and a "Laptop" under IT assets.
 * Grouping by type then produced two rows a reader could not tell apart:
 *
 *     Laptop  53
 *     Laptop   8
 *
 * The rule itself is unit-tested in packages/domain. This covers the WIRING,
 * which is the part that can regress in silence: the service has to fetch each
 * type's category alongside its name. Drop that one `select` and every
 * qualifier becomes null, the duplicates come back, and nothing fails to
 * compile.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
const madeTypes: string[] = [];
const madeCategories: string[] = [];
const madeAssets: string[] = [];
const sharedName = `Collider ${Math.random().toString(36).slice(2, 7)}`;
/** A name nothing else in the tenant can share, so it must come back bare. */
const uniqueName = `Solo ${Math.random().toString(36).slice(2, 9)}`;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  const companyId = s.itAdmin.user.companyId;

  // Two categories, each with a type of the SAME name, each holding an asset.
  for (const [i, categoryName] of [`Alpha ${sharedName}`, `Beta ${sharedName}`].entries()) {
    const category = await prisma.client.category.create({
      data: { companyId, name: categoryName, key: `collide-cat-${i}-${Date.now()}` },
      select: { id: true },
    });
    madeCategories.push(category.id);
    const type = await prisma.client.subcategory.create({
      // No companyId here: a Subcategory belongs to a Category, which is what
      // carries the tenant.
      data: { categoryId: category.id, name: sharedName, key: `collide-${i}` },
      select: { id: true },
    });
    madeTypes.push(type.id);
    const tag = `COLLIDE-${i}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const asset = await prisma.client.asset.create({
      data: {
        companyId,
        assetTag: tag,
        name: `Collider ${i}`,
        categoryId: category.id,
        subcategoryId: type.id,
        status: 'AVAILABLE' as never,
        condition: 'GOOD' as never,
        qrToken: `qr-${tag}`,
      },
      select: { id: true },
    });
    madeAssets.push(asset.id);
  }

  // And one type whose name nothing else holds.
  const soloCategory = await prisma.client.category.create({
    data: { companyId, name: `Solo cat ${uniqueName}`, key: `solo-cat-${Date.now()}` },
    select: { id: true },
  });
  madeCategories.push(soloCategory.id);
  const soloType = await prisma.client.subcategory.create({
    data: { categoryId: soloCategory.id, name: uniqueName, key: `solo-${Date.now()}` },
    select: { id: true },
  });
  madeTypes.push(soloType.id);
  const soloTag = `SOLO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const soloAsset = await prisma.client.asset.create({
    data: {
      companyId,
      assetTag: soloTag,
      name: 'Solo',
      categoryId: soloCategory.id,
      subcategoryId: soloType.id,
      status: 'AVAILABLE' as never,
      condition: 'GOOD' as never,
      qrToken: `qr-${soloTag}`,
    },
    select: { id: true },
  });
  madeAssets.push(soloAsset.id);
});

afterAll(async () => {
  await prisma?.client.asset.deleteMany({ where: { id: { in: madeAssets } } });
  await prisma?.client.subcategory.deleteMany({ where: { id: { in: madeTypes } } });
  await prisma?.client.category.deleteMany({ where: { id: { in: madeCategories } } });
  await app?.close();
});

const byType = async () => {
  const res = await api(app).get('/api/v1/assets/stats').set(auth(s.itAdmin));
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  return res.body.data.byType as { name: string; count: number }[];
};

describe('two types sharing a name', () => {
  it('come back with labels a reader can tell apart', async () => {
    const rows = await byType();
    const ours = rows.filter((r) => r.name.startsWith(sharedName));

    expect(ours).toHaveLength(2);
    expect(new Set(ours.map((r) => r.name)).size).toBe(2);
    // Qualified by the category each one belongs to.
    expect(ours.map((r) => r.name).sort()).toEqual([
      `${sharedName} (Alpha ${sharedName})`,
      `${sharedName} (Beta ${sharedName})`,
    ]);
  });

  it('are still two rows, not one merged row', async () => {
    const rows = await byType();
    const ours = rows.filter((r) => r.name.startsWith(sharedName));
    // Merging would turn two numbers into one, which is a worse version of
    // the bug being fixed.
    expect(ours.map((r) => r.count)).toEqual([1, 1]);
  });

  it('leaves a name that does not repeat alone', async () => {
    const rows = await byType();
    // Asserted against a type this test created with a name nothing else can
    // share. Checking "no OTHER row is qualified" would be wrong: a tenant may
    // genuinely have several duplicate names, and those SHOULD be qualified -
    // the first run of this test failed for exactly that reason.
    const solo = rows.find((r) => r.name.startsWith(uniqueName));
    expect(solo, `no row for ${uniqueName}`).toBeDefined();
    expect(solo!.name).toBe(uniqueName);
    expect(solo!.count).toBe(1);
  });
});
