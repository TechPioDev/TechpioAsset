/**
 * List arithmetic behind the workflow page's Move up / Move down buttons
 * (v2.28). Only the approval steps are ordered by hand; the assessment
 * stages are placed by the API's rule, so they are left out of the list the
 * server is sent and out of the neighbour calculation here - moving a step
 * "up" past the pair means moving it past the approval step above the pair.
 */

export interface OrderableStepView {
  id: string;
  kind: 'APPROVAL' | 'INVENTORY_CHECK' | 'COST_ASSESSMENT';
}

/** The approval step ids in their current order - what PUT …/steps/order takes. */
export function approvalOrder(steps: readonly OrderableStepView[]): string[] {
  return steps.filter((step) => step.kind === 'APPROVAL').map((step) => step.id);
}

/**
 * The approval order after moving one step a place up or down, or null when
 * it is already at that end (the button should then be disabled).
 */
export function movedOrder(
  steps: readonly OrderableStepView[],
  stepId: string,
  direction: 'up' | 'down',
): string[] | null {
  const ids = approvalOrder(steps);
  const from = ids.indexOf(stepId);
  if (from === -1) return null;
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length) return null;
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  return ids;
}

/** Whether a step can move in a direction - drives the disabled state. */
export function canMove(
  steps: readonly OrderableStepView[],
  stepId: string,
  direction: 'up' | 'down',
): boolean {
  return movedOrder(steps, stepId, direction) !== null;
}
