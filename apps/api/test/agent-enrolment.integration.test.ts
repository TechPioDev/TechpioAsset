import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AppConfig } from '../src/config/config.module.js';
import {
  AgentEnrolmentService,
  PREVIOUS_DEVICE_TOKEN_MAX_AGE_MS,
  sha256,
} from '../src/discovery/agent-enrolment.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.13 — the laptop agent's credential model.
 *
 * The property that matters: an agent is installed on hundreds of machines
 * that leave the building, so its credential must be worth almost nothing if
 * stolen. These tests hold that line — a device credential can report exactly
 * one machine's inventory and can do nothing else at all.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let companyId: string;

const MACHINE_A = 'test-machine-aaaa-1111';
const MACHINE_B = 'test-machine-bbbb-2222';
const MACHINE_C = 'test-machine-cccc-3333';
const MACHINE_D = 'test-machine-dddd-4444';
const MACHINE_E = 'test-machine-eeee-5555';
const MACHINE_DUP = 'test-machine-dupe-6666';
const ALL_MACHINES = [MACHINE_A, MACHINE_B, MACHINE_C, MACHINE_D, MACHINE_E, MACHINE_DUP];
let enrolment: AgentEnrolmentService;
let foreignCompanyId: string;

beforeAll(async () => {
  // Boot with the licence-key secret so the token is stored revealable.
  process.env.LICENSE_KEY_SECRET = 'integration-test-key-secret';
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;
  enrolment = app.get(AgentEnrolmentService);
  // Start clean: an aborted run may have left a token behind, and create is
  // now create-only.
  await prisma.client.agentEnrolmentToken.deleteMany({ where: { companyId } });
  await prisma.client.deviceAgent.deleteMany({ where: { machineId: { in: ALL_MACHINES } } });
});

afterAll(async () => {
  await prisma?.client.deviceAgent.deleteMany({
    where: { machineId: { in: ALL_MACHINES } },
  });
  await prisma?.client.agentEnrolmentToken.deleteMany({ where: { companyId } });
  await app?.close();
});

