import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, login, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.5 H2 — discovery ingest and reconciliation. The invariant under test:
 * discovery PROPOSES, it never silently mutates. Only an exact unambiguous
 * serial match or a human confirmation links a device to an asset, and
 * hardware/OS/software payloads are applied only across such a link.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let categoryId: string;

const run = Date.now() % 1_000_000;
const SERIAL_EXACT = `DISC-SN-${run}-EXACT`;
const SERIAL_DUP_UPPER = `DISC-SN-${run}-DUP`;
const SERIAL_DUP_LOWER = `disc-sn-${run}-dup`;
const HOSTNAME_MATCH = `DISC-HOST-${run}`;

let assetExact: string;
let assetDupA: string;
let assetDupB: string;
let assetByName: string;
const createdAssets: string[] = [];

const base = '/api/v1/discovery';

async function createAsset(body: Record<string, unknown>) {
  const res = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.superAdmin))
    .send({ categoryId, status: 'AVAILABLE', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  createdAssets.push(res.body.data.id);
  return res.body.data.id as string;
}

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  categoryId = categories.body.data.find((c: { key: string }) => c.key === 'it-assets').id;

  assetExact = await createAsset({
    assetTag: `DISC-${run}-1`,
    name: 'Discovery exact-serial laptop',
    serialNumber: SERIAL_EXACT,
  });
  // The asset unique is case-sensitive while matching is case-insensitive, so
  // two case-variant serials are the realistic double-match that must CONFLICT.
  assetDupA = await createAsset({
    assetTag: `DISC-${run}-2`,
    name: 'Discovery duplicate serial A',
    serialNumber: SERIAL_DUP_UPPER,
  });
  assetDupB = await createAsset({
    assetTag: `DISC-${run}-3`,
    name: 'Discovery duplicate serial B',
    serialNumber: SERIAL_DUP_LOWER,
  });
  assetByName = await createAsset({
    assetTag: `DISC-${run}-4`,
    name: HOSTNAME_MATCH,
  });
});

afterAll(async () => {
  const companyId = s.superAdmin.user.companyId;
  await prisma.client.discoveredDevice.deleteMany({ where: { companyId } });
  await prisma.client.installedSoftware.deleteMany({ where: { assetId: { in: createdAssets } } });
  await prisma.client.hardwareProfile.deleteMany({ where: { assetId: { in: createdAssets } } });
  await prisma.client.operatingSystemInfo.deleteMany({ where: { assetId: { in: createdAssets } } });
  for (const id of createdAssets) {
    await prisma.client.asset.delete({ where: { id } }).catch(() => undefined);
  }
  await app?.close();
});

describe('permissions', () => {
  it('an employee can neither ingest nor read the queue', async () => {
    const ingest = await api(app)
      .post(`${base}/ingest`)
      .set(auth(s.employee))
      .send({ devices: [{ hostname: 'nope' }] });
    expect(ingest.status).toBe(403);
    const list = await api(app).get(`${base}/devices`).set(auth(s.employee));
    expect(list.status).toBe(403);
  });

  it('a device with no identity at all is rejected', async () => {
    const res = await api(app)
      .post(`${base}/ingest`)
      .set(auth(s.itAdmin))
      .send({ devices: [{ hardware: { manufacturer: 'Dell' } }] });
    expect(res.status).toBe(422);
  });
});

