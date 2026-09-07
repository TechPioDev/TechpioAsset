/**
 * Vendor catalogue rules (v2.42).
 *
 * Pure functions, kept out of the service layer for the same reason the AI gate
 * is: money and eligibility are the two things in this module nobody may get
 * wrong, and a rule that lives in a function can be tested exhaustively while a
 * rule living in a controller can only be tested through it.
 */

export const INR = 'INR';

/** Days before expiry at which an offer starts warning. */
export const EXPIRING_SOON_DAYS = 7;

export interface PriceComponents {
  unitPrice: number;
  gstPercent: number;
  discount: number;
  shippingCost: number;
  installationCost: number;
  otherCharges: number;
}

export interface LandedCostBreakdown extends PriceComponents {
  /** What GST is charged on: the unit price after the trade discount. */
  taxableValue: number;
  gstAmount: number;
  landedCost: number;
}

/**
 * Rounds to paise without floating-point drift.
 *
 * 0.1 + 0.2 is not 0.3 in binary floating point, and a landed cost is compared
 * against an approval and an invoice - three numbers that must agree exactly.
 * Working in integer paise and rounding once at the end keeps them equal.
 */
function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

function toRupees(paise: number): number {
  return paise / 100;
}

/**
 * The landed cost of one unit.
 *
 *   taxable value = base − discount + shipping + installation
 *   landed        = taxable value + GST on it + other charges
 *
 * GST IS CHARGED ON THE DISCOUNTED VALUE. Under section 15(3) of the CGST Act a
 * discount known at the time of supply and shown on the invoice is excluded
 * from the taxable value, so taxing the pre-discount price would overstate the
 * tax and disagree with the vendor's own invoice - which the three-way match
 * would then flag as a price mismatch on every discounted line.
 *
 * The first implementation followed the specification's written order, which
 * put the discount last; Finance corrected it. On a ₹1,08,000 unit with an
 * ₹8,000 discount at 18% the difference is ₹1,440.
 *
 * Shipping and installation are INSIDE the tax base: they are part of a
 * composite supply and attract the same rate, which Finance confirmed.
 *
 * Other charges are deliberately still outside it. "Other" is whatever a vendor
 * decides to put there - a statutory fee, insurance, a rounding line - and some
 * of those are not taxable. Taxing them by default would quietly add tax nobody
 * owes to a field with no defined meaning, so it stays out until somebody says
 * what it contains. A test pins that, so including it later is a deliberate act
 * rather than drift.
 */
export function calculateLandedCost(components: PriceComponents): LandedCostBreakdown {
  const { unitPrice, gstPercent, discount, shippingCost, installationCost, otherCharges } =
    components;

  for (const [name, value] of Object.entries(components)) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
    if (value < 0) throw new Error(`${name} cannot be negative`);
  }
  if (gstPercent > 100) throw new Error('gstPercent cannot exceed 100');

  // Clamped before anything is added: a discount larger than the price must not
  // produce a negative goods value that then eats into the freight.
  const goodsPaise = Math.max(0, toPaise(unitPrice) - toPaise(discount));
  const taxablePaise = goodsPaise + toPaise(shippingCost) + toPaise(installationCost);
  const gstPaise = Math.round((taxablePaise * gstPercent) / 100);
  const landedPaise = taxablePaise + gstPaise + toPaise(otherCharges);

  return {
    ...components,
    taxableValue: toRupees(taxablePaise),
    gstAmount: toRupees(gstPaise),
    landedCost: toRupees(landedPaise),
  };
}

/**
 * Indian digit grouping: ₹1,00,000 rather than ₹100,000.
 *
 * The last three digits group together, then pairs. Written out rather than
 * left to Intl alone so mobile, web and generated documents cannot disagree
 * about the same number.
 */
export function formatInr(amount: number, options: { paise?: boolean } = {}): string {
  const negative = amount < 0;
  const value = Math.abs(amount);
  const fixed = value.toFixed(options.paise ? 2 : 0);
  const [whole, fraction] = fixed.split('.');

  const last3 = whole!.slice(-3);
  const rest = whole!.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;

  return `${negative ? '-' : ''}₹${grouped}${fraction ? `.${fraction}` : ''}`;
}

/**
 * The video id from a YouTube URL, or null.
 *
 * Only an id is ever stored. A vendor supplying embed markup is a vendor
 * supplying HTML that would run on our page, so the input is parsed and
 * discarded rather than kept.
 */
