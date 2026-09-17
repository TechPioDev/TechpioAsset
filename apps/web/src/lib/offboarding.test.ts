import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@techpioasset/domain';
import {
  canOffboard,
  offboardButtonLabel,
  offboardingRowActions,
  openOffboardingFor,
} from './offboarding';

const withPerms = (...perms: string[]) => (p: string) => perms.includes(p);

describe('canOffboard', () => {
  const hr = withPerms(PERMISSIONS.OFFBOARDING_MANAGE);

  it('needs offboarding:manage', () => {
    expect(canOffboard({ can: hr, meId: 'me', person: { id: 'u1', status: 'ACTIVE' } })).toBe(true);
    expect(canOffboard({ can: withPerms(), meId: 'me', person: { id: 'u1', status: 'ACTIVE' } })).toBe(false);
  });

  it('is never offered on yourself or on a closed account', () => {
    expect(canOffboard({ can: hr, meId: 'u1', person: { id: 'u1', status: 'ACTIVE' } })).toBe(false);
    expect(canOffboard({ can: hr, meId: 'me', person: { id: 'u1', status: 'DEACTIVATED' } })).toBe(false);
    // Invited or suspended people can still be offboarded - they may hold equipment.
    expect(canOffboard({ can: hr, meId: 'me', person: { id: 'u1', status: 'INVITED' } })).toBe(true);
  });
});

describe('openOffboardingFor', () => {
  const tasks = [
    { id: 't1', subjectUserId: 'u1', direction: 'OFFBOARDING', status: 'COMPLETED' },
    { id: 't2', subjectUserId: 'u1', direction: 'ONBOARDING', status: 'OPEN' },
    { id: 't3', subjectUserId: 'u1', direction: 'OFFBOARDING', status: 'OPEN' },
    { id: 't4', subjectUserId: 'u2', direction: 'OFFBOARDING', status: 'OPEN' },
  ];

  it('finds only the open offboarding task for that person', () => {
    expect(openOffboardingFor(tasks, 'u1')?.id).toBe('t3');
    expect(openOffboardingFor(tasks, 'u2')?.id).toBe('t4');
    expect(openOffboardingFor(tasks, 'u3')).toBeNull();
    expect(openOffboardingFor(undefined, 'u1')).toBeNull();
  });
});

describe('row actions', () => {
  it('follows the custody card: return needs assets:return, hand over needs both', () => {
    expect(offboardingRowActions({ canAssign: true, canReturn: true, status: 'ASSIGNED' })).toEqual({
      handOver: true,
      recordReturn: true,
    });
    expect(offboardingRowActions({ canAssign: false, canReturn: true, status: 'ASSIGNED' })).toEqual({
      handOver: false,
      recordReturn: true,
    });
    // HR holds neither, so the row offers nothing and the panel says who to ask.
    expect(offboardingRowActions({ canAssign: false, canReturn: false, status: 'ASSIGNED' })).toEqual({
      handOver: false,
      recordReturn: false,
    });
  });
});

describe('button label', () => {
  it('says continue once a task is under way', () => {
    expect(offboardButtonLabel(false)).toBe('Offboard…');
    expect(offboardButtonLabel(true)).toBe('Continue offboarding');
  });
});
