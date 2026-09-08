/**
 * Whether a supplier's offer waits for an internal decision (v2.46).
 *
 * Two different ways of buying, and both are legitimate.
 *
 * REVIEW_REQUIRED is a gatekeeping catalogue: nothing reaches a buyer until
 * somebody internal has looked at it. Right when the catalogue itself is the
 * published thing - a price list people quote from.
 *
 * PUBLISH_IMMEDIATELY is a noticeboard: suppliers post what they sell, and the
 * buying team picks what it needs and ignores the rest. Reviewing an offer
 * nobody may ever buy is work spent on the wrong side of the decision, and the
 * decision that matters - do we buy this - happens at selection anyway.
 *
 * What does NOT change with the policy is the quality gate. An offer still
 * needs a picture and its required specifications before it can be submitted,
 * under either policy, because an offer missing those fails a comparison as
 * "not stated" and wastes the buyer's time rather than the reviewer's.
 */

export const VENDOR_OFFER_POLICIES = ['REVIEW_REQUIRED', 'PUBLISH_IMMEDIATELY'] as const;
export type VendorOfferPolicy = (typeof VENDOR_OFFER_POLICIES)[number];

export const DEFAULT_VENDOR_OFFER_POLICY: VendorOfferPolicy = 'REVIEW_REQUIRED';

/**
 * What a submitted offer becomes.
 *
 * Returned rather than branched at each call site, so the API, the web app and
 * the mobile app cannot disagree about what pressing the button does.
 */
export function statusAfterSubmit(policy: VendorOfferPolicy): 'PENDING_REVIEW' | 'APPROVED' {
  return policy === 'PUBLISH_IMMEDIATELY' ? 'APPROVED' : 'PENDING_REVIEW';
}

/**
 * Whether editing a reviewed field on a live offer sends it back.
 *
 * Under review, yes: what was approved was a price and a specification, not a
 * row. Under immediate publication there is nothing to send it back to - a
 * queue nobody works is worse than no queue, because the offer silently stops
 * being buyable.
 */
export function editReturnsToReview(policy: VendorOfferPolicy): boolean {
  return policy === 'REVIEW_REQUIRED';
}

/** What the button says, so every client says the same thing. */
export function submitActionLabel(policy: VendorOfferPolicy): string {
  return policy === 'PUBLISH_IMMEDIATELY' ? 'Publish this offer' : 'Send for review';
}
