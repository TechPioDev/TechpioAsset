import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.85 — looking at offboarding is not starting it.
 *
 * The owner opened the offboarding screen to see what it did. That created an
 * offboarding, put "Offboarding in progress" on the person, told them to hand
 * their equipment back, and left no way to undo it. Two rules now:
 * the preview writes nothing, and an offboarding started by mistake can be
 * called off.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;
let prisma: PrismaService;
let subject: string;

const openTasks = (userId: string) =>
  prisma.client.onboardingTask.count({
    where: { subjectUserId: userId, direction: 'OFFBOARDING', status: 'OPEN' },
  });

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
  prisma = app.get(PrismaService);
  subject = s.employee2.user.id;
  await prisma.client.onboardingTask.deleteMany({
    where: { subjectUserId: subject, direction: 'OFFBOARDING' },
  });
});

afterAll(async () => {
  await prisma?.client.onboardingTask.deleteMany({
    where: { subjectUserId: subject, direction: 'OFFBOARDING' },
  });
  await app?.close();
});

describe('opening the offboarding screen', () => {
  it('shows what it would involve and starts nothing', async () => {
    const before = await prisma.client.notification.count({
      where: { userId: subject, type: 'RETURN_REQUIRED' },
    });

    const res = await api(app)
      .get(`/api/v1/lifecycle/offboarding/preview/${subject}`)
      .set(auth(s.hr));
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.data.task).toBeNull();
    expect(Array.isArray(res.body.data.outstanding)).toBe(true);

    expect(await openTasks(subject), 'nothing was started').toBe(0);
    expect(
      await prisma.client.notification.count({
        where: { userId: subject, type: 'RETURN_REQUIRED' },
      }),
      'nobody was asked to hand anything back',
    ).toBe(before);
  });

  it('is refused to someone who may not offboard', async () => {
    const res = await api(app)
      .get(`/api/v1/lifecycle/offboarding/preview/${subject}`)
      .set(auth(s.employee));
    expect(res.status).toBe(403);
  });
});

describe('calling off an offboarding started by mistake', () => {
  let taskId: string;

  it('starts one deliberately, and the preview then shows it', async () => {
    const started = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: subject });
    expect(started.status, JSON.stringify(started.body).slice(0, 300)).toBe(201);
    taskId = started.body.data.id;
    expect(await openTasks(subject)).toBe(1);

    const preview = await api(app)
      .get(`/api/v1/lifecycle/offboarding/preview/${subject}`)
      .set(auth(s.hr));
    expect(preview.body.data.task?.id).toBe(taskId);
  });

  it('clears the "in progress" badge and tells the person it is off', async () => {
    const res = await api(app)
      .post(`/api/v1/lifecycle/offboarding/${taskId}/cancel`)
      .set(auth(s.hr))
      .send({ reason: 'Opened by mistake' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(await openTasks(subject), 'the badge is gone').toBe(0);

    const told = await prisma.client.notification.findFirst({
      where: { userId: subject, entityId: taskId },
      orderBy: { createdAt: 'desc' },
    });
    expect(told?.title).toBe('Your offboarding was called off');
    expect(told?.body).toContain('Opened by mistake');

    // The record is kept, with the reason - not deleted.
    const row = await prisma.client.onboardingTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.status).toBe('CANCELLED');
    expect(row.exceptionReason).toBe('Opened by mistake');
  });

  it('cannot be called off twice, and says why', async () => {
    const res = await api(app)
      .post(`/api/v1/lifecycle/offboarding/${taskId}/cancel`)
      .set(auth(s.hr))
      .send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(`${res.body.title} ${res.body.detail}`).toMatch(/already cancelled|still in progress/i);
  });

  it('is refused to someone who may not offboard', async () => {
    const started = await api(app)
      .post('/api/v1/lifecycle/offboarding')
      .set(auth(s.hr))
      .send({ subjectUserId: subject });
    const res = await api(app)
      .post(`/api/v1/lifecycle/offboarding/${started.body.data.id}/cancel`)
      .set(auth(s.employee))
      .send({});
    expect(res.status).toBe(403);
    expect(await openTasks(subject)).toBe(1);
    await api(app)
      .post(`/api/v1/lifecycle/offboarding/${started.body.data.id}/cancel`)
      .set(auth(s.hr))
      .send({ reason: 'tidy up' });
  });
});
