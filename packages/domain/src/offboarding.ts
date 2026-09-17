import { ASSET_STATUSES_BLOCKING_OFFBOARDING } from './asset-status';

/**
 * The offboarding checklist as the web panel and the phone screen both read it.
 *
 * The server owns the gate (lifecycle.service completeOffboarding re-checks
 * custody on every call); these helpers only decide what the screen says while
 * the person works through it. Kept free of React so both apps test the same
 * arithmetic, and so "3 of 5 returned" can never mean two different things.
 */

/** One asset in the task's snapshot or in its live outstanding list. */
export interface OffboardingAssetRef {
  assetId: string;
  assetTag: string;
  name: string;
  status: string;
}

export interface OffboardingRow extends OffboardingAssetRef {
  /** True once the asset no longer sits in a status that blocks completion. */
  returned: boolean;
}

export interface OffboardingProgress {
  rows: OffboardingRow[];
  /** Everything that was ever on the list - the snapshot plus anything issued since. */
  total: number;
  returned: number;
  /** What still stops completion. Zero means Finish may be pressed. */
  blocking: number;
}

export function isBlockingOffboarding(status: string): boolean {
  return (ASSET_STATUSES_BLOCKING_OFFBOARDING as readonly string[]).includes(status);
}

/**
 * Merges the snapshot taken when offboarding started with what is outstanding
 * now. Anything in the snapshot but not outstanding has come back; anything
 * outstanding but not in the snapshot was issued after the start and is added
 * rather than ignored - it still has to come back.
 *
 * Outstanding rows sort first so the work left to do is at the top.
 */
export function offboardingProgress(
  snapshot: readonly OffboardingAssetRef[] | null | undefined,
  outstanding: readonly OffboardingAssetRef[] | null | undefined,
): OffboardingProgress {
  const open = new Map((outstanding ?? []).map((a) => [a.assetId, a]));
  const seen = new Set<string>();
  const rows: OffboardingRow[] = [];

  for (const a of snapshot ?? []) {
    if (seen.has(a.assetId)) continue;
    seen.add(a.assetId);
    const live = open.get(a.assetId);
    rows.push(live ? { ...live, returned: false } : { ...a, returned: true });
  }
  for (const a of open.values()) {
    if (seen.has(a.assetId)) continue;
    seen.add(a.assetId);
    rows.push({ ...a, returned: false });
  }

  rows.sort((x, y) => Number(x.returned) - Number(y.returned));
  const returned = rows.filter((r) => r.returned).length;
  return { rows, total: rows.length, returned, blocking: rows.length - returned };
}

export type OffboardingFinishState = 'completed' | 'ready' | 'blocked';

/** Which Finish card to show. */
export function offboardingFinishState(input: {
  taskStatus: string | null | undefined;
  blocking: number;
}): OffboardingFinishState {
  if (input.taskStatus === 'COMPLETED') return 'completed';
  return input.blocking === 0 ? 'ready' : 'blocked';
}

/** Mirrors the server's minimum: a documented exception must be at least 10 characters. */
export const OFFBOARDING_EXCEPTION_MIN = 10;

/** Null when the reason will be accepted; otherwise the sentence to show. */
export function offboardingExceptionProblem(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return 'Give a reason for signing off with equipment still out.';
  if (trimmed.length < OFFBOARDING_EXCEPTION_MIN) {
    return `A reason needs at least ${OFFBOARDING_EXCEPTION_MIN} characters - say what happened to the equipment.`;
  }
  return null;
}

/** "3 of 5 returned", or "Nothing to return" when the list was empty from the start. */
export function offboardingProgressLabel(p: Pick<OffboardingProgress, 'total' | 'returned'>): string {
  if (p.total === 0) return 'Nothing to return';
  return `${p.returned} of ${p.total} returned`;
}

/**
 * The plain Deactivate button's warning when equipment is still out. Null when
 * there is nothing to warn about, so the caller keeps its ordinary confirm text.
 */
export function deactivateWithAssetsWarning(count: number): string | null {
  if (count <= 0) return null;
  return (
    `${count} asset${count === 1 ? ' is' : 's are'} still assigned to this person. ` +
    'Deactivating leaves the equipment recorded against them with nobody chasing it. ' +
    'Offboard instead to record each return and close the account in one go.'
  );
}
