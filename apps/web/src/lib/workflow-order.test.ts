import { describe, expect, it } from 'vitest';
import { approvalOrder, canMove, movedOrder, type OrderableStepView } from './workflow-order';

const steps: OrderableStepView[] = [
  { id: 'mgr', kind: 'APPROVAL' },
  { id: 'hr', kind: 'APPROVAL' },
  { id: 'inv', kind: 'INVENTORY_CHECK' },
  { id: 'cost', kind: 'COST_ASSESSMENT' },
  { id: 'fin', kind: 'APPROVAL' },
];

describe('approvalOrder', () => {
  it('lists only the approval steps, in order', () => {
    expect(approvalOrder(steps)).toEqual(['mgr', 'hr', 'fin']);
  });
});

describe('movedOrder', () => {
  it('swaps with the neighbouring approval step, skipping the assessment pair', () => {
    expect(movedOrder(steps, 'fin', 'up')).toEqual(['mgr', 'fin', 'hr']);
    expect(movedOrder(steps, 'hr', 'down')).toEqual(['mgr', 'fin', 'hr']);
    expect(movedOrder(steps, 'hr', 'up')).toEqual(['hr', 'mgr', 'fin']);
  });

  it('is null at either end, and for a step that is not an approval', () => {
    expect(movedOrder(steps, 'mgr', 'up')).toBeNull();
    expect(movedOrder(steps, 'fin', 'down')).toBeNull();
    expect(movedOrder(steps, 'inv', 'down')).toBeNull();
    expect(movedOrder(steps, 'nope', 'up')).toBeNull();
  });

  it('does not mutate the input', () => {
    const copy = steps.map((s) => ({ ...s }));
    movedOrder(steps, 'fin', 'up');
    expect(steps).toEqual(copy);
  });
});

describe('canMove', () => {
  it('mirrors movedOrder', () => {
    expect(canMove(steps, 'mgr', 'up')).toBe(false);
    expect(canMove(steps, 'mgr', 'down')).toBe(true);
    expect(canMove(steps, 'fin', 'down')).toBe(false);
  });
});
