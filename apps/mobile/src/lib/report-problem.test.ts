import { describe, expect, it } from 'vitest';
import { PROBLEM_CATEGORIES, initialAsset, photoHelps, problemRequest } from './report-problem';

const laptop = { id: 'a1', name: 'Dell Latitude 5450', assetTag: 'AST-0009' };

describe('reporting a problem from the phone', () => {
  it('sends a complete request without a word typed', () => {
    const body = problemRequest('DISPLAY', laptop, '')!;
    expect(body).toEqual({
      type: 'REPAIR',
      priority: 'NORMAL',
      issueCategory: 'DISPLAY',
      businessReason: 'Display issue on Dell Latitude 5450 (AST-0009).',
      details: { targetAssetId: 'a1' },
    });
    // The server's minimum for a reason.
    expect(body.businessReason.length).toBeGreaterThanOrEqual(10);
  });

  it('adds what was typed, and takes the type and urgency from the catalogue', () => {
    const body = problemRequest('HARDWARE_DAMAGE', laptop, '  Dropped it, hinge cracked  ')!;
    expect(body.type).toBe('DAMAGE');
    expect(body.priority).toBe('HIGH');
    expect(body.businessReason).toBe(
      'Hardware damage on Dell Latitude 5450 (AST-0009). Dropped it, hinge cracked',
    );
  });

  it('works without an asset, and refuses a category the catalogue does not publish', () => {
    expect(problemRequest('SOFTWARE', null, '')!.details).toBeNull();
    expect(problemRequest('MADE_UP', laptop, '')).toBeNull();
  });

  it('offers faults, not the replacement request', () => {
    expect(PROBLEM_CATEGORIES.map((c) => c.key)).not.toContain('REPLACEMENT');
    expect(PROBLEM_CATEGORIES.length).toBeGreaterThan(4);
  });

  it('puts the camera first where a photo shows the fault', () => {
    expect(photoHelps('DISPLAY')).toBe(true);
    expect(photoHelps('SOFTWARE')).toBe(false);
    expect(photoHelps(null)).toBe(false);
  });

  it('preselects the asset it was opened from, or the only one held', () => {
    const two = [laptop, { id: 'a2', name: 'Mouse', assetTag: 'ACC-1' }];
    expect(initialAsset(two, 'a2')).toBe('a2');
    expect(initialAsset(two, null)).toBeNull();
    expect(initialAsset([laptop], null)).toBe('a1');
    expect(initialAsset(two, 'not-mine')).toBeNull();
  });
});
