import type { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AlertSweepService } from '../src/scheduled/alert-sweep.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * v2.26 - the line manager is finally settable.
 *
 * The column has been on UserProfile since v2.2, and the approval chain has
 * always read it: a LINE_MANAGER step routes to the requester's named manager
 * and falls back to whoever holds the MANAGER role when there isn't one. But no
 * surface ever wrote it, so in production every profile had it null and the
 * fallback carried the entire company - one person approving for everybody.
 *
 * The field decides who signs off a person's spending, which is why the tests
 * below care as much about who may NOT set it, and what shapes are refused, as
 * about the happy path.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);
});

afterAll(async () => {
  await app?.close();
});

/** Nothing here should outlive its own test - the manager graph is global. */
afterEach(async () => {
  await prisma.client.userProfile.updateMany({
    where: { userId: { in: Object.values(s).map((x) => x.user.id) } },
    data: { managerId: null },
  });
});

const setManager = (target: Session, managerId: string | null, actor: Session = s.superAdmin) =>
  api(app)
    .patch(`/api/v1/users/${target.user.id}/profile`)
    .set(auth(actor))
    .send({ managerId });

const readManager = async (target: Session) => {
  const res = await api(app).get(`/api/v1/users/${target.user.id}`).set(auth(s.superAdmin));
  return res.body.data.profile?.manager ?? null;
};

describe('setting a line manager', () => {
  it('records the manager and returns them by name', async () => {
    const res = await setManager(s.employee, s.manager.user.id);
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

    const manager = await readManager(s.employee);
    expect(manager?.id).toBe(s.manager.user.id);
    // Name as well as email: a picker showing bare addresses is unreadable at
    // fifty people, which is the size this feature exists for.
    expect(manager?.profile?.firstName).toBeTruthy();
  });

  it('can be cleared again', async () => {
    await setManager(s.employee, s.manager.user.id);
    const res = await setManager(s.employee, null);
    expect(res.status).toBeLessThan(300);
    expect(await readManager(s.employee)).toBeNull();
  });

  it('leaves a before-and-after trail', async () => {
    await setManager(s.employee, s.manager.user.id);
    await setManager(s.employee, s.itAdmin.user.id);

    const entry = await prisma.client.auditLog.findFirst({
      where: { entityType: 'User', entityId: s.employee.user.id, action: 'USER_UPDATED' },
      orderBy: { createdAt: 'desc' },
    });
    // Who approved this person's spending before the change is exactly what an
    // auditor comes back for.
    expect((entry?.previousValues as Record<string, unknown>)?.managerId).toBe(s.manager.user.id);
    expect((entry?.newValues as Record<string, unknown>)?.managerId).toBe(s.itAdmin.user.id);
  });
});

describe('who may set it', () => {
  it('refuses self-service - you do not choose who approves your own spending', async () => {
    const res = await api(app)
      .patch('/api/v1/users/me/profile')
      .set(auth(s.employee))
      .send({ managerId: s.employee2.user.id });
    // 422, not 403: the self-service schema is strict, so an unknown key is
    // rejected at the door and never reaches the service guard behind it. The
    // guard still matters - it is what refuses the field if the admin schema is
    // ever routed through self mode - but strict gets there first, and being
    // refused earlier is the better failure.
    expect(res.status).toBe(422);
    expect(await readManager(s.employee)).toBeNull();
  });

  it('refuses an employee setting it on somebody else', async () => {
    const res = await setManager(s.employee2, s.manager.user.id, s.employee);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await readManager(s.employee2)).toBeNull();
  });
});

describe('shapes that are refused', () => {
  it('nobody manages themselves', async () => {
    const res = await setManager(s.employee, s.employee.user.id);
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('their own line manager');
  });

  it('refuses a direct loop', async () => {
    await setManager(s.manager, s.employee.user.id);
    const res = await setManager(s.employee, s.manager.user.id);
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('reporting loop');
  });

  it('refuses a loop several hops up the chain', async () => {
    // employee2 -> hr -> manager, so manager -> employee2 would close the ring.
    // The direct check would wave this through; only walking the chain catches
    // it, and an approval walk around a ring does not terminate.
    await setManager(s.employee2, s.hr.user.id);
    await setManager(s.hr, s.manager.user.id);

    const res = await setManager(s.manager, s.employee2.user.id);
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('reporting loop');
  });

  it('allows a deep chain that does not loop', async () => {
    await setManager(s.employee2, s.hr.user.id);
    await setManager(s.hr, s.manager.user.id);
    const res = await setManager(s.manager, s.superAdmin.user.id);
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  });

  it('refuses an unknown user', async () => {
    const res = await setManager(s.employee, 'nope-not-a-user');
    expect(res.status).toBe(404);
  });

  it('refuses a deactivated account - it could never act on the approval', async () => {
    // v3.23 - deactivation is refused while equipment is out; hand back
    // whatever an earlier file left with employee3.
    const held = await api(app)
      .get(`/api/v1/assets?assignedUserId=${s.employee3.user.id}&pageSize=100`)
      .set(auth(s.itAdmin));
    for (const asset of held.body.data ?? []) {
      await api(app)
        .post(`/api/v1/assets/${asset.id}/return`)
        .set(auth(s.itAdmin))
        .send({ conditionIn: 'GOOD', resultingStatus: 'AVAILABLE' });
    }
    const off = await api(app)
      .patch(`/api/v1/users/${s.employee3.user.id}/status`)
      .set(auth(s.superAdmin))
      .send({ status: 'DEACTIVATED' });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    try {
      const res = await setManager(s.employee, s.employee3.user.id);
      expect(res.status).toBe(422);
      expect(JSON.stringify(res.body)).toContain('deactivated');
    } finally {
      await api(app)
        .patch(`/api/v1/users/${s.employee3.user.id}/status`)
        .set(auth(s.superAdmin))
        .send({ status: 'ACTIVE' });
    }
  });
});

