import { describe, expect, it } from 'vitest';
import { rememberDestination, takeDestination } from './pending-route';

describe('where a shortcut was going, kept across the unlock', () => {
  it('hands the destination over once, then forgets it', () => {
    rememberDestination('/scan');
    expect(takeDestination()).toBe('/scan');
    expect(takeDestination()).toBeNull();
  });

  it('never remembers the sign-in screens themselves', () => {
    for (const p of ['/', '/login', '/forgot-password', '', null, undefined, 'scan'])
      rememberDestination(p);
    expect(takeDestination()).toBeNull();
  });

  it('keeps the latest destination', () => {
    rememberDestination('/scan');
    rememberDestination('/my-equipment');
    expect(takeDestination()).toBe('/my-equipment');
  });
});
