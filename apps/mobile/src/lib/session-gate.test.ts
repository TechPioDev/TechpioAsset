import { describe, expect, it } from 'vitest';
import { gateRedirect } from './session-gate';

describe('the biometric lock holds on every screen', () => {
  it('sends a locked session opened on a record to the unlock prompt', () => {
    expect(gateRedirect('locked', ['request', '[id]'])).toBe('/login');
    expect(gateRedirect('locked', ['asset', '[id]'])).toBe('/login');
    expect(gateRedirect('locked', ['(tabs)'])).toBe('/login');
  });

  it('sends a signed-out session to sign in the same way', () => {
    expect(gateRedirect('anonymous', ['settings', 'security'])).toBe('/login');
  });

  it('leaves the screens that get you in alone', () => {
    for (const s of [[], ['index'], ['login'], ['forgot-password']]) {
      expect(gateRedirect('locked', s)).toBeNull();
      expect(gateRedirect('anonymous', s)).toBeNull();
    }
  });

  it('lets an unlocked session through, and waits while the session is still loading', () => {
    expect(gateRedirect('authenticated', ['request', '[id]'])).toBeNull();
    expect(gateRedirect('loading', ['request', '[id]'])).toBeNull();
  });
});
