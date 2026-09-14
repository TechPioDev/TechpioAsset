import { describe, expect, it } from 'vitest';
import {
  advanceSchedule,
  awaitingAcceptance,
  shouldEscalateWorkOrder,
  signoffRefusal,
  workOrderActions,
} from './work-order';

const now = new Date('2026-08-02T12:00:00Z');
const past = new Date('2026-08-01T12:00:00Z');
const future = new Date('2026-08-03T12:00:00Z');

describe('shouldEscalateWorkOrder', () => {
  it('escalates an overdue active order', () => {
    for (const status of ['SCHEDULED', 'IN_PROGRESS', 'ON_HOLD'] as const) {
      expect(shouldEscalateWorkOrder({ status, slaDueAt: past, escalatedAt: null }, now)).toBe(true);
    }
  });

  it('escalates exactly once - a prior escalation blocks forever', () => {
    expect(
      shouldEscalateWorkOrder({ status: 'IN_PROGRESS', slaDueAt: past, escalatedAt: past }, now),
    ).toBe(false);
  });

  it('never escalates without an SLA, before the SLA, or after the work ended', () => {
    expect(
      shouldEscalateWorkOrder({ status: 'IN_PROGRESS', slaDueAt: null, escalatedAt: null }, now),
    ).toBe(false);
    expect(
      shouldEscalateWorkOrder({ status: 'IN_PROGRESS', slaDueAt: future, escalatedAt: null }, now),
    ).toBe(false);
    for (const status of ['COMPLETED', 'CANCELLED', 'FAILED', 'REQUESTED'] as const) {
      expect(shouldEscalateWorkOrder({ status, slaDueAt: past, escalatedAt: null }, now)).toBe(
        false,
      );
    }
  });
});

describe('SLA and sign-off', () => {
  it('never escalates an order awaiting approval - the wait is on the approver', () => {
    expect(
      shouldEscalateWorkOrder({ status: 'AWAITING_APPROVAL', slaDueAt: past, escalatedAt: null }, now),
    ).toBe(false);
  });
});

describe('work-order sign-off rules', () => {
  const tech = 'u-tech';
  const boss = 'u-boss';
  const base = { technicianId: tech, acceptedById: null, completedById: null };

  it('only the assigned technician accepts, once', () => {
    const order = { ...base, status: 'REQUESTED' };
    expect(awaitingAcceptance(order)).toBe(true);
    expect(signoffRefusal('accept', order, tech)).toBeNull();
    expect(signoffRefusal('accept', order, boss)?.kind).toBe('forbidden');
    expect(signoffRefusal('accept', { ...order, acceptedById: tech }, tech)?.kind).toBe('conflict');
    expect(signoffRefusal('accept', { ...order, technicianId: null }, tech)?.kind).toBe('conflict');
    expect(signoffRefusal('accept', { ...order, status: 'AWAITING_APPROVAL' }, tech)?.kind).toBe(
      'conflict',
    );
  });

  it('an acceptance by a previous technician does not count', () => {
    expect(awaitingAcceptance({ ...base, status: 'SCHEDULED', acceptedById: 'u-old' })).toBe(true);
  });

  it('start and resume wait for acceptance only when someone is assigned', () => {
    expect(signoffRefusal('start', { ...base, status: 'REQUESTED' }, boss)?.kind).toBe('conflict');
    expect(signoffRefusal('start', { ...base, status: 'REQUESTED', acceptedById: tech }, boss)).toBeNull();
    expect(signoffRefusal('start', { ...base, technicianId: null, status: 'REQUESTED' }, boss)).toBeNull();
    expect(signoffRefusal('resume', { ...base, status: 'ON_HOLD' }, boss)?.kind).toBe('conflict');
  });

  it('the completer cannot approve or send back; another manager can', () => {
    const order = { ...base, status: 'AWAITING_APPROVAL', acceptedById: tech, completedById: tech };
    expect(signoffRefusal('approve', order, tech)?.kind).toBe('forbidden');
    expect(signoffRefusal('sendBack', order, tech)?.kind).toBe('forbidden');
    expect(signoffRefusal('approve', order, boss)).toBeNull();
    expect(signoffRefusal('sendBack', order, boss)).toBeNull();
    expect(signoffRefusal('approve', { ...order, status: 'IN_PROGRESS' }, boss)?.kind).toBe('conflict');
  });

  it('offers buttons exactly where the rules allow, and none without manage', () => {
    const awaiting = { ...base, status: 'AWAITING_APPROVAL', acceptedById: tech, completedById: tech };
    expect(workOrderActions(awaiting, { id: boss, canManage: true })).toMatchObject({
      approve: true,
      sendBack: true,
      cancel: true,
      complete: false,
      accept: false,
    });
    expect(workOrderActions(awaiting, { id: tech, canManage: true }).approve).toBe(false);
    const fresh = { ...base, status: 'SCHEDULED' };
    expect(workOrderActions(fresh, { id: tech, canManage: true })).toMatchObject({
      accept: true,
      start: false,
    });
    expect(Object.values(workOrderActions(fresh, { id: tech, canManage: false })).some(Boolean)).toBe(
      false,
    );
    expect(workOrderActions({ ...fresh, status: 'COMPLETED' }, { id: boss, canManage: true }).cancel).toBe(
      false,
    );
  });
});

describe('advanceSchedule', () => {
  it('advances one interval when the due date just passed', () => {
    const next = advanceSchedule(new Date('2026-08-02T00:00:00Z'), 7, now);
    expect(next.toISOString()).toBe('2026-08-09T00:00:00.000Z');
  });

  it('catches up over a long outage with ONE future date, not a backlog', () => {
    // Due 2026-01-01, weekly, sweep returns 2026-08-02: lands on the first
    // strictly-future weekly slot.
    const next = advanceSchedule(new Date('2026-01-01T00:00:00Z'), 7, now);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(7 * 86_400_000);
    // Still on the original weekly grid.
    expect((next.getTime() - Date.parse('2026-01-01T00:00:00Z')) % (7 * 86_400_000)).toBe(0);
  });

  it('a future due date is left alone', () => {
    const next = advanceSchedule(future, 30, now);
    expect(next.toISOString()).toBe(future.toISOString());
  });

  it('rejects nonsensical intervals', () => {
    expect(() => advanceSchedule(now, 0, now)).toThrow();
    expect(() => advanceSchedule(now, 1.5, now)).toThrow();
  });
});
