import { useEffect, useState } from 'react';
import type { OfflineOperation, OperationResult, QueueStatus } from '@techpioasset/domain';
import { ApiError, type ApiClient } from './api-client';
import { OfflineQueue } from './offline-queue';
import { SqliteStore } from './sqlite-store';
import { ulid } from './ulid';

/**
 * The one offline queue the app shares (Phase 6, v2.82).
 *
 * Handovers, returns, stock counts and stock-take scans recorded with no
 * signal wait here, and go up together whenever the app next reaches the
 * server - from the background runner, the banner's "Send now", or the
 * stock-take screen. The server is idempotent on each operation's id, so two
 * of those racing is harmless.
 */
export const syncQueue = new OfflineQueue(new SqliteStore());

export interface SyncSnapshot {
  /** Waiting to be sent. */
  pending: number;
  /** Came back as a conflict or refused: waiting for the person to decide. */
  attention: number;
  sending: boolean;
  lastResult: QueueStatus | null;
}

/**
 * Who is signed in. A phone can be shared: what one person recorded offline
 * is sent - and shown - only while that person is signed in, never under
 * somebody else's name.
 */
let currentUser: string | null = null;
export function setSyncUser(userId: string | null): void {
  currentUser = userId;
  void refreshSyncStatus();
}

/** Recorded by the signed-in person (or before this rule existed). */
export function isMine(op: OfflineOperation): boolean {
  const by = (op.payload as { recordedBy?: unknown } | null)?.recordedBy;
  return by === undefined || (currentUser !== null && by === currentUser);
}

let snapshot: SyncSnapshot = { pending: 0, attention: 0, sending: false, lastResult: null };
const listeners = new Set<(s: SyncSnapshot) => void>();

function publish(next: Partial<SyncSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const l of listeners) l(snapshot);
}

export async function refreshSyncStatus(): Promise<SyncSnapshot> {
  const entries = (await syncQueue.entries()).filter((e) => isMine(e.op));
  publish({
    pending: entries.filter((e) => !e.held).length,
    attention: entries.filter((e) => e.held).length,
  });
  return snapshot;
}

/** Keeps a screen's banner current. */
export function useSyncStatus(): SyncSnapshot {
  const [state, setState] = useState(snapshot);
  useEffect(() => {
    listeners.add(setState);
    void refreshSyncStatus();
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}

/** Records a change to send later. The label is what the Sync screen shows. */
export async function recordOffline(input: {
  type: OfflineOperation['type'];
  entityId: string | null;
  payload: Record<string, unknown>;
  label: string;
}): Promise<void> {
  await syncQueue.enqueue({
    clientGeneratedId: ulid(),
    type: input.type,
    entityId: input.entityId,
    payload: {
      ...input.payload,
      label: input.label,
      ...(currentUser ? { recordedBy: currentUser } : {}),
    },
    capturedAt: new Date().toISOString(),
  });
  await refreshSyncStatus();
}

let inFlight: Promise<QueueStatus | null> | null = null;

/** Sends what is waiting. Resolves null when there was nothing to send. */
export function sendNow(api: ApiClient, sessionId?: string): Promise<QueueStatus | null> {
  inFlight ??= (async () => {
    try {
      if (currentUser === null) return null;
      const mine = (await syncQueue.entries()).filter((e) => !e.held && isMine(e.op));
      if (mine.length === 0) return null;
      publish({ sending: true });
      const result = await syncQueue.flush(
        (operations, sid) =>
          api.request<{ results: OperationResult[] }>('/mobile/sync', {
            method: 'POST',
            body: { ...(sid ? { sessionId: sid } : {}), operations },
          }),
        sessionId,
        isMine,
      );
      publish({ lastResult: result });
      return result;
    } finally {
      publish({ sending: false });
      await refreshSyncStatus();
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Whether a failed call means "no connection" (worth saving for later), as
 * opposed to the server answering no (which saving would not change).
 */
export function isNoConnection(error: unknown): boolean {
  return !(error instanceof ApiError);
}
