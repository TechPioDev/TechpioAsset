import { describe, it, expect } from 'vitest';
import {
  decideCustody,
  decideStockCount,
  orderOperationsForReplay,
  decideOperation,
  summariseQueue,
  operationsToRetain,
  mayQueueOffline,
  type OfflineOperation,
  type OperationResult,
} from './offline-sync';

function op(over: Partial<OfflineOperation> = {}): OfflineOperation {
  return {
    clientGeneratedId: '01AAA',
    type: 'INVENTORY_SCAN',
    entityId: 'asset-1',
    payload: {},
    capturedAt: '2026-07-01T10:00:00.000Z',
    ...over,
  };
}

describe('orderOperationsForReplay', () => {
  it('orders oldest-first by capture time', () => {
    const ordered = orderOperationsForReplay([
      op({ clientGeneratedId: 'b', capturedAt: '2026-07-01T10:00:02.000Z' }),
      op({ clientGeneratedId: 'a', capturedAt: '2026-07-01T10:00:01.000Z' }),
    ]);
    expect(ordered.map((o) => o.clientGeneratedId)).toEqual(['a', 'b']);
  });

  it('breaks ties by clientGeneratedId so replay is deterministic', () => {
    const same = '2026-07-01T10:00:00.000Z';
    const ordered = orderOperationsForReplay([
      op({ clientGeneratedId: 'z', capturedAt: same }),
      op({ clientGeneratedId: 'a', capturedAt: same }),
    ]);
    expect(ordered.map((o) => o.clientGeneratedId)).toEqual(['a', 'z']);
  });

  it('does not mutate its input', () => {
    const input = [op({ clientGeneratedId: 'b' }), op({ clientGeneratedId: 'a' })];
    const snapshot = input.map((o) => o.clientGeneratedId);
    orderOperationsForReplay(input);
    expect(input.map((o) => o.clientGeneratedId)).toEqual(snapshot);
  });
});

describe('decideOperation — idempotency', () => {
  it('treats an already-applied operation as a DUPLICATE, not a new apply', () => {
    const result = decideOperation(op(), {
      alreadyApplied: true,
      existingServerId: 'scan-9',
      entityExists: true,
    });
    expect(result.outcome).toBe('DUPLICATE');
    expect(result.serverId).toBe('scan-9');
  });

  it('applies a first-seen operation', () => {
    const result = decideOperation(op(), { alreadyApplied: false, entityExists: true });
    expect(result.outcome).toBe('APPLIED');
  });
});

describe('decideOperation — referential integrity', () => {
  it('rejects an operation whose target entity no longer exists', () => {
    const result = decideOperation(op({ entityId: 'gone' }), {
      alreadyApplied: false,
      entityExists: false,
    });
    expect(result.outcome).toBe('REJECTED');
  });

  it('applies a create-like operation with no target entity', () => {
    const result = decideOperation(op({ entityId: null }), {
      alreadyApplied: false,
      entityExists: false,
    });
    expect(result.outcome).toBe('APPLIED');
  });
});

describe('decideOperation — conflicts (spec section 16)', () => {
  it('flags a stale edit as CONFLICT when the server moved on', () => {
    const result = decideOperation(op({ type: 'CONDITION_UPDATE', baseVersion: 3 }), {
      alreadyApplied: false,
      entityExists: true,
      currentVersion: 5,
    });
    expect(result.outcome).toBe('CONFLICT');
    expect(result.version).toBe(5);
  });

  it('applies an edit when the server version still matches the device base', () => {
    const result = decideOperation(op({ type: 'CONDITION_UPDATE', baseVersion: 5 }), {
      alreadyApplied: false,
      entityExists: true,
      currentVersion: 5,
    });
    expect(result.outcome).toBe('APPLIED');
  });

  // The important exemption: a scan is an observation, not an edit.
  it('never conflicts a scan even when the server version advanced', () => {
    const result = decideOperation(op({ type: 'INVENTORY_SCAN', baseVersion: 1 }), {
      alreadyApplied: false,
      entityExists: true,
      currentVersion: 9,
    });
    expect(result.outcome).toBe('APPLIED');
  });

  it('applies an edit when the device recorded no base version', () => {
    const result = decideOperation(op({ type: 'NOTE', baseVersion: undefined }), {
      alreadyApplied: false,
      entityExists: true,
      currentVersion: 9,
    });
    expect(result.outcome).toBe('APPLIED');
  });
});