describe('enrolment token', () => {
  let enrolmentToken: string;

  it('is minted by an admin and returned exactly once', async () => {
    const res = await api(app)
      .post('/api/v1/discovery/agents/enrolment-token')
      .set(auth(s.itAdmin))
      .send({});
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    enrolmentToken = res.body.data.token;
    expect(enrolmentToken).toMatch(/^tae_/);

    // Stored only as a hash.
    const row = await prisma.client.agentEnrolmentToken.findUnique({ where: { companyId } });
    expect(row?.tokenHash).not.toContain(enrolmentToken);
  });

  it('is refused to an employee', async () => {
    const res = await api(app)
      .post('/api/v1/discovery/agents/enrolment-token')
      .set(auth(s.employee))
      .send({});
    expect(res.status).toBe(403);
  });

  it('exchanges for a device credential, and a wrong token does not', async () => {
    const bad = await api(app)
      .post('/api/v1/discovery/agents/enrol')
      .set({ 'x-enrolment-token': 'tae_not-a-real-token' })
      .send({ machineId: MACHINE_A, hostname: 'LAPTOP-A', platform: 'windows' });
    expect(bad.status).toBe(401);

    const res = await api(app)
      .post('/api/v1/discovery/agents/enrol')
      .set({ 'x-enrolment-token': enrolmentToken })
      .send({
        machineId: MACHINE_A,
        hostname: 'LAPTOP-A',
        serialNumber: 'AGENT-SN-A',
        platform: 'windows',
        agentVersion: '1.0.0',
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    expect(res.body.data.deviceToken).toMatch(/^tad_/);
  });

  it('re-enrolling the same machine rotates rather than duplicates', async () => {
    const first = await prisma.client.deviceAgent.findFirst({
      where: { companyId, machineId: MACHINE_A },
      select: { id: true, tokenHash: true },
    });
    const again = await api(app)
      .post('/api/v1/discovery/agents/enrol')
      .set({ 'x-enrolment-token': enrolmentToken })
      .send({ machineId: MACHINE_A, hostname: 'LAPTOP-A-REBUILT', platform: 'windows' });
    expect(again.status).toBe(200);

    const rows = await prisma.client.deviceAgent.findMany({
      where: { companyId, machineId: MACHINE_A },
    });
    expect(rows).toHaveLength(1); // reinstalling a laptop is not a new device
    expect(rows[0].id).toBe(first!.id);
    expect(rows[0].tokenHash).not.toBe(first!.tokenHash); // credential rotated
  });
});

describe('device credential is worth almost nothing if stolen', () => {
  let deviceToken: string;
  let enrolmentToken: string;

  beforeAll(async () => {
    // The token is create-only now; the one from the first block is shown again.
    const shown = await api(app)
      .post('/api/v1/discovery/agents/enrolment-token/reveal')
      .set(auth(s.itAdmin))
      .send({});
    enrolmentToken = shown.body.data.token;
    const enrol = await api(app)
      .post('/api/v1/discovery/agents/enrol')
      .set({ 'x-enrolment-token': enrolmentToken })
      .send({ machineId: MACHINE_B, hostname: 'LAPTOP-B', platform: 'windows' });
    deviceToken = enrol.body.data.deviceToken;
  });

  it('can report its own inventory', async () => {
    const res = await api(app)
      .post('/api/v1/discovery/agents/report')
      .set({ Authorization: `Bearer ${deviceToken}` })
      .send({
        hostname: 'LAPTOP-B',
        serialNumber: 'AGENT-SN-B',
        hardware: { manufacturer: 'Dell', modelName: 'Latitude 7450', cpu: 'i7', ramGb: 16 },
        os: { osName: 'Windows 11', osVersion: '24H2', diskEncrypted: true },
        software: [{ name: 'Google Chrome', version: '140.0' }],
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.data.received).toBe(1);

    // The reported machine is pinned to the credential's machineId.
    const device = await prisma.client.discoveredDevice.findFirst({
      where: { companyId, externalId: MACHINE_B },
      select: { hostname: true },
    });
    expect(device?.hostname).toBe('LAPTOP-B');
  });

  it('cannot reach ANY human endpoint with that credential', async () => {
    const asAgent = { Authorization: `Bearer ${deviceToken}` };
    for (const path of [
      '/api/v1/assets',
      '/api/v1/users',
      '/api/v1/discovery/devices',
      '/api/v1/discovery/agents',
      '/api/v1/auth/me',
      '/api/v1/requests',
    ]) {
      const res = await api(app).get(path).set(asAgent);
      expect([401, 403], `${path} let an agent credential through`).toContain(res.status);
    }
    // ...and cannot mint itself a wider one.
    const mint = await api(app)
      .post('/api/v1/discovery/agents/enrolment-token')
      .set(asAgent)
      .send({});
    expect([401, 403]).toContain(mint.status);
  });

  it('stops working the moment the laptop is revoked', async () => {
    const agent = await prisma.client.deviceAgent.findFirst({
      where: { companyId, machineId: MACHINE_B },
      select: { id: true },
    });
    const revoke = await api(app)
      .delete(`/api/v1/discovery/agents/${agent!.id}`)
      .set(auth(s.itAdmin));
    expect(revoke.status).toBe(204);

    const res = await api(app)
      .post('/api/v1/discovery/agents/report')
      .set({ Authorization: `Bearer ${deviceToken}` })
      .send({ hostname: 'LAPTOP-B' });
    expect(res.status).toBe(401);

    // The row survives revocation - enrolment history stays readable.
    const still = await prisma.client.deviceAgent.findFirst({
      where: { companyId, machineId: MACHINE_B },
      select: { revokedAt: true },
    });
    expect(still?.revokedAt).not.toBeNull();
  });
});

// ── persistent enrolment token, safe rotation, honest status ────────────────

describe('persistent enrolment token', () => {
  const base = '/api/v1/discovery/agents/enrolment-token';
  let token: string;

  it('a second create is refused with 409 instead of silently replacing', async () => {
    const status = await api(app).get(base).set(auth(s.itAdmin));
    expect(status.status).toBe(200);
    expect(status.body.data).toMatchObject({ exists: true, revealable: true, graceToken: null });
    expect(JSON.stringify(status.body.data)).not.toMatch(/tae_/);

    const again = await api(app).post(base).set(auth(s.itAdmin)).send({});
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).toContain('A token already exists');
  });

  it('reveal returns the same token every time, with the install command, and is audited', async () => {
    const countAudits = () =>
      prisma.client.auditLog.count({ where: { companyId, entityType: 'AgentEnrolmentToken' } });
    const before = await countAudits();
    const one = await api(app).post(`${base}/reveal`).set(auth(s.itAdmin)).send({});
    const two = await api(app).post(`${base}/reveal`).set(auth(s.itAdmin)).send({});
    expect(one.status).toBe(200);
    token = one.body.data.token;
    expect(token).toMatch(/^tae_/);
    expect(two.body.data.token).toBe(token);
    expect(one.body.data.installCommand).toContain(`-EnrolmentToken ${token} -Install`);
    expect(one.body.data.installCommand).toContain('/downloads/TechpioAgent.ps1');
    expect(one.body.data.installCommand).toContain('/api/v1 ');

    expect((await countAudits()) - before).toBe(2);
    const audits = await prisma.client.auditLog.findMany({
      where: { companyId, entityType: 'AgentEnrolmentToken' },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
    expect(audits[0]!.newValues).toMatchObject({ event: 'revealed' });
    // The secret never reaches the audit log.
    expect(JSON.stringify(audits)).not.toContain(token);
  });

  it('every token endpoint is refused to roles without discovery:ingest', async () => {
    for (const who of ['employee', 'auditor', 'manager', 'finance'] as const) {
      const results = await Promise.all([
        api(app).get(base).set(auth(s[who])),
        api(app).post(base).set(auth(s[who])).send({}),
        api(app).post(`${base}/reveal`).set(auth(s[who])).send({}),
        api(app).post(`${base}/replace`).set(auth(s[who])).send({ graceDays: 0 }),
        api(app).delete(base).set(auth(s[who])),
      ]);
      for (const res of results) {
        expect(res.status, `${who} reached a token endpoint`).toBe(403);
      }
    }
  });

  it('replace keeps the old token ENROLLING through the grace period, then refuses it', async () => {
    const res = await api(app).post(`${base}/replace`).set(auth(s.itAdmin)).send({ graceDays: 7 });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    const newToken = res.body.data.token as string;
    expect(newToken).not.toBe(token);
    expect(res.body.data.installCommand).toContain(newToken);

    // Revealable later too.
    const shown = await api(app).post(`${base}/reveal`).set(auth(s.itAdmin)).send({});
    expect(shown.body.data.token).toBe(newToken);
    const status = await api(app).get(base).set(auth(s.itAdmin));
    expect(status.body.data.graceToken?.expiresAt).toBeTruthy();

    // The old (grace) token and the new token both enrol.
    const viaOld = await api(app)
      .post('/api/v1/discovery/agents/enrol')
      .set({ 'x-enrolment-token': token })
      .send({ machineId: MACHINE_C, hostname: 'LAPTOP-C', platform: 'windows', agentVersion: '1.0.0' });
    expect(viaOld.status).toBe(200);
    await expect(enrolment.enrolAgent(newToken, { machineId: MACHINE_C })).resolves.toHaveProperty(
      'deviceToken',
    );

    // Grace over: the old token is refused.
    await prisma.client.agentEnrolmentToken.update({
      where: { companyId },
      data: { graceExpiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await api(app)
      .post('/api/v1/discovery/agents/enrol')
      .set({ 'x-enrolment-token': token })
      .send({ machineId: MACHINE_C, platform: 'windows' });
    expect(expired.status).toBe(401);
    token = newToken;
  });

  it('graceDays 0 retires the old token immediately', async () => {
    const res = await api(app).post(`${base}/replace`).set(auth(s.itAdmin)).send({ graceDays: 0 });
    expect(res.status).toBe(200);
    await expect(enrolment.enrolAgent(token, { machineId: MACHINE_C })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(
      enrolment.enrolAgent(res.body.data.token, { machineId: MACHINE_C }),
    ).resolves.toHaveProperty('deviceToken');
    token = res.body.data.token;
  });

  it('rejects out-of-range grace days', async () => {
    const res = await api(app).post(`${base}/replace`).set(auth(s.itAdmin)).send({ graceDays: 31 });
    expect(res.status).toBe(422);
  });

  it('revoke kills the current and the grace token, and is audited', async () => {
    const replaced = await api(app)
      .post(`${base}/replace`)
      .set(auth(s.itAdmin))
      .send({ graceDays: 14 });
    const current = replaced.body.data.token as string;
    const grace = token;

    const del = await api(app).delete(base).set(auth(s.itAdmin));
    expect(del.status).toBe(204);
    for (const t of [current, grace]) {
      await expect(enrolment.enrolAgent(t, { machineId: MACHINE_C })).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    }
    const last = await prisma.client.auditLog.findFirst({
      where: { companyId, entityType: 'AgentEnrolmentToken' },
      orderBy: { createdAt: 'desc' },
    });
    expect(last?.newValues).toMatchObject({ event: 'revoked' });
    expect((await api(app).get(base).set(auth(s.itAdmin))).body.data.exists).toBe(false);
  });

  it('a legacy hash-only token exists but cannot be shown, and says to replace it once', async () => {
    await prisma.client.agentEnrolmentToken.create({
      data: { companyId, tokenHash: sha256('tae_legacy-token'), createdById: s.itAdmin.user.id },
    });
    const status = await api(app).get(base).set(auth(s.itAdmin));
    expect(status.body.data).toMatchObject({
      exists: true,
      revealable: false,
      unrevealableReason: 'LEGACY_HASH_ONLY',
    });
    expect(status.body.data.unrevealableMessage).toContain('Replace it once');
    expect((await api(app).post(`${base}/reveal`).set(auth(s.itAdmin)).send({})).status).toBe(409);
    // The legacy token still enrols until replaced - nothing in the field breaks.
    await expect(
      enrolment.enrolAgent('tae_legacy-token', { machineId: MACHINE_D }),
    ).resolves.toHaveProperty('deviceToken');

    const replaced = await api(app)
      .post(`${base}/replace`)
      .set(auth(s.itAdmin))
      .send({ graceDays: 1 });
    expect(replaced.status).toBe(200);
    expect((await api(app).get(base).set(auth(s.itAdmin))).body.data.revealable).toBe(true);
  });

  it('without an encryption key, Show is unavailable rather than failing', async () => {
    const config = app.get(AppConfig);
    const original = config.get.bind(config);
    const spy = vi
      .spyOn(config, 'get')
      .mockImplementation(((key: never) =>
        key === 'LICENSE_KEY_SECRET' ? undefined : original(key)) as never);
    try {
      const status = await api(app).get(base).set(auth(s.itAdmin));
      expect(status.body.data).toMatchObject({
        revealable: false,
        unrevealableReason: 'ENCRYPTION_NOT_CONFIGURED',
        unrevealableMessage: 'Show is unavailable — encryption key not configured',
      });
      expect((await api(app).post(`${base}/reveal`).set(auth(s.itAdmin)).send({})).status).toBe(503);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('device credential rotation cannot lock a laptop out', () => {
  const report = (bearer: string, body: Record<string, unknown> = { hostname: 'LAPTOP-E' }) =>
    api(app)
      .post('/api/v1/discovery/agents/report')
      .set({ Authorization: `Bearer ${bearer}` })
      .send(body);
  let token: string;

  beforeAll(async () => {
    const shown = await api(app)
      .post('/api/v1/discovery/agents/enrolment-token/reveal')
      .set(auth(s.itAdmin))
      .send({});
    token = shown.body.data.token;
  });

  it('keeps the previous credential valid until the new one is used, then refuses it', async () => {
    const first = (await enrolment.enrolAgent(token, { machineId: MACHINE_E })).deviceToken;
    expect((await report(first)).status).toBe(200);

    // Re-enrol, but the laptop "fails to save" the new credential.
    const second = (await enrolment.enrolAgent(token, { machineId: MACHINE_E })).deviceToken;
    expect((await report(first)).status).toBe(200);
    expect((await report(first)).status).toBe(200); // still, until the new one is used

    // Re-enrolling again before the new one is used keeps the OLDER credential.
    const third = (await enrolment.enrolAgent(token, { machineId: MACHINE_E })).deviceToken;
    expect((await report(first)).status).toBe(200);
    expect((await report(second)).status).toBe(401);

    // The new credential is used once: the old one is retired.
    expect((await report(third)).status).toBe(200);
    expect((await report(first)).status).toBe(401);
    const row = await prisma.client.deviceAgent.findFirst({ where: { machineId: MACHINE_E } });
    expect(row?.previousTokenHash).toBeNull();
  });

  it('the previous credential expires after its maximum age', async () => {
    const current = (await enrolment.enrolAgent(token, { machineId: MACHINE_E })).deviceToken;
    expect((await report(current)).status).toBe(200);
    await enrolment.enrolAgent(token, { machineId: MACHINE_E });
    expect((await report(current)).status).toBe(200);
    await prisma.client.deviceAgent.updateMany({
      where: { machineId: MACHINE_E },
      data: {
        previousTokenRotatedAt: new Date(Date.now() - PREVIOUS_DEVICE_TOKEN_MAX_AGE_MS - 60_000),
      },
    });
    expect((await report(current)).status).toBe(401);
  });

  it('a revoked laptop does not get its old credential back by re-enrolling', async () => {
    const current = (await enrolment.enrolAgent(token, { machineId: MACHINE_D })).deviceToken;
    const row = await prisma.client.deviceAgent.findFirst({
      where: { companyId, machineId: MACHINE_D },
    });
    await api(app).delete(`/api/v1/discovery/agents/${row!.id}`).set(auth(s.itAdmin));
    const fresh = (await enrolment.enrolAgent(token, { machineId: MACHINE_D })).deviceToken;
    expect((await report(current)).status).toBe(401);
    expect((await report(fresh)).status).toBe(200);
  });

  it('accepts a report body carrying machineId (agent v1.1.0) - identity still from the credential', async () => {
    const current = (await enrolment.enrolAgent(token, { machineId: MACHINE_E })).deviceToken;
    const res = await report(current, {
      machineId: MACHINE_A, // a DIFFERENT laptop's id: must be ignored
      hostname: 'LAPTOP-E',
      agentVersion: '1.1.0',
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    const e = await prisma.client.discoveredDevice.findFirst({
      where: { companyId, externalId: MACHINE_E },
    });
    expect(e?.hostname).toBe('LAPTOP-E');
    const a = await prisma.client.deviceAgent.findFirst({
      where: { companyId, machineId: MACHINE_A },
    });
    expect(a?.hostname).not.toBe('LAPTOP-E');
  });

  it('a bad credential is 401 even when the body would fail validation', async () => {
    const res = await report('tad_not-a-real-one', { notAField: true, machineId: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('refused reports are recorded against their laptop', () => {
  const FOREIGN_MACHINE = 'test-foreign-machine-7777';
  const refused = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    api(app)
      .post('/api/v1/discovery/agents/report')
      .set({ Authorization: 'Bearer tad_revoked-or-rotated-long-ago', ...headers })
      .send(body);
  const rowOf = (machineId: string, company = companyId) =>
    prisma.client.deviceAgent.findFirst({
      where: { companyId: company, machineId },
      select: { lastRejectedAt: true, rejectCount: true, hostname: true },
    });

  beforeAll(async () => {
    const foreign = await prisma.client.company.create({
      data: { name: `Agent Rejection Probe Tenant ${Date.now()}` },
      select: { id: true },
    });
    foreignCompanyId = foreign.id;
    const stale = new Date(Date.now() - 20 * 86_400_000);
    const nonce = Date.now();
    await prisma.client.deviceAgent.createMany({
      data: [
        {
          companyId: foreignCompanyId,
          machineId: FOREIGN_MACHINE,
          tokenHash: sha256(`foreign-${nonce}`),
          serialNumber: `FOREIGN-SN-${nonce}`,
          lastSeenAt: stale,
        },
        // The same machineId in two tenants: ambiguous, so never recorded.
        { companyId, machineId: MACHINE_DUP, tokenHash: sha256(`dup-a-${nonce}`), lastSeenAt: stale },
        {
          companyId: foreignCompanyId,
          machineId: MACHINE_DUP,
          tokenHash: sha256(`dup-b-${nonce}`),
          lastSeenAt: stale,
        },
      ],
    });
    await prisma.client.deviceAgent.updateMany({
      where: { companyId, machineId: MACHINE_C },
      data: { lastSeenAt: stale, lastRejectedAt: null, rejectCount: 0 },
    });
  });

  afterAll(async () => {
    await prisma?.client.deviceAgent.deleteMany({ where: { companyId: foreignCompanyId } });
    // The probe tenant too. Left behind, it has no system roles, and the
    // role-coverage guard counts it as a tenant missing every one of them.
    await prisma?.client.company.delete({ where: { id: foreignCompanyId } });
  });

  it('records a known machineId, rate-limited, with an identical 401', async () => {
    const known = await refused({ machineId: MACHINE_C, hostname: 'ATTACKER-WROTE-THIS' });
    const unknown = await refused({ machineId: 'test-machine-nobody-0000' });
    expect(known.status).toBe(401);
    expect(unknown.status).toBe(401);
    // Identical either way, bar the per-request identifiers.
    const shape = (b: Record<string, unknown>) => ({
      type: b.type,
      title: b.title,
      status: b.status,
      detail: b.detail,
      code: b.code,
    });
    expect(shape(known.body)).toEqual(shape(unknown.body));

    const row = await rowOf(MACHINE_C);
    expect(row?.rejectCount).toBe(1);
    expect(row?.lastRejectedAt).not.toBeNull();
    expect(row?.hostname).not.toBe('ATTACKER-WROTE-THIS'); // nothing else is written

    // A retry storm inside the window is one event.
    await refused({ machineId: MACHINE_C });
    await refused({}, { 'x-agent-machine-id': MACHINE_C });
    expect((await rowOf(MACHINE_C))?.rejectCount).toBe(1);

    // After the window, the header form counts too.
    await prisma.client.deviceAgent.updateMany({
      where: { companyId, machineId: MACHINE_C },
      data: { lastRejectedAt: new Date(Date.now() - 11 * 60_000) },
    });
    await refused({}, { 'x-agent-machine-id': MACHINE_C });
    expect((await rowOf(MACHINE_C))?.rejectCount).toBe(2);

    const list = await api(app).get('/api/v1/discovery/agents').set(auth(s.itAdmin));
    const c = (list.body.data as Array<Record<string, unknown>>).find(
      (r) => r.machineId === MACHINE_C,
    );
    expect(c).toMatchObject({ status: 'CREDENTIAL_REJECTED', rejectCount: 2 });
    expect(c?.lastRejectedAt).toBeTruthy();
    expect(JSON.stringify(list.body)).not.toMatch(/tokenHash/i);
  });

  it('an unknown or ambiguous identifier changes nothing, and other tenants are untouched', async () => {
    await refused({ machineId: MACHINE_DUP });
    await refused({ machineId: 'test-foreign-machine-0000' });
    expect((await rowOf(MACHINE_DUP))?.rejectCount).toBe(0);
    expect((await rowOf(MACHINE_DUP, foreignCompanyId))?.rejectCount).toBe(0);
    expect((await rowOf(FOREIGN_MACHINE, foreignCompanyId))?.rejectCount).toBe(0);
    expect((await rowOf(MACHINE_C))?.rejectCount).toBe(2);
  });

  it('falls back to a serial number naming exactly one laptop (agent v1.0.0 sends no machineId)', async () => {
    const serial = (
      await prisma.client.deviceAgent.findFirst({
        where: { companyId: foreignCompanyId, machineId: FOREIGN_MACHINE },
        select: { serialNumber: true },
      })
    )?.serialNumber;
    const res = await refused({ hostname: 'X', serialNumber: serial });
    expect(res.status).toBe(401);
    expect((await rowOf(FOREIGN_MACHINE, foreignCompanyId))?.rejectCount).toBe(1);
    expect((await rowOf(MACHINE_C))?.rejectCount).toBe(2);
  });

  it('a successful enrol and report afterwards flips the status back', async () => {
    const shown = await api(app)
      .post('/api/v1/discovery/agents/enrolment-token/reveal')
      .set(auth(s.itAdmin))
      .send({});
    const device = (
      await enrolment.enrolAgent(shown.body.data.token, { machineId: MACHINE_C, agentVersion: '1.1.0' })
    ).deviceToken;
    const ok = await api(app)
      .post('/api/v1/discovery/agents/report')
      .set({ Authorization: `Bearer ${device}` })
      .send({ hostname: 'LAPTOP-C', agentVersion: '1.1.0' });
    expect(ok.status).toBe(200);
    const list = await api(app).get('/api/v1/discovery/agents').set(auth(s.itAdmin));
    const c = (list.body.data as Array<Record<string, unknown>>).find(
      (r) => r.machineId === MACHINE_C,
    );
    expect(c).toMatchObject({ status: 'ACTIVE', updateAvailable: false });
  });
});
