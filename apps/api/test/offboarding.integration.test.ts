import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Phase 2 exit criterion: offboarding is blocked while an asset is unresolved.
 *
 * Spec section 13: "Offboarding cannot be marked fully completed until every
 * required asset has an outcome or approved exception."
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

// Completing an offboarding now deactivates the subject (employee3). Restore it
// so this shared account stays ACTIVE for the rest of the suite.
afterEach(async () => {
  await api(app)
    .patch(`/api/v1/users/${s.employee3.user.id}/status`)
    .set(auth(s.superAdmin))
    .send({ status: 'ACTIVE' });
});

/** Creates and assigns a fresh asset, so the test never fights shared seed stock. */
async function assignFreshAsset(toUserId: string, tagSuffix: string) {
  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  const itCategory = categories.body.data.find((c: { key: string }) => c.key === 'it-assets');

  const created = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.itAdmin))
    .send({
      assetTag: `OFF-${tagSuffix}`,
      name: `Offboarding test laptop ${tagSuffix}`,
      categoryId: itCategory.id,
      serialNumber: `OFFSN-${tagSuffix}`,
      status: 'AVAILABLE',
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);

  const assigned = await api(app)
    .post(`/api/v1/assets/${created.body.data.id}/assign`)
    .set(auth(s.itAdmin))
    .send({ userId: toUserId, conditionOut: 'GOOD' });
  expect(assigned.status).toBe(201);

  return created.body.data;
}

describe('offboarding completion gate (spec section 13)', () => {
  it('refuses to complete while an asset is still in the employee’s custody', async () => {
    const suffix = `A${Date.now().toString().slice(-8)}`;
    const asset = await assignFreshAsset(s.employee3.user.id, suffix);

    const started = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee3.user.id });
    expect(started.status).toBe(201);

    const task = started.body.data;
    expect(task.direction).toBe('OFFBOARDING');
    // The snapshot names exactly what is outstanding.
    expect(
      task.outstandingAssets.some((a: { assetTag: string }) => a.assetTag === asset.assetTag),
    ).toBe(true);
    expect(task.canComplete).toBe(false);

    const blocked = await api(app)
      .post(`/api/v1/lifecycle/offboarding/${task.id}/complete`)
      .set(auth(s.hr))
      .send({});

    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('CONFLICT');
    // The message must say which assets, or the user cannot act on it.
    expect(blocked.body.detail).toContain(asset.assetTag);
  });

  it('completes once the asset is returned', async () => {
    const suffix = `B${Date.now().toString().slice(-8)}`;
    const asset = await assignFreshAsset(s.employee3.user.id, suffix);

    const started = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee3.user.id });
    const taskId = started.body.data.id;

    const returned = await api(app)
      .post(`/api/v1/assets/${asset.id}/return`)
      .set(auth(s.itAdmin))
      .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
    expect(returned.status).toBe(201);

    // Any other asset assigned to this employee by an earlier test would still
    // block, so resolve everything outstanding first.
    const refreshed = await api(app).get(`/api/v1/lifecycle/tasks/${taskId}`).set(auth(s.hr));
    for (const outstanding of refreshed.body.data.outstandingAssets) {
      await api(app)
        .post(`/api/v1/assets/${outstanding.assetId}/return`)
        .set(auth(s.itAdmin))
        .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
    }

    const completed = await api(app)
      .post(`/api/v1/lifecycle/offboarding/${taskId}/complete`)
      .set(auth(s.hr))
      .send({});

    expect(completed.status, JSON.stringify(completed.body)).toBe(201);
    expect(completed.body.data.status).toBe('COMPLETED');
    expect(completed.body.data.completedAt).toBeTruthy();

    // The leaver's account is disabled so they can no longer sign in.
    const subject = await api(app)
      .get(`/api/v1/users/${s.employee3.user.id}`)
      .set(auth(s.superAdmin));
    expect(subject.body.data.status).toBe('DEACTIVATED');
  });

  it('allows completion with a documented exception, and records who approved it', async () => {
    const suffix = `C${Date.now().toString().slice(-8)}`;
    const asset = await assignFreshAsset(s.employee3.user.id, suffix);

    const started = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee3.user.id });
    const taskId = started.body.data.id;

    const completed = await api(app)
      .post(`/api/v1/lifecycle/offboarding/${taskId}/complete`)
      .set(auth(s.hr))
      .send({ exceptionReason: 'Laptop reported stolen; police report PR-2026-4471 filed.' });

    expect(completed.status).toBe(201);
    expect(completed.body.data.status).toBe('COMPLETED');
    expect(completed.body.data.exceptionReason).toContain('PR-2026-4471');

    // Clean up so later runs start from a known state.
    await api(app)
      .post(`/api/v1/assets/${asset.id}/return`)
      .set(auth(s.itAdmin))
      .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
  });

  it('rejects a token exception reason', async () => {
    const suffix = `D${Date.now().toString().slice(-8)}`;
    const asset = await assignFreshAsset(s.employee3.user.id, suffix);

    const started = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee3.user.id });

    const response = await api(app)
      .post(`/api/v1/lifecycle/offboarding/${started.body.data.id}/complete`)
      .set(auth(s.hr))
      .send({ exceptionReason: 'n/a' });

    // "Documented exception" has to mean something someone can be held to.
    expect(response.status).toBe(422);

    await api(app)
      .post(`/api/v1/assets/${asset.id}/return`)
      .set(auth(s.itAdmin))
      .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
  });

  it('notifies the employee that equipment must be returned', async () => {
    const suffix = `E${Date.now().toString().slice(-8)}`;
    const asset = await assignFreshAsset(s.employee3.user.id, suffix);

    await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee3.user.id });

    const employee3 = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: 'employee3@techpioasset.dev', password: 'TechpioDemo!2026' });
    const token = employee3.body.data.accessToken;

    const notifications = await api(app)
      .get('/api/v1/notifications?pageSize=20')
      .set({ Authorization: `Bearer ${token}` });

    expect(
      notifications.body.data.some((n: { type: string }) => n.type === 'RETURN_REQUIRED'),
    ).toBe(true);

    await api(app)
      .post(`/api/v1/assets/${asset.id}/return`)
      .set(auth(s.itAdmin))
      .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
  });
});