describe('summariseQueue', () => {
  const results: OperationResult[] = [
    { clientGeneratedId: 'a', outcome: 'APPLIED' },
    { clientGeneratedId: 'b', outcome: 'APPLIED' },
    { clientGeneratedId: 'c', outcome: 'DUPLICATE' },
    { clientGeneratedId: 'd', outcome: 'CONFLICT' },
    { clientGeneratedId: 'e', outcome: 'REJECTED' },
  ];

  it('counts each outcome and includes still-pending ops', () => {
    const status = summariseQueue(results, 2);
    expect(status).toMatchObject({
      total: 7,
      pending: 2,
      applied: 2,
      duplicate: 1,
      conflict: 1,
      rejected: 1,
    });
  });

  it('is clean only when nothing is pending and nothing needs attention', () => {
    expect(summariseQueue([{ clientGeneratedId: 'a', outcome: 'APPLIED' }], 0).clean).toBe(true);
    expect(summariseQueue(results, 0).clean).toBe(false); // a conflict remains
    expect(summariseQueue([], 3).clean).toBe(false); // still pending
  });
});

describe('operationsToRetain', () => {
  it('drops applied and duplicate ops but keeps conflicts and rejections', () => {
    const ops = [
      op({ clientGeneratedId: 'a' }),
      op({ clientGeneratedId: 'b' }),
      op({ clientGeneratedId: 'c' }),
      op({ clientGeneratedId: 'd' }),
    ];
    const results: OperationResult[] = [
      { clientGeneratedId: 'a', outcome: 'APPLIED' },
      { clientGeneratedId: 'b', outcome: 'DUPLICATE' },
      { clientGeneratedId: 'c', outcome: 'CONFLICT' },
      { clientGeneratedId: 'd', outcome: 'REJECTED' },
    ];
    const retained = operationsToRetain(ops, results).map((o) => o.clientGeneratedId);
    // Conflicts and rejections survive so the user can resolve them deliberately.
    expect(retained).toEqual(['c', 'd']);
  });

  it('keeps an operation the server did not answer (partial sync)', () => {
    const ops = [op({ clientGeneratedId: 'a' }), op({ clientGeneratedId: 'b' })];
    const results: OperationResult[] = [{ clientGeneratedId: 'a', outcome: 'APPLIED' }];
    expect(operationsToRetain(ops, results).map((o) => o.clientGeneratedId)).toEqual(['b']);
  });
});

describe('mayQueueOffline (spec section 16)', () => {
  it('permits the offline-safe operation types', () => {
    expect(mayQueueOffline('INVENTORY_SCAN')).toBe(true);
    expect(mayQueueOffline('CONDITION_UPDATE')).toBe(true);
    expect(mayQueueOffline('ASSET_PHOTO')).toBe(true);
  });

  it('refuses auth, AI and financial operations offline', () => {
    expect(mayQueueOffline('AUTH_CHANGE')).toBe(false);
    expect(mayQueueOffline('AI_EXTRACTION')).toBe(false);
    expect(mayQueueOffline('FINANCIAL_APPROVAL')).toBe(false);
    expect(mayQueueOffline('INVOICE_VERIFY')).toBe(false);
  });

  it('refuses an unknown operation type', () => {
    expect(mayQueueOffline('SOMETHING_ELSE')).toBe(false);
  });
});

