/**
 * What a supplier can actually deliver right now (v2.51).
 *
 * Deliberately not the warehouse model. StockLevel keys quantity on an item at
 * a location we own; a supplier's availability is their stock in their
 * building, which we do not hold and cannot count. Reusing that model would
 * record us as holding things we do not have.
 *
 * So this is small on purpose: what the supplier says they can supply, how much
 * of it buyers have already committed to, and the difference.
 */

export const VENDOR_STOCK_STATUSES = ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const;
export type VendorStockStatus = (typeof VENDOR_STOCK_STATUSES)[number];

export const VENDOR_STOCK_LABELS: Readonly<Record<VendorStockStatus, string>> = {
  IN_STOCK: 'In stock',
  LOW_STOCK: 'Low stock',
  OUT_OF_STOCK: 'Out of stock',
};

/**
 * What is left for the next buyer.
 *
 * Reserved units are spoken for: a buyer has chosen this offer and not yet
 * ordered. Showing them as available is how two buyers are promised the same
 * ten laptops. Floored at zero, because a supplier lowering its quantity below
 * what is already committed is a real thing that happens and the answer is
 * "nothing left", not a negative number.
 */
export function sellableQuantity(available: number, reserved: number): number {
  return Math.max(0, available - reserved);
}

/**
 * In stock, low, or out.
 *
 * Judged on what is sellable rather than on the headline quantity: an offer
 * with fifty units and fifty reserved can supply nobody, and calling that
 * "in stock" is how a buyer finds out at the worst moment.
 *
 * With no threshold set there is no low band - an offer is either sellable or
 * it is not. Inventing a default would put every small supplier permanently in
 * amber.
 */
export function vendorStockStatus(input: {
  available: number;
  reserved?: number;
  lowStockThreshold?: number | null;
}): VendorStockStatus {
  const sellable = sellableQuantity(input.available, input.reserved ?? 0);
  if (sellable <= 0) return 'OUT_OF_STOCK';
  const threshold = input.lowStockThreshold ?? null;
  if (threshold !== null && threshold > 0 && sellable <= threshold) return 'LOW_STOCK';
  return 'IN_STOCK';
}

/**
 * Whether a quantity change can be accepted.
 *
 * Negative stock is meaningless and the contract already refuses it at the
 * edge; this is the same rule stated where the domain can be asked directly,
 * for callers that do not come through the HTTP schema - an import, a job, a
 * future bulk upload.
 */
export function stockQuantityProblem(next: number): string | null {
  if (!Number.isFinite(next) || !Number.isInteger(next)) {
    return 'Quantity must be a whole number';
  }
  if (next < 0) return 'Quantity cannot be negative';
  return null;
}

/**
 * Whether the supplier should be warned that an offer is running down.
 *
 * Only where a threshold was set, and only on the way past it: an offer that
 * was already low yesterday is not news today.
 */
export function crossedLowStock(input: {
  previous: number;
  next: number;
  reserved?: number;
  lowStockThreshold?: number | null;
}): boolean {
  const threshold = input.lowStockThreshold ?? null;
  if (threshold === null || threshold <= 0) return false;
  const before = vendorStockStatus({
    available: input.previous,
    reserved: input.reserved ?? 0,
    lowStockThreshold: threshold,
  });
  const after = vendorStockStatus({
    available: input.next,
    reserved: input.reserved ?? 0,
    lowStockThreshold: threshold,
  });
  return before === 'IN_STOCK' && after === 'LOW_STOCK';
}
