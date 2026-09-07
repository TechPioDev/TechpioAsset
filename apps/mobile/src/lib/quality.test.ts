import { describe, expect, it } from 'vitest';
import { buildQualityCheck, qualityDraftProblem, type QualityDraft } from './quality';

const draft = (over: Partial<QualityDraft> = {}): QualityDraft => ({
  received: 3,
  rejected: 0,
  reason: '',
  disposition: 'RETURN_TO_VENDOR',
  rejectedAssetIds: [],
  intake: 'ASSET',
  ...over,
});

describe('building the payload', () => {
  it('sends no reason on a clean pass', () => {
    const payload = buildQualityCheck(draft());
    expect(payload).toEqual({ quantityAccepted: 3, quantityRejected: 0 });
  });

  it('derives accepted from what arrived, never from a second input', () => {
    const payload = buildQualityCheck(draft({ rejected: 1, reason: 'Dented', rejectedAssetIds: ['a1'] }));
    expect(payload.quantityAccepted).toBe(2);
  });

  it('names the units on an asset line', () => {
    const payload = buildQualityCheck(
      draft({ rejected: 2, reason: 'Cracked', rejectedAssetIds: ['a1', 'a2'] }),
    );
    expect(payload.rejectedAssetIds).toEqual(['a1', 'a2']);
    expect(payload.disposition).toBe('RETURN_TO_VENDOR');
  });

  it('does not name units on a stock line, where there are none to name', () => {
    const payload = buildQualityCheck(
      draft({ intake: 'STOCK', rejected: 1, reason: 'Damp', rejectedAssetIds: [] }),
    );
    expect(payload.rejectedAssetIds).toBeUndefined();
  });

  it('trims the reason', () => {
    const payload = buildQualityCheck(
      draft({ rejected: 1, reason: '  Screen cracked  ', rejectedAssetIds: ['a1'] }),
    );
    expect(payload.rejectionReason).toBe('Screen cracked');
  });
});

describe('what stops it being sent', () => {
  it('allows a clean pass', () => {
    expect(qualityDraftProblem(draft())).toBeNull();
  });

  it('asks why, before the request rather than after it', () => {
    expect(qualityDraftProblem(draft({ rejected: 1, rejectedAssetIds: ['a1'] }))).toContain('why');
  });

  it('refuses a rejected count that does not match the units named', () => {
    // The failure this prevents: condemning a different laptop from the one
    // with the cracked screen.
    const problem = qualityDraftProblem(
      draft({ rejected: 2, reason: 'Cracked', rejectedAssetIds: ['a1'] }),
    );
    expect(problem).toContain('named');
  });

  it('does not apply the unit rule to a stock line', () => {
    expect(
      qualityDraftProblem(draft({ intake: 'STOCK', rejected: 1, reason: 'Damp', rejectedAssetIds: [] })),
    ).toBeNull();
  });

  it('refuses more rejected than arrived, in words an inspector can act on', () => {
    const problem = qualityDraftProblem(
      draft({ rejected: 5, reason: 'All bad', rejectedAssetIds: ['a1', 'a2', 'a3', 'a4', 'a5'] }),
    );
    expect(problem).toBe('Cannot reject 5 when only 3 arrived');
  });
});
