import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VENDOR_OFFER_POLICY,
  editReturnsToReview,
  statusAfterSubmit,
  submitActionLabel,
} from './vendor-offer-policy';

describe('whether a supplier offer waits for approval', () => {
  it('defaults to requiring review, so nobody wakes up to a changed workflow', () => {
    expect(DEFAULT_VENDOR_OFFER_POLICY).toBe('REVIEW_REQUIRED');
    expect(statusAfterSubmit(DEFAULT_VENDOR_OFFER_POLICY)).toBe('PENDING_REVIEW');
  });

  it('publishes at once when review is switched off', () => {
    expect(statusAfterSubmit('PUBLISH_IMMEDIATELY')).toBe('APPROVED');
  });

  it('does not send an edited offer back to a queue nobody works', () => {
    // Under review an edited price is re-reviewed. With review off there is no
    // reviewer, so the same rule would take a live offer off sale for good.
    expect(editReturnsToReview('REVIEW_REQUIRED')).toBe(true);
    expect(editReturnsToReview('PUBLISH_IMMEDIATELY')).toBe(false);
  });

  it('names the button after what it actually does', () => {
    expect(submitActionLabel('REVIEW_REQUIRED')).toBe('Send for review');
    expect(submitActionLabel('PUBLISH_IMMEDIATELY')).toBe('Publish this offer');
  });
});
