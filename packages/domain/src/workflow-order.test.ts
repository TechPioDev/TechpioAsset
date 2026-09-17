import { describe, expect, it } from 'vitest';
import {
  assessmentInsertIndex,
  isCompleteReorder,
  orderWorkflowSteps,
  type OrderableStep,
} from './workflow-order';

const approval = (id: string, costThreshold: string | null = null): OrderableStep => ({
  id,
  kind: 'APPROVAL',
  costThreshold,
});
const inventory: OrderableStep = { id: 'inv', kind: 'INVENTORY_CHECK' };
const cost: OrderableStep = { id: 'cost', kind: 'COST_ASSESSMENT' };

describe('assessmentInsertIndex', () => {
  it('points at the first thresholded step', () => {
    expect(
      assessmentInsertIndex([approval('a'), approval('b', '250'), approval('c', '1000')]),
    ).toBe(1);
  });

  it('points past the end when nothing is thresholded', () => {
    expect(assessmentInsertIndex([approval('a'), approval('b')])).toBe(2);
    expect(assessmentInsertIndex([])).toBe(0);
  });
});

describe('orderWorkflowSteps', () => {
  it('slots the pair, inventory first, before the first thresholded step', () => {
    const ordered = orderWorkflowSteps(
      [approval('mgr'), approval('hr'), approval('fin', '250')],
      [cost, inventory],
    );
    expect(ordered.map((s) => s.id)).toEqual(['mgr', 'hr', 'inv', 'cost', 'fin']);
  });

  it('moves the pair when the thresholded step is reordered', () => {
    const ordered = orderWorkflowSteps(
      [approval('fin', '250'), approval('mgr'), approval('hr')],
      [inventory, cost],
    );
    expect(ordered.map((s) => s.id)).toEqual(['inv', 'cost', 'fin', 'mgr', 'hr']);
  });

  it('puts the pair last when no step has a threshold', () => {
    const ordered = orderWorkflowSteps([approval('mgr'), approval('hr')], [inventory, cost]);
    expect(ordered.map((s) => s.id)).toEqual(['mgr', 'hr', 'inv', 'cost']);
  });

  it('is the approval order alone when the workflow has no stages', () => {
    const ordered = orderWorkflowSteps([approval('a', '10'), approval('b')], []);
    expect(ordered.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('ignores approval steps passed in the stage list', () => {
    const ordered = orderWorkflowSteps([approval('a')], [approval('stray'), inventory]);
    expect(ordered.map((s) => s.id)).toEqual(['a', 'inv']);
  });
});

describe('isCompleteReorder', () => {
  const steps = [approval('a'), approval('b'), approval('c')];

  it('accepts every step exactly once, in any order', () => {
    expect(isCompleteReorder(['c', 'a', 'b'], steps)).toBe(true);
  });

  it('refuses a missing, duplicated or unknown step', () => {
    expect(isCompleteReorder(['a', 'b'], steps)).toBe(false);
    expect(isCompleteReorder(['a', 'a', 'b'], steps)).toBe(false);
    expect(isCompleteReorder(['a', 'b', 'zzz'], steps)).toBe(false);
  });
});
