import { describe, expect, it } from 'vitest';
import {
  conditionContradictsStatus,
  reconcileConditionAndStatus,
} from './asset-condition-status';

/**
 * v2.90 — the grade and the status cannot disagree.
 */

describe('reporting an asset damaged', () => {
  it('grades it damaged', () => {
    const out = reconcileConditionAndStatus({
      status: 'IN_USE',
      condition: 'GOOD',
      nextStatus: 'DAMAGED',
    });
    expect(out).toMatchObject({ ok: true, condition: 'DAMAGED' });
  });

  it('does not talk a worse grade up', () => {
    const out = reconcileConditionAndStatus({
      status: 'IN_USE',
      condition: 'UNUSABLE',
      nextStatus: 'DAMAGED',
    });
    expect(out).toEqual({ ok: true });
  });
});

describe('grading an asset broken', () => {
  it('takes it out of service', () => {
    // The direction the owner asked for: change the condition on the edit
    // form and the status follows.
    for (const grade of ['DAMAGED', 'UNUSABLE'] as const) {
      const out = reconcileConditionAndStatus({
        status: 'ASSIGNED',
        condition: 'GOOD',
        nextCondition: grade,
      });
      expect(out, grade).toMatchObject({ ok: true, status: 'DAMAGED' });
    }
  });

  it('leaves alone a status that says more than the grade does', () => {
    // Retired, lost, disposed, already in the shop: the grade does not
    // overrule any of those.
    for (const status of ['RETIRED', 'LOST', 'STOLEN', 'UNDER_REPAIR', 'DISPOSED'] as const) {
      const out = reconcileConditionAndStatus({
        status,
        condition: 'GOOD',
        nextCondition: 'DAMAGED',
      });
      expect(out, status).toEqual({ ok: true });
    }
  });
});

describe('grading a damaged asset serviceable again', () => {
  it('is refused, because "Good" does not name a status', () => {
    const out = reconcileConditionAndStatus({
      status: 'DAMAGED',
      condition: 'DAMAGED',
      nextCondition: 'GOOD',
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toContain('Damaged');
      // The message has to say what to do instead.
      expect(out.reason).toMatch(/status/i);
    }
  });

  it('is allowed when the status is set in the same edit', () => {
    // Saying where it goes is exactly what was missing.
    const out = reconcileConditionAndStatus({
      status: 'DAMAGED',
      condition: 'DAMAGED',
      nextCondition: 'GOOD',
      nextStatus: 'AVAILABLE',
    });
    expect(out).toEqual({ ok: true });
  });
});

describe('an edit that touches neither', () => {
  it('changes nothing', () => {
    expect(reconcileConditionAndStatus({ status: 'IN_USE', condition: 'GOOD' })).toEqual({
      ok: true,
    });
  });

  it('leaves an ordinary regrade alone', () => {
    // Good to Fair on a working asset says nothing about its status.
    expect(
      reconcileConditionAndStatus({ status: 'IN_USE', condition: 'GOOD', nextCondition: 'FAIR' }),
    ).toEqual({ ok: true });
  });
});

describe('spotting a pair that already contradicts itself', () => {
  it('finds the one on the owner"s screen', () => {
    // Damaged status, "Condition: Good" beside it.
    expect(conditionContradictsStatus({ status: 'DAMAGED', condition: 'GOOD' })).toBe(true);
  });

  it('finds the reverse too', () => {
    expect(conditionContradictsStatus({ status: 'ASSIGNED', condition: 'DAMAGED' })).toBe(true);
    expect(conditionContradictsStatus({ status: 'AVAILABLE', condition: 'UNUSABLE' })).toBe(true);
  });

  it('accepts the pairs that make sense', () => {
    const fine = [
      { status: 'DAMAGED', condition: 'DAMAGED' },
      { status: 'IN_USE', condition: 'GOOD' },
      { status: 'UNDER_REPAIR', condition: 'DAMAGED' },
      { status: 'RETIRED', condition: 'END_OF_LIFE' },
      { status: 'AVAILABLE', condition: 'FAIR' },
      { status: 'LOST', condition: 'GOOD' },
    ] as const;
    for (const pair of fine) {
      expect(conditionContradictsStatus(pair), JSON.stringify(pair)).toBe(false);
    }
  });
});
