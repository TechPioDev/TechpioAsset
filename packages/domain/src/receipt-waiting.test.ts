import { describe, expect, it } from 'vitest';
import { receiptsWaiting } from './receipt-waiting';

const me = 'u1';
const asset = (id: string, open: Record<string, unknown> | null, holder = me) => ({
  id,
  name: `Laptop ${id}`,
  assetTag: `AST-${id}`,
  assignedUser: { id: holder },
  assignments: open ? [{ id: `asg-${id}`, assignedAt: '2026-09-20T10:00:00Z', ...open }] : [],
});

describe('handovers waiting for me to confirm', () => {
  it('lists an open handover nobody has confirmed', () => {
    expect(receiptsWaiting([asset('1', { acknowledgedAt: null })], me)).toEqual([
      {
        assetId: '1',
        assignmentId: 'asg-1',
        name: 'Laptop 1',
        assetTag: 'AST-1',
        assignedAt: '2026-09-20T10:00:00.000Z',
      },
    ]);
  });

  it('leaves out confirmed ones, ones with no handover, and imported custody', () => {
    const rows = receiptsWaiting(
      [
        asset('1', { acknowledgedAt: '2026-09-21T10:00:00Z' }),
        asset('2', null),
        asset('3', { acknowledgedAt: null, acknowledgementMethod: 'IMPORT_BACKFILL' }),
      ],
      me,
    );
    expect(rows).toEqual([]);
  });

  it('never asks me to confirm someone else’s asset', () => {
    expect(receiptsWaiting([asset('1', { acknowledgedAt: null }, 'someone-else')], me)).toEqual([]);
  });
});
