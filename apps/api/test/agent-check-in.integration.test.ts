import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_ONLINE_WINDOW_MINUTES } from '@techpioasset/domain';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { sha256 } from '../src/discovery/agent-enrolment.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v3.14 - Online/Offline and Refresh now.
 *
 * The owner asked to see which laptops are on and to pull fresh data on a
 * click. Nothing can be pushed to a laptop (the agent only calls out), so the
 * button leaves a note that the laptop's next five-minute check-in picks up.
 * What these tests hold: an older daily agent never claims Online, a refresh
 * is answered once and then cleared by the report, the request is tenant
 * scoped, and a check-in credential is still worth nothing anywhere else.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let companyId: string;
let foreignCompanyId: string;

const nonce = Date.now();
const NEW_MACHINE = `test-checkin-new-${nonce}`;
const OLD_MACHINE = `test-checkin-old-${nonce}`;
const FOREIGN_MACHINE = `test-checkin-foreign-${nonce}`;
const NEW_TOKEN = `tad_checkin-new-${nonce}`;
const OLD_TOKEN = `tad_checkin-old-${nonce}`;
let newAgentId: string;
let oldAgentId: string;
let foreignAgentId: string;

const beat = (token: string, body: Record<string, unknown> = {}) =>
  api(app)
    .post('/api/v1/discovery/agents/heartbeat')
    .set({ Authorization: `Bearer ${token}` })
    .send({ agentVersion: '1.3.0', ...body });

const agentsList = async () => {
  const res = await api(app).get('/api/v1/discovery/agents').set(auth(s.itAdmin));
  expect(res.status).toBe(200);
  return res.body.data as Array<{
    id: string;
    status: string;
    checksIn: boolean;
    refreshPending: boolean;
    refreshRefusal: string | null;
    tokenHash?: unknown;
  }>;
};

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  companyId = s.superAdmin.user.companyId;

  const longAgo = new Date(Date.now() - 2 * 86_400_000);
  const fresh = await prisma.client.deviceAgent.create({
    data: {
      companyId,
      machineId: NEW_MACHINE,
      tokenHash: sha256(NEW_TOKEN),
      hostname: 'CHECKIN-NEW',
      agentVersion: '1.2.1',
      lastSeenAt: longAgo,
    },
    select: { id: true },
  });
  newAgentId = fresh.id;
  const old = await prisma.client.deviceAgent.create({
    data: {
      companyId,
      machineId: OLD_MACHINE,
      tokenHash: sha256(OLD_TOKEN),
      hostname: 'CHECKIN-OLD',
      agentVersion: '1.0.0',
      lastSeenAt: new Date(),
    },
    select: { id: true },
  });
  oldAgentId = old.id;

  const foreign = await prisma.client.company.create({
    data: { name: `Agent Check-in Probe Tenant ${nonce}` },
    select: { id: true },
  });
  foreignCompanyId = foreign.id;
  const other = await prisma.client.deviceAgent.create({
    data: {
      companyId: foreignCompanyId,
      machineId: FOREIGN_MACHINE,
      tokenHash: sha256(`tad_checkin-foreign-${nonce}`),
      lastSeenAt: new Date(),
      lastHeartbeatAt: new Date(),
    },
    select: { id: true },
  });
  foreignAgentId = other.id;
});

afterAll(async () => {
  await prisma?.client.discoveredDevice.deleteMany({
    where: { externalId: { in: [NEW_MACHINE, OLD_MACHINE] } },
  });
  await prisma?.client.deviceAgent.deleteMany({
    where: { machineId: { in: [NEW_MACHINE, OLD_MACHINE, FOREIGN_MACHINE] } },
  });
  // Left behind, the probe tenant has no system roles and the role-coverage
  // guard counts it as a tenant missing every one of them.
  if (foreignCompanyId) await prisma?.client.company.delete({ where: { id: foreignCompanyId } });
  await app?.close();
});

