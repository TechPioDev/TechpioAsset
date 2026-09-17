/**
 * Ordering rules for editing an approval chain (v2.28).
 *
 * The approval steps are ordered by the administrator. The two assessment
 * stages are not: they go, as a pair and in a fixed order, immediately before
 * the first step that carries a cost threshold, because the figure they
 * produce is what that threshold is measured against. With no thresholded
 * step they go last, where the work still has to happen before the request
 * is fulfilled.
 *
 * Kept pure so the same rule places the pair when it is first added and again
 * after every add, remove or reorder, rather than being re-derived in each.
 */

export type WorkflowStepKind = 'APPROVAL' | 'INVENTORY_CHECK' | 'COST_ASSESSMENT';

/** Only presence matters here, so a Decimal from the database passes as-is. */
type Threshold = string | number | { toString(): string } | null | undefined;

export interface OrderableStep {
  id: string;
  kind: WorkflowStepKind;
  costThreshold?: Threshold;
}

/** Index in `approvalSteps` before which the assessment pair belongs. */
export function assessmentInsertIndex(
  approvalSteps: readonly { costThreshold?: Threshold }[],
): number {
  const first = approvalSteps.findIndex(
    (step) => step.costThreshold !== null && step.costThreshold !== undefined,
  );
  return first === -1 ? approvalSteps.length : first;
}

/**
 * The full chain: the approval steps in the order given, with the assessment
 * stages (inventory check first, then cost assessment) slotted in where the
 * rule puts them. Stages appear in the output only if they were passed in.
 */
export function orderWorkflowSteps<T extends OrderableStep>(
  approvalSteps: readonly T[],
  stages: readonly T[],
): T[] {
  const rank: Record<WorkflowStepKind, number> = {
    INVENTORY_CHECK: 0,
    COST_ASSESSMENT: 1,
    APPROVAL: 2,
  };
  const pair = [...stages]
    .filter((step) => step.kind !== 'APPROVAL')
    .sort((a, b) => rank[a.kind] - rank[b.kind]);
  const at = assessmentInsertIndex(approvalSteps);
  return [...approvalSteps.slice(0, at), ...pair, ...approvalSteps.slice(at)];
}

/**
 * Whether `stepIds` is exactly the set of approval steps, each named once. A
 * reorder that drops or duplicates a step would silently change what the
 * process is, so it is refused rather than repaired.
 */
export function isCompleteReorder(
  stepIds: readonly string[],
  approvalSteps: readonly { id: string }[],
): boolean {
  if (stepIds.length !== approvalSteps.length) return false;
  const wanted = new Set(approvalSteps.map((step) => step.id));
  const seen = new Set<string>();
  for (const id of stepIds) {
    if (!wanted.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}
