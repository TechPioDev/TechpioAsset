import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@techpioasset/domain';
import { offboardActionLabel, offboardGates, offboardedMessage, openOffboardingFor } from './offboarding';

const me = (...permissions: string[]) => ({ id: 'me', permissions });
const person = { id: 'u1', status: 'ACTIVE' };

describe('offboardGates', () => {
  it('offers Offboard to offboarding:manage, never on yourself or a closed account', () => {
    const hr = me(PERMISSIONS.OFFBOARDING_MANAGE);
    expect(offboardGates(hr, person).canOffboard).toBe(true);
    expect(offboardGates(hr, { id: 'me', status: 'ACTIVE' }).canOffboard).toBe(false);
    expect(offboardGates(hr, { id: 'u1', status: 'DEACTIVATED' }).canOffboard).toBe(false);
    expect(offboardGates(me(), person).canOffboard).toBe(false);
    expect(offboardGates(null, person).canOffboard).toBe(false);
    expect(offboardGates(hr, null).canOffboard).toBe(false);
  });

  it('gates the row actions like the asset page custody card', () => {
    const it_ = me(PERMISSIONS.ASSETS_ASSIGN, PERMISSIONS.ASSETS_RETURN);
    expect(offboardGates(it_, person)).toMatchObject({ canReturn: true, canHandOver: true });
    // Return alone cannot hand over: reassign closes one custody and opens another.
    expect(offboardGates(me(PERMISSIONS.ASSETS_RETURN), person)).toMatchObject({
      canReturn: true,
      canHandOver: false,
    });
    // HR starts and finishes but records nothing.
    expect(offboardGates(me(PERMISSIONS.OFFBOARDING_MANAGE), person)).toMatchObject({
      canReturn: false,
      canHandOver: false,
    });
  });

  it('shows the in-progress badge to whoever may read employees', () => {
    expect(offboardGates(me(PERMISSIONS.EMPLOYEES_READ), person).canSeeProgress).toBe(true);
    expect(offboardGates(me(), person).canSeeProgress).toBe(false);
  });
});

describe('openOffboardingFor', () => {
  const tasks = [
    { id: 't1', subjectUserId: 'u1', direction: 'OFFBOARDING', status: 'COMPLETED' },
    { id: 't2', subjectUserId: 'u1', direction: 'ONBOARDING', status: 'OPEN' },
    { id: 't3', subjectUserId: 'u1', direction: 'OFFBOARDING', status: 'OPEN' },
  ];

  it('finds only the open offboarding task for that person', () => {
    expect(openOffboardingFor(tasks, 'u1')?.id).toBe('t3');
    expect(openOffboardingFor(tasks, 'u2')).toBeNull();
    expect(openOffboardingFor(null, 'u1')).toBeNull();
  });
});

describe('copy', () => {
  it('says continue once a task is under way', () => {
    expect(offboardActionLabel(false)).toBe('Offboard');
    expect(offboardActionLabel(true)).toBe('Continue offboarding');
  });

  it('names the exception in the success line', () => {
    expect(offboardedMessage('Priya', false)).toBe('Priya offboarded. Their account is deactivated.');
    expect(offboardedMessage('Priya', true)).toMatch(/stays recorded against them/);
  });
});
