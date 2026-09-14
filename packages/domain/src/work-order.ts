import {
  MAINTENANCE_ACTIVE_STATUSES,
  MAINTENANCE_OPEN_STATUSES,
  type MaintenanceStatus,
} from './maintenance-status';

/**
 * v2.5 work-order rules (plan section H3).
 *
 * SLA escalation mirrors the approvals pattern: an overdue, still-active work
 * order escalates EXACTLY ONCE - escalatedAt is both the flag and the record
 * of when. Preventive schedules advance strictly into the future so a sweep
 * that was down for a month spawns one catch-up order, not thirty.
 */

export interface EscalatableWorkOrder {
  status: MaintenanceStatus;
  slaDueAt: Date | null;
  escalatedAt: Date | null;
}

/** True when the sweep should escalate this order now (and only now). */
export function shouldEscalateWorkOrder(order: EscalatableWorkOrder, now: Date): boolean {
  if (order.escalatedAt !== null) return false; // escalate once
  if (order.slaDueAt === null) return false; // no SLA agreed
  if (!MAINTENANCE_ACTIVE_STATUSES.includes(order.status)) return false;
  return order.slaDueAt.getTime() < now.getTime();
}

// ── work-order sign-off ────────────────────────────────────────────────────────
//
// Assign → technician accepts → start → complete (AWAITING_APPROVAL) → a
// different manager approves (COMPLETED) or sends it back (IN_PROGRESS). The
// rules live here so the API refuses and the web/phone buttons hide on exactly
// the same conditions.

export interface SignoffOrder {
  status: string;
  technicianId: string | null;
  acceptedById: string | null;
  completedById: string | null;
}

export type SignoffAction = 'accept' | 'start' | 'resume' | 'approve' | 'sendBack';

export interface SignoffRefusal {
  kind: 'forbidden' | 'conflict';
  message: string;
}

/** Statuses from which the assigned technician may accept the job. */
const ACCEPTABLE: readonly string[] = ['REQUESTED', 'SCHEDULED', 'IN_PROGRESS', 'ON_HOLD'];

/**
 * True when a technician is on the job but has not accepted it. Acceptance is
 * tied to the person: a reassignment clears it, and an acceptance recorded by
 * someone other than the current technician does not count.
 */
export function awaitingAcceptance(order: SignoffOrder): boolean {
  return order.technicianId !== null && order.acceptedById !== order.technicianId;
}

/**
 * Why `actorId` may not take a sign-off action on this order, or null when the
 * rule allows it. Plain status-machine legality is checked separately.
 */
export function signoffRefusal(
  action: SignoffAction,
  order: SignoffOrder,
  actorId: string,
): SignoffRefusal | null {
  switch (action) {
    case 'accept':
      if (!ACCEPTABLE.includes(order.status)) {
        return { kind: 'conflict', message: 'This work order can no longer be accepted.' };
      }
      if (order.technicianId === null) {
        return { kind: 'conflict', message: 'Nobody is assigned to this work order yet.' };
      }
      if (order.technicianId !== actorId) {
        return {
          kind: 'forbidden',
          message: 'Only the assigned technician can accept this work order.',
        };
      }
      if (!awaitingAcceptance(order)) {
        return { kind: 'conflict', message: 'You have already accepted this work order.' };
      }
      return null;
    case 'start':
    case 'resume':
      // A job with no technician works as it always has.
      if (awaitingAcceptance(order)) {
        return {
          kind: 'conflict',
          message: 'The assigned technician must accept this work order before work starts.',
        };
      }
      return null;
    case 'approve':
    case 'sendBack':
      if (order.status !== 'AWAITING_APPROVAL') {
        return {
          kind: 'conflict',
          message:
            action === 'approve'
              ? 'Only a work order awaiting approval can be approved.'
              : 'Only a work order awaiting approval can be sent back.',
        };
      }
      // Segregation of duties: whoever did and signed off the work is not the
      // person who confirms it was done.
      if (order.completedById !== null && order.completedById === actorId) {
        return {
          kind: 'forbidden',
          message:
            'You completed this work order, so you cannot sign it off. Ask another maintenance manager to approve or send it back.',
        };
      }
      return null;
  }
}

export interface WorkOrderActions {
  accept: boolean;
  start: boolean;
  hold: boolean;
  resume: boolean;
  complete: boolean;
  approve: boolean;
  sendBack: boolean;
  cancel: boolean;
}

/**
 * Which buttons to offer. Mirrors the API: every write needs maintenance:manage,
 * then the status machine, then the sign-off rules above.
 */
export function workOrderActions(
  order: SignoffOrder,
  actor: { id: string; canManage: boolean },
): WorkOrderActions {
  const none: WorkOrderActions = {
    accept: false,
    start: false,
    hold: false,
    resume: false,
    complete: false,
    approve: false,
    sendBack: false,
    cancel: false,
  };
  if (!actor.canManage) return none;
  const ok = (action: SignoffAction) => signoffRefusal(action, order, actor.id) === null;
  const s = order.status;
  return {
    accept: ok('accept'),
    start: (s === 'REQUESTED' || s === 'SCHEDULED') && ok('start'),
    hold: s === 'IN_PROGRESS',
    resume: s === 'ON_HOLD' && ok('resume'),
    complete: s === 'IN_PROGRESS',
    approve: ok('approve'),
    sendBack: ok('sendBack'),
    cancel: MAINTENANCE_OPEN_STATUSES.includes(s as MaintenanceStatus),
  };
}

/**
 * The next due date after a spawn: advances by whole intervals until strictly
 * in the future. A schedule the sweep missed for weeks catches up with ONE
 * spawned order and a future due date, never a backlog of stale orders.
 */
export function advanceSchedule(nextDueAt: Date, intervalDays: number, now: Date): Date {
  if (intervalDays < 1 || !Number.isInteger(intervalDays)) {
    throw new Error(`intervalDays must be a positive integer, got ${intervalDays}`);
  }
  const interval = intervalDays * 86_400_000;
  let next = nextDueAt.getTime();
  while (next <= now.getTime()) next += interval;
  return new Date(next);
}
