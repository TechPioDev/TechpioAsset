/**
 * Offline synchronisation logic (spec section 16).
 *
 * Pure and I/O-free so the rules that make offline mode *correct* — idempotent
 * replay, conflict detection, deterministic ordering — can be tested exhaustively
 * without a device, a database, or a network. The mobile app and the API both
 * apply these functions; neither reimplements the logic.
 *
 * The hard requirements from the spec: "Queue offline changes and synchronize
 * when connectivity returns. Prevent conflicting updates and show clear
 * synchronization status." The design below makes replaying the same queued
 * operation twice a no-op, and makes a stale update visible rather than silently
 * overwriting fresh server data.
 */

export const OFFLINE_OP_TYPES = [
  'INVENTORY_SCAN',
  'CONDITION_UPDATE',
  'ASSET_PHOTO',
  'LOCATION_UPDATE',
  'NOTE',
  // v2.82 (Phase 6) - custody and stock, recorded with no signal.
  'ASSET_ASSIGN',
  'ASSET_REASSIGN',
  'ASSET_RETURN',
  'STOCK_COUNT',
] as const;
export type OfflineOpType = (typeof OFFLINE_OP_TYPES)[number];

/**
 * One queued change captured on the device.
 *
 * `clientGeneratedId` is a device-side unique id (a ULID). It is the idempotency
 * key: the server records it, and a second upload carrying the same id is
 * recognised as a replay of an operation already applied, not a new one. This is
 * what lets a flaky connection retry the whole queue safely.
 */
export interface OfflineOperation<P = unknown> {
  clientGeneratedId: string;
  type: OfflineOpType;
  /** Entity the operation targets, e.g. an asset id. Null for create-like ops. */
  entityId: string | null;
  payload: P;
  /** Device clock when captured, ISO 8601. Used only for ordering, never trusted for auth. */
  capturedAt: string;
  /**
   * The entity version the device last saw, when known. Lets the server detect
   * that the entity changed server-side since this operation was captured.
   */
  baseVersion?: number;
}

export type OperationOutcome = 'APPLIED' | 'DUPLICATE' | 'CONFLICT' | 'REJECTED';

export interface OperationResult {
  clientGeneratedId: string;
  outcome: OperationOutcome;
  /** Server entity id created or affected, when applicable. */
  serverId?: string;
  /** Present when CONFLICT or REJECTED, so the device can show the user why. */
  message?: string;
  /** Current server version after applying, so the device can advance its base. */
  version?: number;
}

export interface SyncResponse {
  results: OperationResult[];
  /** Server time the batch was processed, for the device's next delta pull. */
  syncedAt: string;
}

/**
 * Orders a queue for replay.
 *
 * Deterministic and stable: operations are applied oldest-first by capture time,
 * with the clientGeneratedId as a tiebreaker so two ops captured in the same
 * millisecond always apply in the same order on every replay. Determinism is what
 * makes a partial, retried sync converge to the same result as a clean one.
 */
export function orderOperationsForReplay<P>(
  operations: readonly OfflineOperation<P>[],
): OfflineOperation<P>[] {
  return [...operations].sort((a, b) => {
    if (a.capturedAt !== b.capturedAt) return a.capturedAt < b.capturedAt ? -1 : 1;
    return a.clientGeneratedId < b.clientGeneratedId ? -1 : 1;
  });
}

/**
 * Decides the outcome of a single operation against server state.
 *
 * The server calls this per operation while holding the current record. It never
 * mutates anything; it returns a decision the caller then persists. Separating
 * the decision from the write keeps the rule pure and testable.
 */
export function decideOperation<P>(
  op: OfflineOperation<P>,
  serverState: {
    /** True if an operation with this clientGeneratedId was already applied. */
    alreadyApplied: boolean;
    /** The server id already recorded for this clientGeneratedId, if any. */
    existingServerId?: string;
    /** Current server version of the target entity, if it exists. */
    currentVersion?: number;
    /** True if the target entity exists on the server. */
    entityExists: boolean;
  },
): OperationResult {
  // 1. Idempotency: a replay is a success that changes nothing.
  if (serverState.alreadyApplied) {
    return {
      clientGeneratedId: op.clientGeneratedId,
      outcome: 'DUPLICATE',
      serverId: serverState.existingServerId,
    };
  }

  // 2. Referential integrity: an op targeting a vanished entity cannot apply.
  if (op.entityId !== null && !serverState.entityExists) {
    return {
      clientGeneratedId: op.clientGeneratedId,
      outcome: 'REJECTED',
      message: 'The target record no longer exists on the server.',
    };
  }

  // 3. Optimistic concurrency: if the device recorded a base version and the
  //    server has moved on, this is a conflict the user must see rather than an
  //    overwrite that silently discards someone else's change.
  //
  //    Scans are exempt: a physical-inventory scan is an observation ("I saw this
  //    asset here"), not an edit, so a newer server version does not invalidate it.
  if (
    op.type !== 'INVENTORY_SCAN' &&
    op.baseVersion !== undefined &&
    serverState.currentVersion !== undefined &&
    serverState.currentVersion > op.baseVersion
  ) {
    return {
      clientGeneratedId: op.clientGeneratedId,
      outcome: 'CONFLICT',
      message: 'This record changed on the server after you went offline. Review before applying.',
      version: serverState.currentVersion,
    };
  }

  return { clientGeneratedId: op.clientGeneratedId, outcome: 'APPLIED' };
}

