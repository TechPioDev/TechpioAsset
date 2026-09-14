import { describe, expect, it } from 'vitest';
import {
  addStockError,
  buildAddStockPayload,
  buildNewItemPayload,
  emptyAddStockForm,
  emptyNewItemForm,
  newItemError,
  normalizeSku,
  sortStockCategories,
  stockEmptyState,
} from './stock-entry';

const valid = { ...emptyNewItemForm(), name: 'HDMI cable', sku: 'cab-hdmi', categoryId: 'cat1' };

describe('new stock item', () => {
  it('upper-cases the SKU and strips spaces', () => {
    expect(normalizeSku('cab hdmi-2m')).toBe('CABHDMI-2M');
  });

  it('names the first problem', () => {
    expect(newItemError({ ...valid, name: ' ' }, false)).toMatch(/Name/);
    expect(newItemError({ ...valid, sku: 'x' }, false)).toMatch(/SKU/);
    expect(newItemError({ ...valid, sku: 'bad*sku' }, false)).toMatch(/letters/);
    expect(newItemError({ ...valid, categoryId: '' }, false)).toMatch(/category/);
    expect(newItemError({ ...valid, minStock: '-1' }, false)).toMatch(/low-stock/);
    expect(newItemError(valid, false)).toBeNull();
  });

  it('checks the cost only for someone who may enter it', () => {
    expect(newItemError({ ...valid, unitCost: '12.345' }, true)).toMatch(/cost/);
    expect(newItemError({ ...valid, unitCost: '12.345' }, false)).toBeNull();
  });

  it('omits blanks and never sends a cost without the permission', () => {
    const withCost = { ...valid, unitCost: '450', minStock: '3', unit: ' pcs ' };
    expect(buildNewItemPayload(withCost, false)).toEqual({
      name: 'HDMI cable',
      sku: 'CAB-HDMI',
      unit: 'pcs',
      categoryId: 'cat1',
      minStock: 3,
    });
    expect(buildNewItemPayload(withCost, true)).toMatchObject({ unitCost: '450', currency: 'INR' });
    expect(buildNewItemPayload({ ...valid, unit: '' }, false)).not.toHaveProperty('minStock');
    expect(buildNewItemPayload({ ...valid, unit: '' }, false).unit).toBe('unit');
  });

  it('puts quantity-tracked categories first', () => {
    const sorted = sortStockCategories([
      { id: 'a', defaultTrackingType: 'INDIVIDUAL' },
      { id: 'b', defaultTrackingType: 'QUANTITY' },
    ]);
    expect(sorted.map((c) => c.id)).toEqual(['b', 'a']);
  });
});

describe('add stock', () => {
  const form = emptyAddStockForm({ itemId: 'i1', locationId: 'l1', quantity: '12', reason: 'Opening count' });

  it('requires item, location, a whole positive quantity and a reason', () => {
    expect(addStockError({ ...form, itemId: '' })).toMatch(/item/);
    expect(addStockError({ ...form, locationId: '' })).toMatch(/where/);
    expect(addStockError({ ...form, quantity: '0' })).toMatch(/whole/);
    expect(addStockError({ ...form, quantity: '1.5' })).toMatch(/whole/);
    expect(addStockError({ ...form, quantity: '-3' })).toMatch(/whole/);
    expect(addStockError({ ...form, reason: 'ok' })).toMatch(/audited/);
    expect(addStockError(form)).toBeNull();
  });

  it('posts a positive adjustment', () => {
    expect(buildAddStockPayload(form)).toEqual({
      inventoryItemId: 'i1',
      stockLocationId: 'l1',
      delta: 12,
      reason: 'Opening count',
    });
  });
});

describe('empty stock screen', () => {
  it('invites the first item only from someone who can create one', () => {
    expect(stockEmptyState({ canAdjust: false, itemCount: 0 }).action).toBeNull();
    expect(stockEmptyState({ canAdjust: true, itemCount: 0 }).action).toBe('new-item');
    expect(stockEmptyState({ canAdjust: true, itemCount: 4 }).action).toBe('add-stock');
  });
});