describe('end-to-end replay is convergent', () => {
  it('reaches the same retained set whether synced once or in two partial passes', () => {
    const ops = [
      op({ clientGeneratedId: 'a', capturedAt: '2026-07-01T10:00:00.000Z' }),
      op({ clientGeneratedId: 'b', capturedAt: '2026-07-01T10:00:01.000Z' }),
      op({
        clientGeneratedId: 'c',
        type: 'CONDITION_UPDATE',
        baseVersion: 1,
        capturedAt: '2026-07-01T10:00:02.000Z',
      }),
    ];

    // Full sync: a, b apply; c conflicts.
    const full: OperationResult[] = orderOperationsForReplay(ops).map((o) =>
      decideOperation(o, {
        alreadyApplied: false,
        entityExists: true,
        currentVersion: o.type === 'CONDITION_UPDATE' ? 5 : undefined,
      }),
    );
    const afterFull = operationsToRetain(ops, full).map((o) => o.clientGeneratedId);

    // Two partial passes: first a only, then b, then c is retried (now a duplicate
    // for a, applied for b, still conflict for c).
    const pass1 = [decideOperation(ops[0]!, { alreadyApplied: false, entityExists: true })];
    const remaining1 = operationsToRetain(ops, pass1);
    const pass2 = orderOperationsForReplay(remaining1).map((o) =>
      decideOperation(o, {
        alreadyApplied: false,
        entityExists: true,
        currentVersion: o.type === 'CONDITION_UPDATE' ? 5 : undefined,
      }),
    );
    const afterPartial = operationsToRetain(remaining1, pass2).map((o) => o.clientGeneratedId);

    // Both converge to "only the conflict remains".
    expect(afterFull).toEqual(['c']);
    expect(afterPartial).toEqual(['c']);
  });
});

describe('custody and stock recorded offline (v2.82)', () => {
  it('applies a handover when the asset is held by whom the phone saw', () => {
    expect(
      decideCustody('ASSET_ASSIGN', { seenHolderId: null, targetUserId: 'b' }, { holderId: null }),
    ).toEqual({
      outcome: 'APPLY',
    });
    expect(
      decideCustody('ASSET_REASSIGN', { seenHolderId: 'a', targetUserId: 'b' }, { holderId: 'a' })
        .outcome,
    ).toBe('APPLY');
    expect(decideCustody('ASSET_RETURN', { seenHolderId: 'a' }, { holderId: 'a' }).outcome).toBe(
      'APPLY',
    );
  });

  it('treats a change already made by someone else as done, not as a conflict', () => {
    expect(
      decideCustody(
        'ASSET_ASSIGN',
        { seenHolderId: null, targetUserId: 'b' },
        { holderId: 'b', holderName: 'Ben' },
      ),
    ).toEqual({ outcome: 'ALREADY_DONE', message: 'Already with Ben.' });
    expect(decideCustody('ASSET_RETURN', { seenHolderId: 'a' }, { holderId: null }).outcome).toBe(
      'ALREADY_DONE',
    );
  });

  it('refuses to apply on top of someone else’s change, and says who holds it now', () => {
    const d = decideCustody(
      'ASSET_ASSIGN',
      { seenHolderId: null, targetUserId: 'b' },
      { holderId: 'c', holderName: 'Cara' },
    );
    expect(d.outcome).toBe('CONFLICT');
    expect(d.outcome === 'CONFLICT' && d.message).toMatch(/Cara/);
    expect(decideCustody('ASSET_RETURN', { seenHolderId: 'a' }, { holderId: 'c' }).outcome).toBe(
      'CONFLICT',
    );
    expect(
      decideCustody('ASSET_REASSIGN', { seenHolderId: 'a', targetUserId: 'b' }, { holderId: null })
        .outcome,
    ).toBe('CONFLICT');
  });

  it('applies a stock count only if nothing moved since it was taken', () => {
    expect(
      decideStockCount({ seenQuantity: 10, countedQuantity: 7 }, { quantity: 10 }).outcome,
    ).toBe('APPLY');
    expect(
      decideStockCount({ seenQuantity: 10, countedQuantity: 7 }, { quantity: 7 }).outcome,
    ).toBe('ALREADY_DONE');
    const moved = decideStockCount({ seenQuantity: 10, countedQuantity: 7 }, { quantity: 8 });
    expect(moved.outcome).toBe('CONFLICT');
    expect(moved.outcome === 'CONFLICT' && moved.message).toMatch(/10 then, and 8 now/);
  });

  it('lets the new types be queued', () => {
    for (const t of ['ASSET_ASSIGN', 'ASSET_REASSIGN', 'ASSET_RETURN', 'STOCK_COUNT'])
      expect(mayQueueOffline(t)).toBe(true);
  });
});
