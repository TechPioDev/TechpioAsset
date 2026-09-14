import type { StateMachine } from './state-machine';

/** Maintenance record lifecycle (spec section 14 + v2.5 work orders). */
export const MAINTENANCE_STATUSES = [
  'REQUESTED',
  'SCHEDULED',
  'IN_PROGRESS',
  'ON_HOLD',
  // Work-order sign-off: the technician has finished, a manager has not yet
  // signed it off. Not terminal - it closes (COMPLETED) or goes back to work.
  'AWAITING_APPROVAL',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
] as const;

export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const maintenanceStatusMachine: StateMachine<MaintenanceStatus> = {
  name: 'MaintenanceStatus',
  initial: 'REQUESTED',
  terminal: ['COMPLETED', 'CANCELLED', 'FAILED'],
  transitions: {
    REQUESTED: ['SCHEDULED', 'IN_PROGRESS', 'CANCELLED'],
    // A scheduled job can start, be rescheduled (self, handled by canTransition),
    // or be cancelled before it begins.
    SCHEDULED: ['IN_PROGRESS', 'CANCELLED'],
    // v2.5: a technician can pause work (waiting on a part, on the user, on a
    // vendor). Held work resumes or is abandoned - it cannot complete unseen.
    // Finishing goes for sign-off; nothing reaches COMPLETED without a manager.
    IN_PROGRESS: ['ON_HOLD', 'AWAITING_APPROVAL', 'FAILED', 'CANCELLED'],
    ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
    // Approved closes it; sent back reopens the work; or it is called off.
    AWAITING_APPROVAL: ['COMPLETED', 'IN_PROGRESS', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
    FAILED: [],
  },
};

/**
 * Statuses in which the technician's work is live - the SLA clock runs and an
 * overdue order escalates. AWAITING_APPROVAL is deliberately absent: the
 * technician has delivered, and the wait is now on the approver, so an overdue
 * technician SLA must not fire against it.
 */
export const MAINTENANCE_ACTIVE_STATUSES: readonly MaintenanceStatus[] = [
  'SCHEDULED',
  'IN_PROGRESS',
  'ON_HOLD',
];

/**
 * Every status that is still open work - what "Open maintenance" counts. An
 * order awaiting sign-off is open: it is not closed until a manager approves.
 */
export const MAINTENANCE_OPEN_STATUSES: readonly MaintenanceStatus[] = [
  'REQUESTED',
  'SCHEDULED',
  'IN_PROGRESS',
  'ON_HOLD',
  'AWAITING_APPROVAL',
];

const LABELS: Record<MaintenanceStatus, string> = {
  REQUESTED: 'Requested',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  ON_HOLD: 'On hold',
  AWAITING_APPROVAL: 'Awaiting approval',
  // COMPLETED keeps its stored name (reports and figures key on it) but reads
  // as what it now means: signed off and closed.
  COMPLETED: 'Closed',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
};

/** Human label for a maintenance status; unknown values fall back readably. */
export function maintenanceStatusLabel(status: string): string {
  return LABELS[status as MaintenanceStatus] ?? status.replace(/_/g, ' ').toLowerCase();
}
