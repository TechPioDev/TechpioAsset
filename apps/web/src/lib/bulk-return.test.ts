import { describe, expect, it } from 'vitest';
import { bulkReturnOutcome, returnableIds } from './bulk-return';

const rows = [
  { id: 'a', assignedUser: { id: 'u1' } },
  { id: 'b', assignedUser: null },
  { id: 'c', assignedUser: { id: 'u2' } },
  { id: 'd', assignedUser: { id: 'u2' } },
];

describe('returnableIds', () => {
  it('counts only selected rows that somebody holds', () => {
    expect(returnableIds(rows, new Set(['a', 'b', 'c']))).toEqual(['a', 'c']);
    expect(returnableIds(rows, new Set(['b']))).toEqual([]);
    expect(returnableIds(rows, new Set())).toEqual([]);
  });

  it('ignores ids that are not on the page', () => {
    expect(returnableIds(rows, new Set(['zzz', 'd']))).toEqual(['d']);
  });
});

describe('bulkReturnOutcome', () => {
  it('celebrates a clean run with the resulting status', () => {
    expect(bulkReturnOutcome({ succeeded: ['a'], failed: [] }, 'Available')).toEqual({
      tone: 'success',
      message: '1 asset returned, now Available',
    });
    expect(bulkReturnOutcome({ succeeded: ['a', 'b'], failed: [] }, 'In storage').message).toBe(
      '2 assets returned, now In storage',
    );
  });

  it('says why when nothing came back', () => {
    const out = bulkReturnOutcome(
      {
        succeeded: [],
        failed: [
          { id: 'a', reason: 'This asset has no open assignment to return' },
          { id: 'b', reason: 'This asset has no open assignment to return' },
        ],
      },
      'Available',
    );
    expect(out.tone).toBe('error');
    expect(out.message).toBe(
      'Nothing was returned. This asset has no open assignment to return (2 assets)',
    );
  });

  it('reports a mixed result with the first reason', () => {
    const out = bulkReturnOutcome(
      { succeeded: ['a', 'c'], failed: [{ id: 'b', reason: 'Nobody holds it' }] },
      'Damaged',
    );
    expect(out.tone).toBe('info');
    expect(out.message).toBe('2 returned, now Damaged; 1 skipped. Nobody holds it');
  });
});