export function youtubeVideoId(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed.length > 300) return null;

  // An allowlist of the exact shapes YouTube publishes, rather than parsing a
  // URL and then judging it. This package is shared with the browser and the
  // mobile app, so it cannot depend on a runtime URL parser - and an allowlist
  // is the safer construction regardless: "youtube.com.evil.test" fails because
  // the host must be followed by a slash, not by more hostname.
  const patterns = [
    /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{11})(?:[&#]|$)/,
    /^https?:\/\/(?:www\.)?youtu\.be\/([A-Za-z0-9_-]{11})(?:[?#]|$)/,
    /^https?:\/\/(?:www\.|m\.)?youtube\.com\/embed\/([A-Za-z0-9_-]{11})(?:[?#]|$)/,
    /^https?:\/\/(?:www\.|m\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]{11})(?:[?#]|$)/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(trimmed);
    // Only the id survives. A vendor supplying embed markup is a vendor
    // supplying HTML that would run on our page, so the input is parsed and
    // discarded rather than kept.
    if (match) return match[1] ?? null;
  }
  return null;
}

/**
 * In lifecycle order. An array rather than a bare union so the shared token
 * package can prove it has a badge for every one of them.
 */
export const OFFER_LIFECYCLES = [
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
  'ACTIVE',
  'EXPIRING_SOON',
  'OUT_OF_STOCK',
  'EXPIRED',
  'PAUSED',
  'REJECTED',
  'DISCONTINUED',
] as const;

export type OfferLifecycle = (typeof OFFER_LIFECYCLES)[number];

/** Statuses a person set deliberately; time and stock must not overwrite them. */
const MANUAL_STATUSES: ReadonlySet<OfferLifecycle> = new Set([
  'DRAFT',
  'PENDING_REVIEW',
  'REJECTED',
  'PAUSED',
  'DISCONTINUED',
]);

export interface OfferState {
  status: OfferLifecycle;
  availableFrom: Date;
  availableUntil: Date;
  availableQuantity: number;
}

/**
 * What an approved offer actually is right now.
 *
 * Time and stock move on their own, so a stored status alone goes stale: an
 * offer approved in August is not "active" in October because nobody edited it.
 * A deliberate status - paused, rejected, withdrawn - always wins, because those
 * are decisions and this is only arithmetic.
 */
export function effectiveOfferStatus(offer: OfferState, now: Date = new Date()): OfferLifecycle {
  if (MANUAL_STATUSES.has(offer.status)) return offer.status;

  if (now >= offer.availableUntil) return 'EXPIRED';
  if (now < offer.availableFrom) return 'APPROVED';
  if (offer.availableQuantity <= 0) return 'OUT_OF_STOCK';

  const daysLeft = (offer.availableUntil.getTime() - now.getTime()) / 86_400_000;
  return daysLeft <= EXPIRING_SOON_DAYS ? 'EXPIRING_SOON' : 'ACTIVE';
}

/**
 * Whether an offer may be chosen for a new purchase.
 *
 * Expiry is the point of the availability window. Selecting an expired offer
 * commits the company to a price the vendor stopped honouring, and the failure
 * would surface at invoice time as a mismatch nobody can explain.
 */
export function isSelectable(offer: OfferState, quantity: number, now: Date = new Date()): boolean {
  const status = effectiveOfferStatus(offer, now);
  if (status !== 'ACTIVE' && status !== 'EXPIRING_SOON') return false;
  return quantity > 0 && quantity <= offer.availableQuantity;
}

export const PRODUCT_IMAGE_RULES = {
  min: 1,
  max: 3,
  maxBytes: 500 * 1024,
  mimes: ['image/jpeg', 'image/png', 'image/webp'] as const,
} as const;

/**
 * Whether a set of images lets a product be published.
 *
 * A catalogue entry nobody can see the product in is not a catalogue entry, so
 * one image is the floor; three is the ceiling so a listing page stays a
 * listing page.
 */
export function imageSetProblem(count: number): string | null {
  if (count < PRODUCT_IMAGE_RULES.min) return 'A product needs at least one image before it can be published';
  if (count > PRODUCT_IMAGE_RULES.max) return `A product may have at most ${PRODUCT_IMAGE_RULES.max} images`;
  return null;
}