/** A device-side view of how a queue is progressing, for the sync-status UI. */
export interface QueueStatus {
  total: number;
  pending: number;
  applied: number;
  duplicate: number;
  conflict: number;
  rejected: number;
  /** True when nothing remains to sync and nothing needs the user's attention. */
  clean: boolean;
}

/** Summarises a set of results (plus still-pending ops) for the status indicator. */
export function summariseQueue(
  results: readonly OperationResult[],
  pendingCount: number,
): QueueStatus {
  const count = (outcome: OperationOutcome) => results.filter((r) => r.outcome === outcome).length;
  const conflict = count('CONFLICT');
  const rejected = count('REJECTED');
  return {
    total: results.length + pendingCount,
    pending: pendingCount,
    applied: count('APPLIED'),
    duplicate: count('DUPLICATE'),
    conflict,
    rejected,
    clean: pendingCount === 0 && conflict === 0 && rejected === 0,
  };
}

/**
 * Which operations should stay in the device queue after a sync.
 *
 * APPLIED and DUPLICATE are done and can be dropped. CONFLICT and REJECTED are
 * kept so the user can resolve or discard them deliberately — losing them
 * silently would violate "prevent conflicting updates".
 */
export function operationsToRetain<P>(
  operations: readonly OfflineOperation<P>[],
  results: readonly OperationResult[],
): OfflineOperation<P>[] {
  const resolved = new Set(
    results
      .filter((r) => r.outcome === 'APPLIED' || r.outcome === 'DUPLICATE')
      .map((r) => r.clientGeneratedId),
  );
  return operations.filter((op) => !resolved.has(op.clientGeneratedId));
}

/**
 * Spec section 16: "AI processing, authentication changes, and financial
 * approvals should require an internet connection." These operations may never
 * be queued offline; the mobile app checks this before enqueuing.
 */
const ONLINE_ONLY_OP_TYPES = new Set<string>([
  'AUTH_CHANGE',
  'AI_EXTRACTION',
  'FINANCIAL_APPROVAL',
  'INVOICE_VERIFY',
]);

export function mayQueueOffline(opType: string): boolean {
  return (
    !ONLINE_ONLY_OP_TYPES.has(opType) && (OFFLINE_OP_TYPES as readonly string[]).includes(opType)
  );
}

// ---------------------------------------------------------------------------
// v2.82 (Phase 6) - the rules for a handover, return or stock count that was
// recorded offline and reaches the server later.
//
// The question is never "did anything about this asset change" (a note or a
// photo bumps the version and would make every offline handover a conflict).
// It is "is the thing I acted on still the way I saw it": for custody, who
// held the asset; for a count, how much the system said was on the shelf.
// ---------------------------------------------------------------------------

export const CUSTODY_OP_TYPES = ['ASSET_ASSIGN', 'ASSET_REASSIGN', 'ASSET_RETURN'] as const;
export type CustodyOpType = (typeof CUSTODY_OP_TYPES)[number];

export type CustodyDecision =
  | { outcome: 'APPLY' }
  | { outcome: 'ALREADY_DONE'; message: string }
  | { outcome: 'CONFLICT'; message: string };

/**
 * Whether a custody change recorded offline may still be applied.
 *
 * - APPLY when the asset is held by exactly whom the phone saw.
 * - ALREADY_DONE when the change the phone recorded is already true (someone
 *   else did the same thing): nothing to apply, nothing lost.
 * - CONFLICT otherwise - somebody else moved it in between. Never applied on
 *   top: the person who recorded it decides, with the current holder in view.
 */
export function decideCustody(
  type: CustodyOpType,
  op: { seenHolderId: string | null; targetUserId?: string | null },
  current: { holderId: string | null; holderName?: string | null },
): CustodyDecision {
  const now = current.holderId;
  const who = current.holderName ?? 'someone else';
  if (type === 'ASSET_RETURN') {
    if (now === op.seenHolderId) return { outcome: 'APPLY' };
    if (now === null)
      return { outcome: 'ALREADY_DONE', message: 'Already returned by someone else.' };
    return {
      outcome: 'CONFLICT',
      message: `It is now held by ${who} - it changed after you recorded the return.`,
    };
  }
  if (op.targetUserId && now === op.targetUserId) {
    return { outcome: 'ALREADY_DONE', message: `Already with ${who}.` };
  }
  if (now === op.seenHolderId) return { outcome: 'APPLY' };
  return {
    outcome: 'CONFLICT',
    message:
      now === null
        ? 'It was returned after you recorded the handover. Hand it over again if it is still right.'
        : `It is now held by ${who} - it changed after you recorded the handover.`,
  };
}

/**
 * Whether a stock count recorded offline may still be applied. A count is
 * "there are N on the shelf", taken against what the system said at the time.
 * If stock has moved since (issued, received, counted by someone else),
 * setting it to N would silently undo those movements, so it is a conflict:
 * count again. Equal numbers mean nothing moved and the count applies.
 */
export function decideStockCount(
  op: { seenQuantity: number; countedQuantity: number },
  current: { quantity: number },
): CustodyDecision {
  if (current.quantity === op.seenQuantity) return { outcome: 'APPLY' };
  if (current.quantity === op.countedQuantity) {
    return { outcome: 'ALREADY_DONE', message: `The system already shows ${op.countedQuantity}.` };
  }
  return {
    outcome: 'CONFLICT',
    message: `Stock moved after you counted: the system said ${op.seenQuantity} then, and ${current.quantity} now. Count again.`,
  };
}