describe('reconciliation', () => {
  it('an exact unambiguous serial auto-matches and applies the payload', async () => {
    const res = await api(app)
      .post(`${base}/ingest`)
      .set(auth(s.itAdmin))
      .send({
        devices: [
          {
            externalId: `agent-${run}-exact`,
            serialNumber: SERIAL_EXACT.toLowerCase(), // matching is case-insensitive
            hostname: 'EXACT-LAPTOP',
            hardware: { manufacturer: 'Dell', ramGb: 16, smartStatus: 'HEALTHY' },
            os: { osName: 'Windows 11 Pro', diskEncrypted: true, missingCriticalPatches: 2 },
            software: [
              { name: 'Google Chrome', version: '126.0' },
              { name: '7-Zip', version: '24.06' },
            ],
          },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ received: 1, matched: 1, applied: 1 });

    const hw = await prisma.client.hardwareProfile.findUnique({ where: { assetId: assetExact } });
    expect(hw?.manufacturer).toBe('Dell');
    expect(Number(hw?.ramGb)).toBe(16);
    const os = await prisma.client.operatingSystemInfo.findUnique({
      where: { assetId: assetExact },
    });
    expect(os?.diskEncrypted).toBe(true);
    expect(os?.missingCriticalPatches).toBe(2);
    const sw = await prisma.client.installedSoftware.findMany({ where: { assetId: assetExact } });
    expect(sw.map((x) => x.name).sort()).toEqual(['7-Zip', 'Google Chrome']);
  });

  it('keeps who is signed in only from a report that says (v2.76)', async () => {
    const send = (os: Record<string, unknown>) =>
      api(app)
        .post(`${base}/ingest`)
        .set(auth(s.itAdmin))
        .send({ devices: [{ externalId: `agent-${run}-exact`, serialNumber: SERIAL_EXACT, os }] });
    const read = () =>
      prisma.client.operatingSystemInfo.findUniqueOrThrow({
        where: { assetId: assetExact },
        select: { activeUser: true, activeUserAt: true },
      });

    // Agent 1.2.0: a name.
    expect((await send({ osName: 'Windows 11 Pro', activeUser: 'TECHPIO\ravi' })).status).toBe(201);
    const named = await read();
    expect(named.activeUser).toBe('TECHPIO\ravi');
    expect(named.activeUserAt).not.toBeNull();

    // An older agent, which does not send the field: nothing about the user changes.
    expect((await send({ osName: 'Windows 11 Pro' })).status).toBe(201);
    expect(await read()).toEqual(named);

    // Agent 1.2.0 with nobody at the console: null, and the time it said so.
    expect((await send({ osName: 'Windows 11 Pro', activeUser: null })).status).toBe(201);
    const nobody = await read();
    expect(nobody.activeUser).toBeNull();
    expect(nobody.activeUserAt!.getTime()).toBeGreaterThanOrEqual(named.activeUserAt!.getTime());
  });

  it('re-ingest updates the same queue row and replaces the software snapshot', async () => {
    const res = await api(app)
      .post(`${base}/ingest`)
      .set(auth(s.itAdmin))
      .send({
        devices: [
          {
            externalId: `agent-${run}-exact`,
            serialNumber: SERIAL_EXACT,
            software: [{ name: 'Mozilla Firefox', version: '128.0' }],
          },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ matched: 1, applied: 1 });

    const rows = await prisma.client.discoveredDevice.findMany({
      where: { companyId: s.superAdmin.user.companyId, externalId: `agent-${run}-exact` },
    });
    expect(rows).toHaveLength(1); // updated, not duplicated
    expect(rows[0]!.matchState).toBe('MATCHED');
    // The snapshot is a replacement, not an accumulation.
    const sw = await prisma.client.installedSoftware.findMany({ where: { assetId: assetExact } });
    expect(sw.map((x) => x.name)).toEqual(['Mozilla Firefox']);
  });

  it('a serial matching two assets parks as CONFLICT and applies nothing', async () => {
    const res = await api(app)
      .post(`${base}/ingest`)
      .set(auth(s.itAdmin))
      .send({
        devices: [
          {
            externalId: `agent-${run}-dup`,
            serialNumber: SERIAL_DUP_UPPER,
            hardware: { manufacturer: 'HP' },
          },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ conflict: 1, applied: 0 });

    // Neither candidate got the payload — ambiguity never mutates.
    for (const id of [assetDupA, assetDupB]) {
      const hw = await prisma.client.hardwareProfile.findUnique({ where: { assetId: id } });
      expect(hw).toBeNull();
    }
  });

  it('a hostname matching the asset TAG is proposed too (v2.15)', async () => {
    // The whole fleet register uses machine names as asset tags; a matcher
    // blind to tags sent every real laptop to the manual queue.
    const tag = `XTAG-${run}`;
    const created = await api(app)
      .post('/api/v1/assets')
      .set(auth(s.itAdmin))
      .send({
        assetTag: tag,
        name: 'Some human-friendly name',
        categoryId: categoryId,
        serialNumber: `XTAGSN-${run}`,
        status: 'AVAILABLE',
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const res = await api(app)
      .post(`${base}/ingest`)
      .set(auth(s.itAdmin))
      .send({
        devices: [
          {
            externalId: `agent-${run}-tag`,
            hostname: tag.toLowerCase(),
            // A serial the register does not know - like a placeholder row.
            serialNumber: `REAL-BIOS-${run}`,
          },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ proposed: 1 });

    const queue = await api(app).get(`${base}/devices?state=PROPOSED`).set(auth(s.itAdmin));
    const item = queue.body.data.find(
      (d: { externalId: string }) => d.externalId === `agent-${run}-tag`,
    );
    expect(item).toBeDefined();
    expect(item.asset.id).toBe(created.body.data.id);
  });

  it('a hostname coincidence is only PROPOSED; confirming applies the payload', async () => {
    const res = await api(app)
      .post(`${base}/ingest`)
      .set(auth(s.itAdmin))
      .send({
        devices: [
          {
            externalId: `agent-${run}-host`,
            hostname: HOSTNAME_MATCH.toLowerCase(),
            hardware: { manufacturer: 'Lenovo', cpuCores: 8 },
            os: { osName: 'Windows 11 Pro' },
          },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ proposed: 1, applied: 0 });

    // Proposal alone must not touch the asset.
    expect(
      await prisma.client.hardwareProfile.findUnique({ where: { assetId: assetByName } }),
    ).toBeNull();

    // Borrow the IT_TECHNICIAN role to prove its discovery:read + reconcile
    // grants are what let a technician work the queue.
    await api(app)
      .patch(`/api/v1/users/${s.employee2.user.id}/roles`)
      .set(auth(s.superAdmin))
      .send({ roleKeys: ['EMPLOYEE', 'IT_TECHNICIAN'] });
    const tech = await login(app, 'employee2@techpioasset.dev');

    const queue = await api(app).get(`${base}/devices?state=PROPOSED`).set(auth(tech));
    expect(queue.status).toBe(200);
    const item = queue.body.data.find(
      (d: { externalId: string }) => d.externalId === `agent-${run}-host`,
    );
    expect(item).toBeDefined();
    expect(item.asset.id).toBe(assetByName);

    // A technician holds discovery:reconcile and may confirm.
    const confirm = await api(app)
      .post(`${base}/devices/${item.id}/confirm`)
      .set(auth(tech))
      .send({});
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(201);
    expect(confirm.body.data.matchState).toBe('MATCHED');

    const hw = await prisma.client.hardwareProfile.findUnique({ where: { assetId: assetByName } });
    expect(hw?.manufacturer).toBe('Lenovo');
    expect(hw?.cpuCores).toBe(8);

    // Hand the borrowed role back.
    await api(app)
      .patch(`/api/v1/users/${s.employee2.user.id}/roles`)
      .set(auth(s.superAdmin))
      .send({ roleKeys: ['EMPLOYEE'] });
  });

  it('an unknown device stays UNMATCHED; ignoring it is sticky across re-ingest', async () => {
    const payload = {
      devices: [{ externalId: `agent-${run}-ghost`, hostname: `GHOST-${run}` }],
    };
    const res = await api(app).post(`${base}/ingest`).set(auth(s.itAdmin)).send(payload);
    expect(res.body.data).toMatchObject({ unmatched: 1 });

    const row = await prisma.client.discoveredDevice.findFirst({
      where: { externalId: `agent-${run}-ghost` },
    });
    expect(row!.matchState).toBe('UNMATCHED');

    // Confirming without a target is an honest refusal, not a guess.
    const blind = await api(app)
      .post(`${base}/devices/${row!.id}/confirm`)
      .set(auth(s.itAdmin))
      .send({});
    expect(blind.status).toBe(422);

    const ignore = await api(app)
      .post(`${base}/devices/${row!.id}/ignore`)
      .set(auth(s.itAdmin))
      .send({});
    expect(ignore.status).toBe(201);
    expect(ignore.body.data.matchState).toBe('IGNORED');

    // Seen again: the sighting is recorded but the verdict stands.
    await api(app).post(`${base}/ingest`).set(auth(s.itAdmin)).send(payload);
    const after = await prisma.client.discoveredDevice.findFirst({
      where: { externalId: `agent-${run}-ghost` },
    });
    expect(after!.matchState).toBe('IGNORED');
    expect(after!.lastSeenAt.getTime()).toBeGreaterThan(row!.lastSeenAt.getTime());
  });

  it('confirming with an explicit assetId links an UNMATCHED device', async () => {
    await api(app)
      .post(`${base}/ingest`)
      .set(auth(s.itAdmin))
      .send({
        devices: [
          {
            externalId: `agent-${run}-manual`,
            hostname: `MANUAL-${run}`,
            os: { osName: 'Ubuntu 24.04', osSupported: true },
          },
        ],
      });
    const row = await prisma.client.discoveredDevice.findFirst({
      where: { externalId: `agent-${run}-manual` },
    });
    const confirm = await api(app)
      .post(`${base}/devices/${row!.id}/confirm`)
      .set(auth(s.itAdmin))
      .send({ assetId: assetDupB });
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(201);
    const os = await prisma.client.operatingSystemInfo.findUnique({
      where: { assetId: assetDupB },
    });
    expect(os?.osName).toBe('Ubuntu 24.04');
  });
});

describe('provider run', () => {
  it('the mock provider pulls a simulated fleet through the same ingest path', async () => {
    const res = await api(app).post(`${base}/run`).set(auth(s.itAdmin));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.provider).toBe('mock');
    expect(res.body.data.simulated).toBe(true);
    expect(res.body.data.received).toBe(3);

    const mockRows = await prisma.client.discoveredDevice.findMany({
      where: { companyId: s.superAdmin.user.companyId, source: 'MOCK' },
    });
    expect(mockRows.length).toBe(3);
  });
});
