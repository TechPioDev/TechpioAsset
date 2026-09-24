import { describe, expect, it } from 'vitest';
import {
  ENTER_OFFSET,
  MOTION,
  STAGGER_MAX_ITEMS,
  STAGGER_STEP,
  durationFor,
  enterOffset,
  staggerDelay,
} from './motion';

/**
 * U4 - the properties that keep motion useful rather than decorative.
 */

describe('durations', () => {
  it('lets a thing leave faster than it arrives', () => {
    // Once you have decided, the app should get out of the way.
    expect(MOTION.exit).toBeLessThan(MOTION.enter);
  });

  it('keeps every step short enough that nobody waits on it', () => {
    for (const [role, ms] of Object.entries(MOTION)) {
      expect(ms, role).toBeLessThanOrEqual(300);
      expect(ms, role).toBeGreaterThan(0);
    }
  });
});

describe('reduce motion', () => {
  it('removes the travel entirely rather than shortening it', () => {
    // People turn this on because movement makes them ill. A faster
    // animation is still an animation.
    for (const role of ['enter', 'exit', 'quick'] as const) {
      expect(durationFor(role, true), role).toBe(0);
    }
    expect(enterOffset(true)).toBe(0);
    expect(staggerDelay(3, true)).toBe(0);
  });

  it('is the only thing that changes when it is off', () => {
    expect(durationFor('enter', false)).toBe(MOTION.enter);
    expect(enterOffset(false)).toBe(ENTER_OFFSET);
  });
});

describe('staggering a list', () => {
  it('steps the first few items', () => {
    expect(staggerDelay(0, false)).toBe(0);
    expect(staggerDelay(1, false)).toBe(STAGGER_STEP);
    expect(staggerDelay(3, false)).toBe(3 * STAGGER_STEP);
  });

  it('stops stepping, so a long list is not a queue', () => {
    // On two hundred assets an uncapped stagger would be minutes of waiting.
    const cap = STAGGER_MAX_ITEMS * STAGGER_STEP;
    expect(staggerDelay(STAGGER_MAX_ITEMS, false)).toBe(cap);
    expect(staggerDelay(50, false)).toBe(cap);
    expect(staggerDelay(2000, false)).toBe(cap);
  });

  it('never returns a negative delay', () => {
    expect(staggerDelay(-1, false)).toBe(0);
  });

  it('caps at well under a second, even at the limit', () => {
    expect(staggerDelay(Number.MAX_SAFE_INTEGER, false)).toBeLessThan(400);
  });
});
