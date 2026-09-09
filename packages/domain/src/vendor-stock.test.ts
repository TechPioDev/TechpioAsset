import { describe, expect, it } from 'vitest';
import {
  crossedLowStock,
  sellableQuantity,
  stockQuantityProblem,
  vendorStockStatus,
} from './vendor-stock';

describe('what a supplier can actually deliver', () => {
  it('takes committed units off what is available', () => {
    // Ten on the shelf, four already promised.
    expect(sellableQuantity(10, 4)).toBe(6);
  });

  it('reports nothing left rather than a negative when a supplier cuts below what is committed', () => {
    expect(sellableQuantity(3, 10)).toBe(0);
  });

  it('judges status on what is sellable, not on the headline number', () => {
    // Fifty units, all fifty spoken for: this offer can supply nobody, and
    // calling it in stock is how a buyer finds out at the worst moment.
    expect(vendorStockStatus({ available: 50, reserved: 50 })).toBe('OUT_OF_STOCK');
    expect(vendorStockStatus({ available: 50, reserved: 0 })).toBe('IN_STOCK');
  });

  it('has no low band until somebody sets one', () => {
    // Inventing a default would put every small supplier permanently in amber.
    expect(vendorStockStatus({ available: 2 })).toBe('IN_STOCK');
    expect(vendorStockStatus({ available: 2, lowStockThreshold: 5 })).toBe('LOW_STOCK');
    expect(vendorStockStatus({ available: 6, lowStockThreshold: 5 })).toBe('IN_STOCK');
  });

  it('treats a threshold of zero as no threshold at all', () => {
    expect(vendorStockStatus({ available: 1, lowStockThreshold: 0 })).toBe('IN_STOCK');
  });

  it('calls the boundary low, not in stock', () => {
    expect(vendorStockStatus({ available: 5, lowStockThreshold: 5 })).toBe('LOW_STOCK');
  });

  it('refuses a negative or fractional quantity', () => {
    expect(stockQuantityProblem(-1)).toMatch(/cannot be negative/);
    expect(stockQuantityProblem(2.5)).toMatch(/whole number/);
    expect(stockQuantityProblem(0)).toBeNull();
    expect(stockQuantityProblem(12)).toBeNull();
  });

  it('warns on the way past the threshold and not every day after', () => {
    // An offer that was already low yesterday is not news today.
    expect(crossedLowStock({ previous: 10, next: 4, lowStockThreshold: 5 })).toBe(true);
    expect(crossedLowStock({ previous: 4, next: 3, lowStockThreshold: 5 })).toBe(false);
    // Restocking is not a warning either.
    expect(crossedLowStock({ previous: 2, next: 40, lowStockThreshold: 5 })).toBe(false);
    // Nothing to cross without a threshold.
    expect(crossedLowStock({ previous: 10, next: 1 })).toBe(false);
  });
});
