import {
  operationsToRetain,
  summariseQueue,
  mayQueueOffline,
  type OfflineOperation,
  type OperationResult,
  type QueueStatus,
} from '@techpioasset/domain';
import type { KeyValueStore } from './storage';

/**
 * The device-side offline queue (spec section 16).
 *
 * Persists queued operations, uploads them when connectivity returns, and applies
 * the server's per-operation results — dropping what succeeded, keeping conflicts
 * and rejections for the user to resolve. All of the decision logic lives in the
 * shared, tested `@techpioasset/domain` functions; this class only orchestrates
 * persistence and the network call, which is why it can be unit-tested with an
 * in-memory store and a stub uploader.
 */

const QUEUE_KEY = 'techpioasset.offline.queue';
/** v2.82 - why a kept operation was not applied, by clientGeneratedId. */
const OUTCOMES_KEY = 'techpioasset.offline.outcomes';
/** The server takes at most this many per upload. */
const BATCH = 500;

export interface HeldOutcome {
  outcome: 'CONFLICT' | 'REJECTED';
  message: string | null;
}

export type BatchUploader = (
  operations: OfflineOperation[],
  sessionId?: string,
) => Promise<{ results: OperationResult[] }>;

export class OfflineQueue {
  constructor(private readonly store: KeyValueStore) {}

  private async read(): Promise<OfflineOperation[]> {
    const raw = await this.store.get(QUEUE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as OfflineOperation[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // A corrupt queue is dropped rather than crashing the app on launch; the
      // operations it held are lost, which is preferable to an unusable device.
      return [];
    }
  }

  private async write(operations: OfflineOperation[]): Promise<void> {
    await this.store.set(QUEUE_KEY, JSON.stringify(operations));
  }

  /**
   * Enqueues an operation, refusing the online-only types (auth, AI, financial
   * approval) that spec section 16 says must not be captured offline.
   */
  async enqueue(operation: OfflineOperation): Promise<void> {
    if (!mayQueueOffline(operation.type)) {
      throw new Error(`${operation.type} may not be queued offline; it requires a connection.`);
    }
    const queue = await this.read();
    // Guard against a double-tap enqueuing the same client id twice.
    if (queue.some((op) => op.clientGeneratedId === operation.clientGeneratedId)) return;
    queue.push(operation);
    await this.write(queue);
  }

  private async outcomes(): Promise<Record<string, HeldOutcome>> {
    const raw = await this.store.get(OUTCOMES_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, HeldOutcome>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  /** Everything still to send, not counting what waits for the user. */
  async pendingCount(): Promise<number> {
    const [queue, held] = await Promise.all([this.read(), this.outcomes()]);
    return queue.filter((op) => !held[op.clientGeneratedId]).length;
  }

  /**
   * v2.82 - every kept operation with why it is kept: nothing (waiting to be
   * sent), or the server's CONFLICT / REJECTED and its reason.
   */
  async entries(): Promise<{ op: OfflineOperation; held: HeldOutcome | null }[]> {
    const [queue, held] = await Promise.all([this.read(), this.outcomes()]);
    return queue.map((op) => ({ op, held: held[op.clientGeneratedId] ?? null }));
  }

  async pending(): Promise<OfflineOperation[]> {
    return this.read();
  }

  /**
   * Uploads the queue and reconciles the response.
   *
   * On any network failure the queue is left untouched, so nothing is lost and
   * the next flush retries everything — safe because the server is idempotent on
   * clientGeneratedId. On success, applied and duplicate operations are dropped
   * and conflicts/rejections are retained.
   */
  async flush(
    uploader: BatchUploader,
    sessionId?: string,
    /** v2.82 - only these may go up now (the signed-in person's own). */
    only: (op: OfflineOperation) => boolean = () => true,
  ): Promise<QueueStatus> {
    const queue = await this.read();
    const held = await this.outcomes();
    // v2.82 - a conflict or a refusal is not sent again on its own: it would
    // only come back the same. It waits until the user discards it.
    const sendable = queue.filter((op) => !held[op.clientGeneratedId] && only(op)).slice(0, BATCH);
    if (sendable.length === 0) return summariseQueue([], 0);

    let results: OperationResult[];
    try {
      ({ results } = await uploader(sendable, sessionId));
    } catch {
      // Offline again mid-flush: keep everything, report it all still pending.
      return summariseQueue([], sendable.length);
    }

    const retained = operationsToRetain(queue, results);
    await this.write(retained);
    for (const r of results) {
      if (r.outcome === 'CONFLICT' || r.outcome === 'REJECTED') {
        held[r.clientGeneratedId] = { outcome: r.outcome, message: r.message ?? null };
      }
    }
    const kept = new Set(retained.map((op) => op.clientGeneratedId));
    for (const key of Object.keys(held)) if (!kept.has(key)) delete held[key];
    await this.store.set(OUTCOMES_KEY, JSON.stringify(held));

    return summariseQueue(results, retained.filter((op) => !held[op.clientGeneratedId]).length);
  }

  /** Discards a conflicted/rejected operation the user chose not to keep. */
  async discard(clientGeneratedId: string): Promise<void> {
    const queue = await this.read();
    await this.write(queue.filter((op) => op.clientGeneratedId !== clientGeneratedId));
    const held = await this.outcomes();
    delete held[clientGeneratedId];
    await this.store.set(OUTCOMES_KEY, JSON.stringify(held));
  }

  async clear(): Promise<void> {
    await this.store.delete(QUEUE_KEY);
    await this.store.delete(OUTCOMES_KEY);
  }
}