describe('what it is actually for', () => {
  it('routes the manager step to the named manager instead of the MANAGER role', async () => {
    // The IT Administrator holds no MANAGER role, so before this feature they
    // could never have been anybody's approver. Naming them proves the step
    // follows the field rather than the role fallback.
    await setManager(s.employee, s.itAdmin.user.id);

    const created = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.employee))
      .send({
        type: 'ADDITIONAL_EQUIPMENT',
        businessReason: 'Required for software development work.',
        items: [{ description: `Laptop ${Math.random().toString(36).slice(2, 8)}`, quantity: 1 }],
      });
    const id = created.body.data.id as string;
    await api(app).post(`/api/v1/requests/${id}/submit`).set(auth(s.employee));

    // The role-holder must NOT be able to take it any more.
    const wrongHands = await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s.manager))
      .send({ decision: 'APPROVED' });
    expect(wrongHands.status).toBeGreaterThanOrEqual(400);

    const rightHands = await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s.itAdmin))
      .send({ decision: 'APPROVED' });
    expect(rightHands.status, JSON.stringify(rightHands.body)).toBeLessThan(300);
  });
});

describe('overdue approvals reach somebody', () => {
  /** Raise, submit, and age the pending step past its SLA. */
  async function overdueRequest() {
    const created = await api(app)
      .post('/api/v1/requests')
      .set(auth(s.employee))
      .send({
        type: 'ADDITIONAL_EQUIPMENT',
        businessReason: 'Required for software development work.',
        items: [{ description: `Laptop ${Math.random().toString(36).slice(2, 10)}`, quantity: 1 }],
      });
    const id = created.body.data.id as string;
    const submitted = await api(app).post(`/api/v1/requests/${id}/submit`).set(auth(s.employee));
    const step = (submitted.body.data.approvals as { id: string; decision: string }[]).find(
      (a) => a.decision === 'PENDING',
    )!;
    await prisma.client.requestApproval.update({
      where: { id: step.id },
      data: { slaDueAt: new Date(Date.now() - 3_600_000) },
    });
    return { id, stepId: step.id };
  }

  it('escalates to the Manager role when nobody has a line manager', async () => {
    // The state every production request is in today: no line manager anywhere.
    // The sweep used to stamp the step escalated and tell nobody, and because
    // escalatedAt bars a rescan the alert was gone for good.
    const { stepId } = await overdueRequest();

    const raised = await app.get(AlertSweepService).runApprovalEscalationSweep();
    expect(raised).toBeGreaterThanOrEqual(1);

    const notice = await prisma.client.notification.findFirst({
      where: { userId: s.manager.user.id, type: 'APPROVAL_ESCALATED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notice, 'the role holder carrying the step must be told').not.toBeNull();

    const row = await prisma.client.requestApproval.findUnique({
      where: { id: stepId },
      select: { escalatedAt: true },
    });
    expect(row?.escalatedAt).not.toBeNull();
  });

  it('prefers the named line manager over the role fallback', async () => {
    await setManager(s.employee, s.itAdmin.user.id);
    const before = await prisma.client.notification.count({
      where: { userId: s.itAdmin.user.id, type: 'APPROVAL_ESCALATED' },
    });

    await overdueRequest();
    await app.get(AlertSweepService).runApprovalEscalationSweep();

    const after = await prisma.client.notification.count({
      where: { userId: s.itAdmin.user.id, type: 'APPROVAL_ESCALATED' },
    });
    expect(after).toBeGreaterThan(before);
  });

  it('never escalates to the requester - they cannot act on their own step', async () => {
    const before = await prisma.client.notification.count({
      where: { userId: s.employee.user.id, type: 'APPROVAL_ESCALATED' },
    });
    await overdueRequest();
    await app.get(AlertSweepService).runApprovalEscalationSweep();
    const after = await prisma.client.notification.count({
      where: { userId: s.employee.user.id, type: 'APPROVAL_ESCALATED' },
    });
    expect(after).toBe(before);
  });
});
