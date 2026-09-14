import { describe, it, expect } from 'vitest';
import { canTransition, isTerminal } from './state-machine';
import {
  MAINTENANCE_ACTIVE_STATUSES,
  MAINTENANCE_OPEN_STATUSES,
  MAINTENANCE_STATUSES,
  maintenanceStatusLabel,
  maintenanceStatusMachine,
} from './maintenance-status';

describe('maintenance status machine', () => {
  it('declares all eight statuses (spec section 14 + v2.5 ON_HOLD + sign-off)', () => {
    expect(MAINTENANCE_STATUSES).toHaveLength(8);
  });

  it('holds and resumes only from in-progress (v2.5 work orders)', () => {
    expect(canTransition(maintenanceStatusMachine, 'IN_PROGRESS', 'ON_HOLD')).toBe(true);
    expect(canTransition(maintenanceStatusMachine, 'ON_HOLD', 'IN_PROGRESS')).toBe(true);
    expect(canTransition(maintenanceStatusMachine, 'ON_HOLD', 'CANCELLED')).toBe(true);
    // Held work cannot complete unseen, and unstarted work cannot be held.
    expect(canTransition(maintenanceStatusMachine, 'ON_HOLD', 'COMPLETED')).toBe(false);
    expect(canTransition(maintenanceStatusMachine, 'SCHEDULED', 'ON_HOLD')).toBe(false);
    expect(canTransition(maintenanceStatusMachine, 'REQUESTED', 'ON_HOLD')).toBe(false);
  });

  it('walks the standard schedule → start → complete → approve path', () => {
    expect(canTransition(maintenanceStatusMachine, 'REQUESTED', 'SCHEDULED')).toBe(true);
    expect(canTransition(maintenanceStatusMachine, 'SCHEDULED', 'IN_PROGRESS')).toBe(true);
    expect(canTransition(maintenanceStatusMachine, 'IN_PROGRESS', 'AWAITING_APPROVAL')).toBe(true);
    expect(canTransition(maintenanceStatusMachine, 'AWAITING_APPROVAL', 'COMPLETED')).toBe(true);
  });

  it('never closes work without sign-off', () => {
    expect(canTransition(maintenanceStatusMachine, 'IN_PROGRESS', 'COMPLETED')).toBe(false);
    expect(canTransition(maintenanceStatusMachine, 'ON_HOLD', 'AWAITING_APPROVAL')).toBe(false);
  });

  it('sends back to work or cancels from awaiting approval, and it is not terminal', () => {
    expect(canTransition(maintenanceStatusMachine, 'AWAITING_APPROVAL', 'IN_PROGRESS')).toBe(true);
    expect(canTransition(maintenanceStatusMachine, 'AWAITING_APPROVAL', 'CANCELLED')).toBe(true);
    expect(canTransition(maintenanceStatusMachine, 'AWAITING_APPROVAL', 'ON_HOLD')).toBe(false);
    expect(isTerminal(maintenanceStatusMachine, 'AWAITING_APPROVAL')).toBe(false);
  });

  it('labels COMPLETED as Closed and counts awaiting approval as open but not SLA-active', () => {
    expect(maintenanceStatusLabel('COMPLETED')).toBe('Closed');
    expect(maintenanceStatusLabel('AWAITING_APPROVAL')).toBe('Awaiting approval');
    expect(MAINTENANCE_OPEN_STATUSES).toContain('AWAITING_APPROVAL');
    expect(MAINTENANCE_OPEN_STATUSES).toContain('ON_HOLD');
    expect(MAINTENANCE_ACTIVE_STATUSES).not.toContain('AWAITING_APPROVAL');
  });

  it('allows a repair to fail from in-progress', () => {
    expect(canTransition(maintenanceStatusMachine, 'IN_PROGRESS', 'FAILED')).toBe(true);
  });

  it('cannot reopen a completed or cancelled record', () => {
    for (const status of MAINTENANCE_STATUSES) {
      expect(canTransition(maintenanceStatusMachine, 'COMPLETED', status)).toBe(
        status === 'COMPLETED',
      );
      expect(canTransition(maintenanceStatusMachine, 'CANCELLED', status)).toBe(
        status === 'CANCELLED',
      );
    }
  });

  it('cannot jump straight from requested to completed', () => {
    expect(canTransition(maintenanceStatusMachine, 'REQUESTED', 'COMPLETED')).toBe(false);
  });

  it('marks the terminal states', () => {
    expect(isTerminal(maintenanceStatusMachine, 'COMPLETED')).toBe(true);
    expect(isTerminal(maintenanceStatusMachine, 'FAILED')).toBe(true);
    expect(isTerminal(maintenanceStatusMachine, 'IN_PROGRESS')).toBe(false);
  });
});
