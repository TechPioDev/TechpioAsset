import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { READ_ONLY_ROLES, ROLE_PERMISSIONS, isReadOnlyPermission } from '@techpioasset/domain';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  ACCOUNTS,
  api,
  auth,
  createTestApp,
  login,
  loginAll,
  type AccountKey,
  type Session,
} from './harness.js';

/**
 * v2.24 - configuring approval workflows from the application.
 *
 * Spec section 11 has always required Super Admins to configure steps and
 * thresholds. `workflows:configure` was granted to Super Admin and enforced by
 * no route, so a cost threshold could only be changed by editing the database
 * by hand: no audit row, and nobody but an engineer could do it.
 *
 * The behavioural test is the one that matters: clearing the Finance step's
 * threshold must make Finance review a cheap request it previously never saw.
 */

let app: INestApplication;
let prisma: PrismaService;
let s: Record<AccountKey, Session>;
let financeStepId: string;
let originalThreshold: string | null = null;
/** The catch-all definition the restructuring tests edit. */
let definitionId: string;
/** A step name no seed uses, so leftovers from a broken run are recognisable. */
const ADDED_STEP = 'Director sign-off';

const listWorkflows = (as: Session) => api(app).get('/api/v1/workflows').set(auth(as));

type StepView = {
  id: string;
  stepOrder: number;
  name: string;
  kind: string;
  approverRoleKey: string | null;
  costThreshold: string | null;
  isEnabled: boolean;
  canRemove: boolean;
  canDisable: boolean;
};

async function stepsOf(id: string): Promise<StepView[]> {
  const res = await listWorkflows(s.superAdmin);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const definition = (res.body.data as { id: string; steps: StepView[] }[]).find(
    (d) => d.id === id,
  );
  expect(definition, 'the workflow should still be listed').toBeTruthy();
  return definition!.steps;
}

/**
 * Remove any step this suite added, and switch every step back on, whatever
 * state a previous run left.
 */
async function dropAddedStep() {
  await prisma.client.workflowStep.updateMany({
    where: { workflowDefinitionId: definitionId, isEnabled: false },
    data: { isEnabled: true },
  });
  const strays = await prisma.client.workflowStep.findMany({
    where: { workflowDefinitionId: definitionId, name: ADDED_STEP },
    select: { id: true },
  });
  for (const stray of strays) {
    await api(app).delete(`/api/v1/workflows/steps/${stray.id}`).set(auth(s.superAdmin));
  }
}

async function raiseCheapRequest() {
  const created = await api(app)
    .post('/api/v1/requests')
    .set(auth(s.officeAdmin))
    .send({
      type: 'ADDITIONAL_EQUIPMENT',
      businessReason: 'Threshold behaviour.',
      estimatedCost: '10.00',
      items: [
        { description: `Cheap ${Math.random().toString(36).slice(2, 8)}`, quantity: 1, estimatedCost: '10.00' },
      ],
    });
  expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
  const id = created.body.data.id as string;
  await api(app).post(`/api/v1/requests/${id}/submit`).set(auth(s.officeAdmin));
  return id;
}

/**
 * Does the Finance step actually apply?
 *
 * The chain has to be walked to find out: since v2.25 a threshold is evaluated
 * when the step comes up, not when the chain is built, because the cost is
 * entered after submission. A queued step has simply not been decided yet.
 */
async function financeApplies(id: string) {
  const byStep: Record<string, AccountKey> = {
    'Manager review': 'manager',
    'HR confirmation': 'hr',
    'IT review': 'itAdmin',
    'Office review': 'officeAdmin',
  };
  for (let guard = 0; guard < 8; guard += 1) {
    const detail = await api(app).get(`/api/v1/requests/${id}`).set(auth(s.superAdmin));
    const steps = detail.body.data.approvals as { stepName: string; decision: string }[];
    const finance = steps.find((a) => a.stepName === 'Finance approval');
    if (!finance) return false;
    if (finance.decision === 'SKIPPED') return false;
    if (finance.decision !== 'WAITING') return true;

    const current = steps.find((a) => a.decision === 'PENDING');
    if (!current) return false;
    const who = byStep[current.stepName];
    if (!who) return false;
    await api(app)
      .post(`/api/v1/requests/${id}/decision`)
      .set(auth(s[who]))
      .send({ decision: 'APPROVED' });
  }
  return false;
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  s = await loginAll(app);

  const step = await prisma.client.workflowStep.findFirstOrThrow({
    where: {
      name: 'Finance approval',
      workflowDefinition: { companyId: s.superAdmin.user.companyId, requestType: null },
    },
    select: { id: true, costThreshold: true, workflowDefinitionId: true },
  });
  financeStepId = step.id;
  originalThreshold = step.costThreshold ? step.costThreshold.toString() : null;
  definitionId = step.workflowDefinitionId;
  await dropAddedStep();
});