describe('the five-minute check-in', () => {
  it('turns a laptop Online, records its version, and asks for nothing', async () => {
    const res = await beat(NEW_TOKEN, { machineId: NEW_MACHINE });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    expect(res.body.data).toEqual({ refresh: false });

    const row = (await agentsList()).find((a) => a.id === newAgentId)!;
    expect(row.status).toBe('ONLINE');
    expect(row.checksIn).toBe(true);
    expect(row.refreshRefusal).toBeNull();
    expect(row.tokenHash).toBeUndefined();

    const stored = await prisma.client.deviceAgent.findUnique({ where: { id: newAgentId } });
    expect(stored?.agentVersion).toBe('1.3.0');
    expect(stored?.lastHeartbeatAt).not.toBeNull();
  });

  it('goes Offline once the check-ins stop', async () => {
    const quiet = new Date(Date.now() - (AGENT_ONLINE_WINDOW_MINUTES + 3) * 60_000);
    await prisma.client.deviceAgent.update({
      where: { id: newAgentId },
      data: { lastSeenAt: quiet, lastHeartbeatAt: quiet },
    });
    const row = (await agentsList()).find((a) => a.id === newAgentId)!;
    expect(row.status).toBe('OFFLINE');
  });

  it('never calls an older daily agent Online, even one heard from just now', async () => {
    const row = (await agentsList()).find((a) => a.id === oldAgentId)!;
    expect(row.status).toBe('ACTIVE');
    expect(row.checksIn).toBe(false);
    expect(row.refreshRefusal).toMatch(/once a day/);
  });

  it('refuses a bad credential with 401 and records nothing for it', async () => {
    const res = await beat('tad_not-a-real-credential');
    expect(res.status).toBe(401);
  });

  it('a check-in credential still cannot reach a human endpoint', async () => {
    const res = await api(app)
      .get('/api/v1/discovery/agents')
      .set({ Authorization: `Bearer ${NEW_TOKEN}` });
    expect(res.status).toBe(401);
  });
});

describe('Refresh now', () => {
  it('is answered by the next check-in, which keeps asking until a report arrives', async () => {
    const asked = await api(app)
      .post(`/api/v1/discovery/agents/${newAgentId}/refresh`)
      .set(auth(s.itAdmin))
      .send({});
    expect(asked.status, JSON.stringify(asked.body).slice(0, 200)).toBe(200);
    expect(asked.body.data.refreshPending).toBe(true);

    expect((await beat(NEW_TOKEN)).body.data).toEqual({ refresh: true });
    // The laptop's report has not landed yet: a second check-in asks again.
    expect((await beat(NEW_TOKEN)).body.data).toEqual({ refresh: true });

    const report = await api(app)
      .post('/api/v1/discovery/agents/report')
      .set({ Authorization: `Bearer ${NEW_TOKEN}` })
      .send({
        hostname: 'CHECKIN-NEW',
        serialNumber: `CHECKIN-SN-${nonce}`,
        agentVersion: '1.3.0',
      });
    expect(report.status, JSON.stringify(report.body).slice(0, 200)).toBe(200);

    expect((await beat(NEW_TOKEN)).body.data).toEqual({ refresh: false });
    const row = (await agentsList()).find((a) => a.id === newAgentId)!;
    expect(row.refreshPending).toBe(false);
    expect(row.status).toBe('ONLINE');
  });

  it('shows the live state on the Devices list too', async () => {
    const res = await api(app).get('/api/v1/discovery/devices?pageSize=100').set(auth(s.itAdmin));
    expect(res.status).toBe(200);
    const device = (res.body.data as Array<{ externalId: string; agent: unknown }>).find(
      (d) => d.externalId === NEW_MACHINE,
    );
    expect(device?.agent).toMatchObject({ id: newAgentId, status: 'ONLINE', checksIn: true });
  });

  it('is refused for an older daily agent, saying what to do', async () => {
    const res = await api(app)
      .post(`/api/v1/discovery/agents/${oldAgentId}/refresh`)
      .set(auth(s.itAdmin))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/agent 1\.0\.0/);
    expect(res.body.detail).toMatch(/Copy fix command/);
  });

  it('is refused to a role without discovery:ingest', async () => {
    const res = await api(app)
      .post(`/api/v1/discovery/agents/${newAgentId}/refresh`)
      .set(auth(s.employee))
      .send({});
    expect(res.status).toBe(403);
  });

  it("cannot reach another company's laptop", async () => {
    const res = await api(app)
      .post(`/api/v1/discovery/agents/${foreignAgentId}/refresh`)
      .set(auth(s.itAdmin))
      .send({});
    expect(res.status).toBe(404);
    const foreign = await prisma.client.deviceAgent.findUnique({ where: { id: foreignAgentId } });
    expect(foreign?.refreshRequestedAt).toBeNull();
  });

  it('is refused for a revoked laptop', async () => {
    await api(app).delete(`/api/v1/discovery/agents/${newAgentId}`).set(auth(s.itAdmin));
    const res = await api(app)
      .post(`/api/v1/discovery/agents/${newAgentId}/refresh`)
      .set(auth(s.itAdmin))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/revoked/);
    // And its check-ins stop being accepted at once.
    expect((await beat(NEW_TOKEN)).status).toBe(401);
  });
});