/**
 * The Offboard flow on the person page (web + mobile) drives these endpoints:
 * start once (idempotent), work through returns, finish. Each rule the screen
 * leans on is proved here rather than assumed.
 */
describe('offboarding as the person page drives it', () => {
  it('starting a second time reuses the open task instead of creating another', async () => {
    const suffix = `F${Date.now().toString().slice(-8)}`;
    const asset = await assignFreshAsset(s.employee3.user.id, suffix);

    const first = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee3.user.id });
    const second = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee3.user.id });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.status).toBe('OPEN');

    // Exactly one OPEN offboarding for this person, which is what the
    // "Offboarding in progress" badge keys on.
    const open = await api(app)
      .get('/api/v1/lifecycle/tasks?direction=OFFBOARDING&status=OPEN')
      .set(auth(s.hr));
    expect(open.status).toBe(200);
    const mine = open.body.data.filter(
      (t: { subjectUserId: string }) => t.subjectUserId === s.employee3.user.id,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(first.body.data.id);

    await api(app)
      .post(`/api/v1/assets/${asset.id}/return`)
      .set(auth(s.itAdmin))
      .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
  });

  it('refuses completion with the outstanding count in the message', async () => {
    const suffix = `G${Date.now().toString().slice(-8)}`;
    const a = await assignFreshAsset(s.employee3.user.id, suffix);
    const b = await assignFreshAsset(s.employee3.user.id, `${suffix}b`);

    const started = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee3.user.id });
    const task = started.body.data;
    const count = task.outstandingAssets.length;
    expect(count).toBeGreaterThanOrEqual(2);

    const blocked = await api(app)
      .post(`/api/v1/lifecycle/offboarding/${task.id}/complete`)
      .set(auth(s.hr))
      .send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.detail).toContain(`${count} asset(s) are still assigned`);
    expect(blocked.body.detail).toContain(a.assetTag);
    expect(blocked.body.detail).toContain(b.assetTag);

    // Nothing changed: the task is still open and the person can still sign in.
    const subject = await api(app).get(`/api/v1/users/${s.employee3.user.id}`).set(auth(s.superAdmin));
    expect(subject.body.data.status).toBe('ACTIVE');

    for (const asset of [a, b]) {
      await api(app)
        .post(`/api/v1/assets/${asset.id}/return`)
        .set(auth(s.itAdmin))
        .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
    }
  });

  it('completes after the returns, deactivates the account and writes the audit row', async () => {
    const suffix = `H${Date.now().toString().slice(-8)}`;
    const asset = await assignFreshAsset(s.employee3.user.id, suffix);

    const started = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee3.user.id });
    const taskId = started.body.data.id;

    // Hand one over to a colleague rather than back to the pool - the panel
    // offers both, and either resolves the asset.
    const reassigned = await api(app)
      .post(`/api/v1/assets/${asset.id}/reassign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee2.user.id, conditionIn: 'GOOD' });
    expect(reassigned.status).toBe(201);

    const refreshed = await api(app).get(`/api/v1/lifecycle/tasks/${taskId}`).set(auth(s.hr));
    for (const outstanding of refreshed.body.data.outstandingAssets) {
      await api(app)
        .post(`/api/v1/assets/${outstanding.assetId}/return`)
        .set(auth(s.itAdmin))
        .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
    }
    const ready = await api(app).get(`/api/v1/lifecycle/tasks/${taskId}`).set(auth(s.hr));
    expect(ready.body.data.canComplete).toBe(true);

    const completed = await api(app)
      .post(`/api/v1/lifecycle/offboarding/${taskId}/complete`)
      .set(auth(s.hr))
      .send({});
    expect(completed.status, JSON.stringify(completed.body)).toBe(201);
    expect(completed.body.data.status).toBe('COMPLETED');
    expect(completed.body.data.exceptionReason).toBeNull();

    const subject = await api(app).get(`/api/v1/users/${s.employee3.user.id}`).set(auth(s.superAdmin));
    expect(subject.body.data.status).toBe('DEACTIVATED');

    // The account change is attributed to the offboarding, not to a bare status edit.
    const audit = await api(app)
      .get(`/api/v1/audit?entityType=User&entityId=${s.employee3.user.id}&pageSize=10`)
      .set(auth(s.superAdmin));
    expect(audit.status).toBe(200);
    expect(
      audit.body.data.some(
        (row: { newValues: { status?: string; reason?: string } | null }) =>
          row.newValues?.status === 'DEACTIVATED' && row.newValues?.reason === 'Offboarding completed',
      ),
    ).toBe(true);

    // Once completed, a fresh start opens a NEW task (the old one is closed).
    const again = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee3.user.id });
    expect(again.status).toBe(201);
    expect(again.body.data.id).not.toBe(taskId);
    await api(app)
      .post(`/api/v1/lifecycle/offboarding/${again.body.data.id}/complete`)
      .set(auth(s.hr))
      .send({});

    // Tidy the colleague's borrowed asset.
    await api(app)
      .post(`/api/v1/assets/${asset.id}/return`)
      .set(auth(s.itAdmin))
      .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
  });

  it('with an exception the asset stays recorded against the leaver', async () => {
    const suffix = `I${Date.now().toString().slice(-8)}`;
    const asset = await assignFreshAsset(s.employee3.user.id, suffix);

    const started = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee3.user.id });

    const completed = await api(app)
      .post(`/api/v1/lifecycle/offboarding/${started.body.data.id}/complete`)
      .set(auth(s.hr))
      .send({ exceptionReason: 'Left the country with the laptop; written off by Finance.' });
    expect(completed.status).toBe(201);
    expect(completed.body.data.status).toBe('COMPLETED');

    // The warning on the screen is true: custody is untouched.
    const still = await api(app)
      .get(`/api/v1/assets?assignedUserId=${s.employee3.user.id}&pageSize=100`)
      .set(auth(s.itAdmin));
    const row = still.body.data.find((a: { id: string }) => a.id === asset.id);
    expect(row?.status).toBe('ASSIGNED');

    await api(app)
      .post(`/api/v1/assets/${asset.id}/return`)
      .set(auth(s.itAdmin))
      .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
  });

  it('answers 404 for a subject or task outside the tenant', async () => {
    const start = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: 'usr_from_some_other_company' });
    expect(start.status).toBe(404);

    const read = await api(app)
      .get('/api/v1/lifecycle/tasks/task_from_some_other_company')
      .set(auth(s.hr));
    expect(read.status).toBe(404);

    const complete = await api(app)
      .post('/api/v1/lifecycle/offboarding/task_from_some_other_company/complete')
      .set(auth(s.hr))
      .send({});
    expect(complete.status).toBe(404);
  });
});

describe('offboarding authorisation', () => {
  it('refuses IT starting one (offboarding:manage is HR’s)', async () => {
    const response = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.itAdmin))
      .send({ subjectUserId: s.employee2.user.id });
    expect(response.status).toBe(403);
  });

  it('refuses an employee reading the task list the badge is built from', async () => {
    const response = await api(app)
      .get('/api/v1/lifecycle/tasks?direction=OFFBOARDING&status=OPEN')
      .set(auth(s.employee));
    expect(response.status).toBe(403);
  });

  it('refuses an employee starting an offboarding', async () => {
    const response = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.employee))
      .send({ subjectUserId: s.employee2.user.id });
    expect(response.status).toBe(403);
  });

  it('refuses IT completing one (offboarding:manage is HR’s)', async () => {
    const started = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee2.user.id });

    const response = await api(app)
      .post(`/api/v1/lifecycle/offboarding/${started.body.data.id}/complete`)
      .set(auth(s.itAdmin))
      .send({ exceptionReason: 'IT should not be able to sign this off at all.' });
    expect(response.status).toBe(403);
  });
});

describe('onboarding', () => {
  it('starts onboarding from a template and lists the required items', async () => {
    const response = await api(app)
      .post('/api/v1/lifecycle/onboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee2.user.id, templateKey: 'engineer-standard' });

    // A second concurrent onboarding for the same person is a conflict, which is
    // the expected result on a re-run against a persistent database.
    expect([201, 409]).toContain(response.status);

    if (response.status === 201) {
      expect(response.body.data.direction).toBe('ONBOARDING');
      expect(response.body.data.template.key).toBe('engineer-standard');
      expect(Array.isArray(response.body.data.checklist)).toBe(true);
      expect(response.body.data.checklist.length).toBeGreaterThan(0);
    }
  });

  it('refuses an unknown template rather than silently creating an empty checklist', async () => {
    const response = await api(app)
      .post('/api/v1/lifecycle/onboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: s.employee.user.id, templateKey: 'does-not-exist' });
    expect(response.status).toBe(404);
  });
});