afterAll(async () => {
  await dropAddedStep();
  await prisma.client.workflowStep.update({
    where: { id: financeStepId },
    data: { costThreshold: originalThreshold },
  });
  await app?.close();
});

describe('reading the configured chains', () => {
  it('needs workflows:configure - IT and HR cannot see it', async () => {
    for (const who of ['itAdmin', 'hr', 'employee'] as AccountKey[]) {
      const res = await listWorkflows(s[who]);
      expect(res.status, `${who} must not read workflow configuration`).toBe(403);
    }
  });

  it('reports each step with how many people could actually decide it', async () => {
    const res = await listWorkflows(s.superAdmin);
    expect(res.status).toBe(200);

    const itWorkflow = (res.body.data as { requestType: string | null; steps: unknown[] }[]).find(
      (w) => w.requestType === null,
    )!;
    const steps = itWorkflow.steps as {
      name: string;
      eligibleApprovers: number;
      costThreshold: string | null;
    }[];

    expect(steps.map((x) => x.name)).toContain('Finance approval');
    // The staffing number is the point of the page: a threshold is only half
    // the question about whether a step will ever be decided.
    for (const step of steps) expect(typeof step.eligibleApprovers).toBe('number');
  });
});

describe('clearing a threshold', () => {
  it('makes the step review every request, and is audited', async () => {
    // Before: a cheap request never reaches Finance.
    await prisma.client.workflowStep.update({
      where: { id: financeStepId },
      data: { costThreshold: '250' },
    });
    // v2.25 - the step is created either way; the threshold decides whether it
    // applies when it comes up, because the cost is entered after submission.
    expect(await financeApplies(await raiseCheapRequest())).toBe(false);

    const cleared = await api(app)
      .patch(`/api/v1/workflows/steps/${financeStepId}`)
      .set(auth(s.superAdmin))
      .send({ costThreshold: null });
    expect(cleared.status, JSON.stringify(cleared.body)).toBeLessThan(300);

    // After: the same cheap request does.
    expect(await financeApplies(await raiseCheapRequest())).toBe(true);

    // Changing who must approve what leaves the same trail a role change does.
    const trail = await prisma.client.auditLog.findFirst({
      where: { entityType: 'WorkflowStep', entityId: financeStepId },
      orderBy: { createdAt: 'desc' },
    });
    expect(trail).not.toBeNull();
    expect(JSON.stringify(trail!.previousValues)).toContain('250');
  });

  it('refuses a step belonging to another tenant, as missing rather than forbidden', async () => {
    const res = await api(app)
      .patch('/api/v1/workflows/steps/not-a-real-step-id')
      .set(auth(s.superAdmin))
      .send({ costThreshold: null });
    expect(res.status).toBe(404);
  });

  it('rejects a nonsense threshold', async () => {
    const res = await api(app)
      .patch(`/api/v1/workflows/steps/${financeStepId}`)
      .set(auth(s.superAdmin))
      .send({ costThreshold: '-5' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

/**
 * v2.26 - the Inventory Manager case.
 *
 * Reported from production: the owner gave Tanvi the Inventory Manager role so
 * she could do an inventory check, and the request stayed invisible to her.
 * Two reasons, both fixed here:
 *
 *   1. INVENTORY_MANAGER held no `requests:*` permission at all, so opening the
 *      request was refused outright - the role could be named on the stage and
 *      still be turned away at the door.
 *   2. The stage was staffed by OFFICE_ADMIN and no screen could change that,
 *      so assigning a different role could never have worked.
 *
 * And because a chain is snapshotted at submission, changing the workflow had
 * to move the requests already waiting too, or the person just given the job
 * still would not see them.
 */
describe('reassigning who staffs a step', () => {
  it('only Office Admin, Finance and the admins may price a request', () => {
    // The owner's rule, pinned so it cannot drift back: the price is what routes
    // a request past Finance, so the roles that can set it are the ones trusted
    // with money. IT decides whether the equipment is warranted - that is the IT
    // review step - not what it costs.
    const holders = (Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]).filter(
      (role) => (ROLE_PERMISSIONS[role] as readonly string[]).includes('requests:assess'),
    );
    expect(holders).not.toContain('IT_ADMIN');
    expect(holders).toEqual(
      expect.arrayContaining(['OFFICE_ADMIN', 'FINANCE', 'INVENTORY_MANAGER']),
    );
  });

  it('an Inventory Manager can read and assess requests', () => {
    const perms = ROLE_PERMISSIONS.INVENTORY_MANAGER as readonly string[];
    expect(perms).toContain('requests:read');
    expect(perms).toContain('requests:assess');
    // Assessing is recording what stock says; approving spend is not its job.
    expect(perms).not.toContain('requests:approve');
  });

  it('moves the step, and the requests already waiting on it', async () => {
    const defs = await api(app).get('/api/v1/workflows').set(auth(s.superAdmin));
    const definition = (defs.body.data as { id: string; steps: { id: string; name: string; approverRoleKey: string | null }[] }[])
      .find((d) => d.steps.some((x) => x.approverRoleKey === 'OFFICE_ADMIN'));
    expect(definition, 'a step staffed by Office Admin to move').toBeTruthy();
    const step = definition!.steps.find((x) => x.approverRoleKey === 'OFFICE_ADMIN')!;

    const before = await prisma.client.requestApproval.count({
      where: {
        stepName: step.name,
        decision: { in: ['WAITING', 'PENDING'] },
        request: { workflowDefinitionId: definition!.id },
        approverRole: { key: 'OFFICE_ADMIN' },
      },
    });

    const res = await api(app)
      .patch(`/api/v1/workflows/steps/${step.id}`)
      .set(auth(s.superAdmin))
      .send({ approverRoleKey: 'INVENTORY_MANAGER' });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

    const moved = (res.body.data as { id: string; steps: { id: string; approverRoleKey: string | null }[] }[])
      .flatMap((d) => d.steps)
      .find((x) => x.id === step.id);
    expect(moved?.approverRoleKey).toBe('INVENTORY_MANAGER');

    // The chains already in flight followed it.
    const stillOld = await prisma.client.requestApproval.count({
      where: {
        stepName: step.name,
        decision: { in: ['WAITING', 'PENDING'] },
        request: { workflowDefinitionId: definition!.id },
        approverRole: { key: 'OFFICE_ADMIN' },
      },
    });
    expect(stillOld, 'no undecided step left pointing at the old role').toBe(0);

    const nowNew = await prisma.client.requestApproval.count({
      where: {
        stepName: step.name,
        decision: { in: ['WAITING', 'PENDING'] },
        request: { workflowDefinitionId: definition!.id },
        approverRole: { key: 'INVENTORY_MANAGER' },
      },
    });
    expect(nowNew).toBe(before);

    // Put it back so the rest of the suite sees what it expects.
    await api(app)
      .patch(`/api/v1/workflows/steps/${step.id}`)
      .set(auth(s.superAdmin))
      .send({ approverRoleKey: 'OFFICE_ADMIN' });
  });

  /**
   * v2.27 - the third way the same person still saw nothing.
   *
   * The role could read and assess, and the stage had been handed to it. But
   * the dashboard tile announcing "something is waiting on you" was gated on
   * `requests:approve`, which an Inventory Manager deliberately does not hold -
   * so moving the stage to them removed the only place their queue was
   * advertised. The request was in their inbox and every screen said it was
   * not, which is indistinguishable from the bug that was just fixed.
   */
  it('an assess-only holder is still told something is waiting on them', async () => {
    const target = s.employee2.user;
    const restore = target.roles.length > 0 ? [...target.roles] : ['EMPLOYEE'];

    try {
      const granted = await api(app)
        .patch(`/api/v1/users/${target.id}/roles`)
        .set(auth(s.superAdmin))
        .send({ roleKeys: ['INVENTORY_MANAGER'] });
      expect(granted.status, JSON.stringify(granted.body)).toBeLessThan(300);

      // Permissions ride on the token, so the new role needs a fresh sign-in -
      // the same thing the real user does.
      const session = await login(app, ACCOUNTS.employee2);
      expect(session.user.permissions).toContain('requests:assess');
      expect(session.user.permissions).not.toContain('requests:approve');

      const dash = await api(app).get('/api/v1/dashboard').set(auth(session));
      expect(dash.status, JSON.stringify(dash.body)).toBeLessThan(300);
      const tiles = dash.body.data.tiles as { key: string; label: string }[];
      const queue = tiles.find((t) => t.key === 'awaiting-approval');

      expect(queue, 'an Inventory Manager must be shown the queue their stage lands in').toBeTruthy();
      // And it must not promise an approval they cannot give.
      expect(queue!.label.toLowerCase()).not.toContain('approval');
    } finally {
      await api(app)
        .patch(`/api/v1/users/${target.id}/roles`)
        .set(auth(s.superAdmin))
        .send({ roleKeys: restore });
    }
  });

  /**
   * v2.27 - stopping is not approving.
   *
   * Moving the Inventory check to Inventory Manager removed the only exit from
   * that stage: the person best placed to spot a duplicate was the one person
   * who could not stop it, because the decline path was gated on
   * `requests:approve`. `requests:decline` splits the two rights so the stage
   * can be staffed without handing over approval of spend.
   */
  it('an Inventory Manager may stop a request but never approve one', () => {
    const perms = ROLE_PERMISSIONS.INVENTORY_MANAGER as readonly string[];
    expect(perms).toContain('requests:decline');
    expect(perms).not.toContain('requests:approve');
  });

  it('every role that can approve can also refuse', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      const held = perms as readonly string[];
      if (!held.includes('requests:approve')) continue;
      expect(held, `${role} can approve but not refuse`).toContain('requests:decline');
    }
  });

  it('declining counts as a write, so a read-only role can never hold it', () => {
    // Both of these were missing from the write-action pattern, which would have
    // let the Auditor invariant wave them through had either been granted.
    expect(isReadOnlyPermission('requests:decline')).toBe(false);
    expect(isReadOnlyPermission('requests:assess')).toBe(false);
    for (const role of READ_ONLY_ROLES) {
      expect(ROLE_PERMISSIONS[role] as readonly string[]).not.toContain('requests:decline');
    }
  });

  it('refuses a role that does not exist', async () => {
    const defs = await api(app).get('/api/v1/workflows').set(auth(s.superAdmin));
    const step = (defs.body.data as { steps: { id: string }[] }[])[0]!.steps[0]!;
    const res = await api(app)
      .patch(`/api/v1/workflows/steps/${step.id}`)
      .set(auth(s.superAdmin))
      .send({ approverRoleKey: 'NOT_A_ROLE' });
    expect(res.status).toBe(404);
  });

  it('needs workflows:configure', async () => {
    const defs = await api(app).get('/api/v1/workflows').set(auth(s.superAdmin));
    const step = (defs.body.data as { steps: { id: string }[] }[])[0]!.steps[0]!;
    const res = await api(app)
      .patch(`/api/v1/workflows/steps/${step.id}`)
      .set(auth(s.officeAdmin))
      .send({ approverRoleKey: 'INVENTORY_MANAGER' });
    expect(res.status).toBe(403);
  });
});

/**
 * v2.28 - restructuring a chain: add, rename, remove, reorder.
 *
 * The owner's ask, verbatim: "how we hide or remove any option, like remove
 * the HR step, or add another step ... can we rearrange all steps". Until now
 * the page could tune a step and not change what the process IS.
 *
 * The rules pinned here: a chain keeps at least one approval step; the two
 * assessment stages stay a pair, placed before the first thresholded step, and
 * leave only via their own switch; and a request already in flight carries
 * the chain it was submitted with - a removed step is still decided there,
 * and only new requests skip it.
 */
describe('restructuring a chain', () => {
  let addedStepId: string;

  const setStages = (enabled: boolean) =>
    api(app)
      .patch(`/api/v1/workflows/${definitionId}/assessment-stages`)
      .set(auth(s.superAdmin))
      .send({ enabled });

  const reorder = (stepIds: string[]) =>
    api(app)
      .put(`/api/v1/workflows/${definitionId}/steps/order`)
      .set(auth(s.superAdmin))
      .send({ stepIds });

  const approvalIds = (steps: StepView[]) =>
    steps.filter((x) => x.kind === 'APPROVAL').map((x) => x.id);

  const contiguous = (steps: StepView[]) =>
    expect(steps.map((x) => x.stepOrder)).toEqual(steps.map((_, i) => i + 1));

  beforeAll(async () => {
    // A known shape: no stages, Finance thresholded so the pair has somewhere
    // to go when the stages are switched on below.
    await setStages(false);
    await api(app)
      .patch(`/api/v1/workflows/steps/${financeStepId}`)
      .set(auth(s.superAdmin))
      .send({ costThreshold: '250' });
  });

  afterAll(async () => {
    await setStages(false);
  });

  it('needs workflows:configure', async () => {
    const steps = await stepsOf(definitionId);
    const post = await api(app)
      .post(`/api/v1/workflows/${definitionId}/steps`)
      .set(auth(s.officeAdmin))
      .send({ name: ADDED_STEP, approverType: 'ROLE', approverRoleKey: 'HR' });
    expect(post.status).toBe(403);
    const del = await api(app)
      .delete(`/api/v1/workflows/steps/${steps[0]!.id}`)
      .set(auth(s.officeAdmin));
    expect(del.status).toBe(403);
    const put = await api(app)
      .put(`/api/v1/workflows/${definitionId}/steps/order`)
      .set(auth(s.officeAdmin))
      .send({ stepIds: approvalIds(steps) });
    expect(put.status).toBe(403);
  });

  it('reads an unknown or foreign id as missing', async () => {
    const post = await api(app)
      .post('/api/v1/workflows/not-a-workflow/steps')
      .set(auth(s.superAdmin))
      .send({ name: ADDED_STEP, approverType: 'ROLE', approverRoleKey: 'HR' });
    expect(post.status).toBe(404);
    const del = await api(app).delete('/api/v1/workflows/steps/not-a-step').set(auth(s.superAdmin));
    expect(del.status).toBe(404);
    const put = await api(app)
      .put('/api/v1/workflows/not-a-workflow/steps/order')
      .set(auth(s.superAdmin))
      .send({ stepIds: ['x'] });
    expect(put.status).toBe(404);
  });

  it('adds a step at the asked position, renumbered and audited', async () => {
    const before = (await stepsOf(definitionId)).map((x) => x.name);
    expect(before).toEqual(['Manager review', 'HR confirmation', 'IT review', 'Finance approval']);

    const res = await api(app)
      .post(`/api/v1/workflows/${definitionId}/steps`)
      .set(auth(s.superAdmin))
      .send({ name: ADDED_STEP, approverType: 'ROLE', approverRoleKey: 'HR', position: 2 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const steps = await stepsOf(definitionId);
    expect(steps.map((x) => x.name)).toEqual([
      'Manager review',
      ADDED_STEP,
      'HR confirmation',
      'IT review',
      'Finance approval',
    ]);
    contiguous(steps);
    const added = steps.find((x) => x.name === ADDED_STEP)!;
    addedStepId = added.id;
    expect(added.approverRoleKey).toBe('HR');
    expect(added.canRemove).toBe(true);

    const trail = await prisma.client.auditLog.findFirst({
      where: { entityType: 'WorkflowStep', entityId: addedStepId },
      orderBy: { createdAt: 'desc' },
    });
    expect(trail, 'adding a step is a governance change').not.toBeNull();
    expect(JSON.stringify(trail!.newValues)).toContain(ADDED_STEP);
  });

  it('a ROLE step needs a role, and the role must exist', async () => {
    const noRole = await api(app)
      .post(`/api/v1/workflows/${definitionId}/steps`)
      .set(auth(s.superAdmin))
      .send({ name: 'Nobody', approverType: 'ROLE' });
    expect(noRole.status).toBe(422);
    const badRole = await api(app)
      .post(`/api/v1/workflows/${definitionId}/steps`)
      .set(auth(s.superAdmin))
      .send({ name: 'Nobody', approverType: 'ROLE', approverRoleKey: 'NOT_A_ROLE' });
    expect(badRole.status).toBe(404);
  });

  it('renames a step, and only the definition', async () => {
    const res = await api(app)
      .patch(`/api/v1/workflows/steps/${addedStepId}`)
      .set(auth(s.superAdmin))
      .send({ name: 'Director approval' });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect((await stepsOf(definitionId)).find((x) => x.id === addedStepId)?.name).toBe(
      'Director approval',
    );

    const trail = await prisma.client.auditLog.findFirst({
      where: { entityType: 'WorkflowStep', entityId: addedStepId },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(trail!.previousValues)).toContain(ADDED_STEP);
    expect(JSON.stringify(trail!.newValues)).toContain('Director approval');

    // Back to the name the rest of the suite (and its cleanup) looks for.
    await api(app)
      .patch(`/api/v1/workflows/steps/${addedStepId}`)
      .set(auth(s.superAdmin))
      .send({ name: ADDED_STEP });
  });

  it('reorders the approval steps, and the assessment pair follows its rule', async () => {
    expect((await setStages(true)).status).toBeLessThan(300);
    const withStages = await stepsOf(definitionId);
    expect(withStages.map((x) => x.name)).toEqual([
      'Manager review',
      ADDED_STEP,
      'HR confirmation',
      'IT review',
      'Inventory check',
      'Cost assessment',
      'Finance approval',
    ]);
    const original = approvalIds(withStages);

    // Finance, the thresholded step, moves to the front: the pair must go
    // with it, because its answer is what Finance's threshold is measured
    // against.
    const reversed = await reorder([...original].reverse());
    expect(reversed.status, JSON.stringify(reversed.body)).toBeLessThan(300);
    const after = await stepsOf(definitionId);
    expect(after.map((x) => x.name)).toEqual([
      'Inventory check',
      'Cost assessment',
      'Finance approval',
      'IT review',
      'HR confirmation',
      ADDED_STEP,
      'Manager review',
    ]);
    contiguous(after);

    const trail = await prisma.client.auditLog.findFirst({
      where: { entityType: 'WorkflowDefinition', entityId: definitionId },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(trail!.newValues)).toContain('Finance approval');

    // And back.
    expect((await reorder(original)).status).toBeLessThan(300);
    const restored = await stepsOf(definitionId);
    expect(restored.map((x) => x.name)).toEqual(withStages.map((x) => x.name));
    contiguous(restored);

    // A list that drops a step, or names a stage, is refused rather than
    // repaired - either would silently change what the process is.
    expect((await reorder(original.slice(1))).status).toBe(422);
    const stage = restored.find((x) => x.kind === 'INVENTORY_CHECK')!;
    expect((await reorder([...original, stage.id])).status).toBe(422);
    expect((await reorder([original[0]!, ...original])).status).toBe(422);

    await setStages(false);
  });

  it('refuses to remove an assessment stage on its own', async () => {
    await setStages(true);
    const stage = (await stepsOf(definitionId)).find((x) => x.kind === 'INVENTORY_CHECK')!;
    expect(stage.canRemove).toBe(false);
    const res = await api(app)
      .delete(`/api/v1/workflows/steps/${stage.id}`)
      .set(auth(s.superAdmin));
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('Remove stages');
    await setStages(false);
  });

  it('refuses to remove the last approval step', async () => {
    // A scratch definition of one step, inactive so no request ever resolves
    // to it. Cascade removes the step with it.
    const hr = await prisma.client.role.findFirstOrThrow({
      where: { companyId: s.superAdmin.user.companyId, key: 'HR' },
      select: { id: true },
    });
    const scratch = await prisma.client.workflowDefinition.create({
      data: {
        companyId: s.superAdmin.user.companyId,
        key: `single-step-${Date.now()}`,
        name: 'Single step (test)',
        isActive: false,
        steps: {
          create: { stepOrder: 1, name: 'Only step', approverType: 'ROLE', approverRoleId: hr.id },
        },
      },
    });
    try {
      const only = (await stepsOf(scratch.id))[0]!;
      expect(only.canRemove).toBe(false);
      const res = await api(app)
        .delete(`/api/v1/workflows/steps/${only.id}`)
        .set(auth(s.superAdmin));
      expect(res.status).toBe(422);
      expect(JSON.stringify(res.body)).toContain('at least one approval step');
      expect(await prisma.client.workflowStep.count({ where: { id: only.id } })).toBe(1);
    } finally {
      await prisma.client.workflowDefinition.delete({ where: { id: scratch.id } });
    }
  });

  /**
   * The owner's rule, changed after seeing the first version live: a removed
   * step disappears from requests still in progress too. REQ-2026-000020 was
   * submitted at 07:45, HR was switched off at 10:08, and HR still showed
   * "Queued" in its chain - the owner expected it gone.
   */
  it('a removed step leaves requests in progress: queued copies go, a current one is skipped', async () => {
    // Queued: Manager is current, the added step waits behind it.
    const queued = await raiseCheapRequest();
    // Current: Manager approved, the added step is the one awaiting a decision.
    const current = await raiseCheapRequest();
    const toDirector = await api(app)
      .post(`/api/v1/requests/${current}/decision`)
      .set(auth(s.manager))
      .send({ decision: 'APPROVED' });
    expect(toDirector.status, JSON.stringify(toDirector.body)).toBeLessThan(300);
    expect(await currentStepOf(current)).toBe(ADDED_STEP);
    // Decided: walked straight through the added step, so its row is history.
    const decided = await raiseCheapRequest();
    for (const who of ['manager', 'hr'] as AccountKey[]) {
      await api(app).post(`/api/v1/requests/${decided}/decision`).set(auth(s[who])).send({ decision: 'APPROVED' });
    }
    expect(
      (await chainOf(decided)).find((a) => a.stepName === ADDED_STEP)?.decision,
    ).toBe('APPROVED');
    const foreignBefore = await foreignWaitingRows(ADDED_STEP);
    const noticesBefore = await prisma.client.notification.count({
      where: { entityId: current, type: 'APPROVAL_REQUIRED' },
    });

    const removed = await api(app)
      .delete(`/api/v1/workflows/steps/${addedStepId}`)
      .set(auth(s.superAdmin));
    expect(removed.status, JSON.stringify(removed.body)).toBeLessThan(300);
    const steps = await stepsOf(definitionId);
    expect(steps.map((x) => x.name)).toEqual([
      'Manager review',
      'HR confirmation',
      'IT review',
      'Finance approval',
    ]);
    contiguous(steps);

    // Queued copy: gone, the request still where it was.
    const queuedChain = await chainOf(queued);
    expect(queuedChain.map((a) => a.stepName)).not.toContain(ADDED_STEP);
    expect(await currentStepOf(queued)).toBe('Manager review');
    // And the rest of the chain is intact: Manager approving lands on HR.
    await api(app).post(`/api/v1/requests/${queued}/decision`).set(auth(s.manager)).send({ decision: 'APPROVED' });
    expect(await currentStepOf(queued)).toBe('HR confirmation');

    // Current copy: skipped with the reason on it, and the request moved on
    // to the next step, whose approvers were told.
    const currentChain = await chainOf(current);
    const skipped = currentChain.find((a) => a.stepName === ADDED_STEP)!;
    expect(skipped.decision).toBe('SKIPPED');
    expect(skipped.comment).toContain('switched off in workflow settings');
    expect(await currentStepOf(current)).toBe('HR confirmation');
    expect(await statusOf(current)).toBe('HR_REVIEW_PENDING');
    expect(
      await prisma.client.notification.count({
        where: { entityId: current, type: 'APPROVAL_REQUIRED' },
      }),
    ).toBeGreaterThan(noticesBefore);
    // The manager's decision before it is untouched.
    expect(currentChain.find((a) => a.stepName === 'Manager review')?.decision).toBe('APPROVED');

    // Decided copy: history, and stays.
    expect(
      (await chainOf(decided)).find((a) => a.stepName === ADDED_STEP)?.decision,
    ).toBe('APPROVED');

    // Another tenant's requests are not this tenant's business.
    expect(await foreignWaitingRows(ADDED_STEP)).toBe(foreignBefore);

    // A request raised now never sees it.
    const fresh = await raiseCheapRequest();
    expect((await chainOf(fresh)).map((a) => a.stepName)).not.toContain(ADDED_STEP);

    // The trail says how far the removal reached.
    const trail = await prisma.client.auditLog.findFirst({
      where: { entityType: 'WorkflowStep', entityId: addedStepId },
      orderBy: { createdAt: 'desc' },
    });
    const newValues = trail!.newValues as {
      removed: boolean;
      inFlightRemoved: number;
      inFlightSkipped: number;
    };
    expect(newValues.removed).toBe(true);
    expect(newValues.inFlightRemoved).toBeGreaterThanOrEqual(1);
    expect(newValues.inFlightSkipped).toBeGreaterThanOrEqual(1);
  });
});

const chainOf = async (id: string) =>
  (await api(app).get(`/api/v1/requests/${id}`).set(auth(s.superAdmin))).body.data.approvals as {
    stepName: string;
    decision: string;
    comment: string | null;
  }[];

const currentStepOf = async (id: string) =>
  (await chainOf(id)).find((a) => a.decision === 'PENDING')?.stepName ?? null;

const statusOf = async (id: string) =>
  (await api(app).get(`/api/v1/requests/${id}`).set(auth(s.superAdmin))).body.data.status as string;

/** Undecided copies of a step in every OTHER tenant - must never move. */
const foreignWaitingRows = (stepName: string) =>
  prisma.client.requestApproval.count({
    where: {
      stepName,
      decision: { in: ['WAITING', 'PENDING'] },
      request: { companyId: { not: s.superAdmin.user.companyId } },
    },
  });

/**
 * v2.28 - the On/Off switch.
 *
 * Removing a step throws away its name, role and threshold; switching it off
 * keeps them for the day it is wanted back. Same reach as a removal: the
 * next chain built leaves it out, and it is taken out of the requests still
 * in progress. Switching back on reaches new requests only.
 */
describe('switching a step off', () => {
  const toggle = (stepId: string, isEnabled: boolean, as: Session = s.superAdmin) =>
    api(app).patch(`/api/v1/workflows/steps/${stepId}`).set(auth(as)).send({ isEnabled });

  afterAll(async () => {
    await prisma.client.workflowStep.updateMany({
      where: { workflowDefinitionId: definitionId, isEnabled: false },
      data: { isEnabled: true },
    });
  });

  it('needs workflows:configure', async () => {
    const hr = (await stepsOf(definitionId)).find((x) => x.name === 'HR confirmation')!;
    expect((await toggle(hr.id, false, s.officeAdmin)).status).toBe(403);
    expect((await stepsOf(definitionId)).find((x) => x.id === hr.id)?.isEnabled).toBe(true);
  });

  it('a new request skips the step, a queued copy is removed, and switching on reaches new requests only', async () => {
    const older = await raiseCheapRequest();
    expect((await chainOf(older)).map((a) => a.stepName)).toContain('HR confirmation');
    const foreignBefore = await foreignWaitingRows('HR confirmation');

    const hr = (await stepsOf(definitionId)).find((x) => x.name === 'HR confirmation')!;
    expect(hr.canDisable).toBe(true);
    const off = await toggle(hr.id, false);
    expect(off.status, JSON.stringify(off.body)).toBeLessThan(300);
    const view = (await stepsOf(definitionId)).find((x) => x.id === hr.id)!;
    expect(view.isEnabled).toBe(false);
    expect(view.canDisable).toBe(false);

    const newer = await raiseCheapRequest();
    expect((await chainOf(newer)).map((a) => a.stepName)).not.toContain('HR confirmation');
    // The queued copy on the older request is gone; it is still with Manager
    // and the chain after it is intact.
    expect((await chainOf(older)).map((a) => a.stepName)).not.toContain('HR confirmation');
    expect(await currentStepOf(older)).toBe('Manager review');
    await api(app).post(`/api/v1/requests/${older}/decision`).set(auth(s.manager)).send({ decision: 'APPROVED' });
    expect(await currentStepOf(older)).toBe('IT review');
    expect(await foreignWaitingRows('HR confirmation')).toBe(foreignBefore);

    const trail = await prisma.client.auditLog.findFirst({
      where: { entityType: 'WorkflowStep', entityId: hr.id },
      orderBy: { createdAt: 'desc' },
    });
    expect((trail!.previousValues as { isEnabled: boolean }).isEnabled).toBe(true);
    const newValues = trail!.newValues as { isEnabled: boolean; inFlightRemoved: number };
    expect(newValues.isEnabled).toBe(false);
    expect(newValues.inFlightRemoved).toBeGreaterThanOrEqual(1);

    // Back on: the next request has it; the older one is not rewritten.
    expect((await toggle(hr.id, true)).status).toBeLessThan(300);
    expect((await chainOf(await raiseCheapRequest())).map((a) => a.stepName)).toContain('HR confirmation');
    expect((await chainOf(older)).map((a) => a.stepName)).not.toContain('HR confirmation');
  });

  it('a request currently waiting on the step is skipped past it and its next approvers told', async () => {
    const id = await raiseCheapRequest();
    await api(app).post(`/api/v1/requests/${id}/decision`).set(auth(s.manager)).send({ decision: 'APPROVED' });
    expect(await currentStepOf(id)).toBe('HR confirmation');
    const noticesBefore = await prisma.client.notification.count({
      where: { entityId: id, type: 'APPROVAL_REQUIRED', userId: s.itAdmin.user.id },
    });

    const hr = (await stepsOf(definitionId)).find((x) => x.name === 'HR confirmation')!;
    expect((await toggle(hr.id, false)).status).toBeLessThan(300);

    const chain = await chainOf(id);
    const skipped = chain.find((a) => a.stepName === 'HR confirmation')!;
    expect(skipped.decision).toBe('SKIPPED');
    expect(skipped.comment).toBe('Step switched off in workflow settings');
    expect(chain.find((a) => a.stepName === 'Manager review')?.decision).toBe('APPROVED');
    expect(await currentStepOf(id)).toBe('IT review');
    expect(await statusOf(id)).toBe('IT_REVIEW_PENDING');
    expect(
      await prisma.client.notification.count({
        where: { entityId: id, type: 'APPROVAL_REQUIRED', userId: s.itAdmin.user.id },
      }),
    ).toBeGreaterThan(noticesBefore);

    const trail = await prisma.client.auditLog.findFirst({
      where: { entityType: 'WorkflowStep', entityId: hr.id },
      orderBy: { createdAt: 'desc' },
    });
    expect((trail!.newValues as { inFlightSkipped: number }).inFlightSkipped).toBeGreaterThanOrEqual(1);

    await toggle(hr.id, true);
  });

  it('a request whose last live step is switched off settles', async () => {
    // Cheap request: Finance (250) will be skipped on cost, so once Manager
    // and HR are done, IT is the last step anybody has to decide.
    const id = await raiseCheapRequest();
    for (const who of ['manager', 'hr'] as AccountKey[]) {
      await api(app).post(`/api/v1/requests/${id}/decision`).set(auth(s[who])).send({ decision: 'APPROVED' });
    }
    expect(await currentStepOf(id)).toBe('IT review');

    const it = (await stepsOf(definitionId)).find((x) => x.name === 'IT review')!;
    expect((await toggle(it.id, false)).status).toBeLessThan(300);

    expect(await currentStepOf(id)).toBeNull();
    expect(await statusOf(id)).toBe('APPROVED');
    const chain = await chainOf(id);
    expect(chain.find((a) => a.stepName === 'IT review')?.decision).toBe('SKIPPED');
    expect(chain.find((a) => a.stepName === 'Finance approval')?.decision).toBe('SKIPPED');

    await toggle(it.id, true);
  });

  it('refuses to switch off, or remove, the last step still on', async () => {
    const steps = (await stepsOf(definitionId)).filter((x) => x.kind === 'APPROVAL');
    const [keep, ...others] = steps;
    for (const step of others) expect((await toggle(step.id, false)).status).toBeLessThan(300);

    const last = (await stepsOf(definitionId)).find((x) => x.id === keep!.id)!;
    expect(last.canDisable).toBe(false);
    expect(last.canRemove).toBe(false);
    const refusedOff = await toggle(keep!.id, false);
    expect(refusedOff.status).toBe(422);
    expect(JSON.stringify(refusedOff.body)).toContain('only step still switched on');
    const refusedRemove = await api(app)
      .delete(`/api/v1/workflows/steps/${keep!.id}`)
      .set(auth(s.superAdmin));
    expect(refusedRemove.status).toBe(422);
    expect(JSON.stringify(refusedRemove.body)).toContain('only step still switched on');

    // A step already off can still be removed - the chain loses nothing on.
    const offStep = (await stepsOf(definitionId)).find((x) => x.id === others[0]!.id)!;
    expect(offStep.canRemove).toBe(true);

    for (const step of others) expect((await toggle(step.id, true)).status).toBeLessThan(300);
  });

  it('the assessment stages are not switchable', async () => {
    await api(app)
      .patch(`/api/v1/workflows/${definitionId}/assessment-stages`)
      .set(auth(s.superAdmin))
      .send({ enabled: true });
    try {
      const stage = (await stepsOf(definitionId)).find((x) => x.kind === 'INVENTORY_CHECK')!;
      expect(stage.canDisable).toBe(false);
      expect((await toggle(stage.id, false)).status).toBe(422);
    } finally {
      await api(app)
        .patch(`/api/v1/workflows/${definitionId}/assessment-stages`)
        .set(auth(s.superAdmin))
        .send({ enabled: false });
    }
  });
});
