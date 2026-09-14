/**
 * Putting stock on the shelf from a phone (Sep 2026; web: inventory/page.tsx).
 *
 * Two acts, kept separate exactly as the API keeps them:
 *  - a new item describes something the company stocks (POST /stock/items);
 *  - adding stock is an adjustment with a positive delta and a reason
 *    (POST /stock/adjust), so every unit has a ledger row behind it.
 *
 * Pure so the rules can be tested without a device.
 */

export interface NewItemForm {
  name: string;
  sku: string;
  unit: string;
  categoryId: string;
  minStock: string;
  unitCost: string;
}

export interface AddStockForm {
  itemId: string;
  locationId: string;
  quantity: string;
  reason: string;
}

export const emptyNewItemForm = (): NewItemForm => ({
  name: '',
  sku: '',
  unit: 'unit',
  categoryId: '',
  minStock: '',
  unitCost: '',
});

export const emptyAddStockForm = (preset?: Partial<AddStockForm>): AddStockForm => ({
  itemId: '',
  locationId: '',
  quantity: '1',
  reason: '',
  ...preset,
});

const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._\-/]*$/;
const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/** The API upper-cases SKUs, so the field does too - what you see is what is saved. */
export function normalizeSku(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '');
}

/** The first problem with a new-item form, or null when it can be sent. */
export function newItemError(form: NewItemForm, canSetPrice: boolean): string | null {
  if (form.name.trim().length < 2) return 'Name the item.';
  const sku = normalizeSku(form.sku.trim());
  if (sku.length < 2) return 'Give it a SKU of at least two characters.';
  if (sku.length > 60) return 'A SKU can be at most 60 characters.';
  if (!SKU_PATTERN.test(sku)) return 'A SKU may use letters, digits and . _ - / only.';
  if (form.unit.trim().length > 20) return 'Keep the unit short - pcs, box, metre.';
  if (!form.categoryId) return 'Choose a category.';
  const min = form.minStock.trim();
  if (min !== '' && !(Number(min) >= 0 && Number(min) <= 1_000_000)) {
    return 'The low-stock level must be zero or more.';
  }
  const cost = form.unitCost.trim();
  if (canSetPrice && cost !== '' && !MONEY_PATTERN.test(cost)) {
    return 'Enter the unit cost as an amount with at most two decimals.';
  }
  return null;
}

/** POST /stock/items body. Blank optionals are omitted; cost only from a cost holder. */
export function buildNewItemPayload(form: NewItemForm, canSetPrice: boolean): Record<string, unknown> {
  const min = form.minStock.trim();
  const cost = form.unitCost.trim();
  return {
    name: form.name.trim(),
    sku: normalizeSku(form.sku.trim()),
    unit: form.unit.trim() || 'unit',
    categoryId: form.categoryId,
    ...(min !== '' ? { minStock: Number(min) } : {}),
    ...(canSetPrice && cost !== '' ? { unitCost: cost, currency: 'INR' } : {}),
  };
}

/** The first problem with an add-stock form, or null when it can be sent. */
export function addStockError(form: AddStockForm): string | null {
  if (!form.itemId) return 'Choose the item.';
  if (!form.locationId) return 'Choose where the stock is.';
  const qty = form.quantity.trim();
  if (!/^\d+$/.test(qty) || Number(qty) < 1) return 'Enter a whole quantity of at least 1.';
  if (Number(qty) > 1_000_000) return 'That quantity is too large.';
  if (form.reason.trim().length < 5) return 'Say why, in a few words - stock additions are audited.';
  if (form.reason.trim().length > 500) return 'Keep the reason under 500 characters.';
  return null;
}

/** POST /stock/adjust body: adding stock is always a positive delta. */
export function buildAddStockPayload(form: AddStockForm) {
  return {
    inventoryItemId: form.itemId,
    stockLocationId: form.locationId,
    delta: Math.abs(Number(form.quantity.trim())),
    reason: form.reason.trim(),
  };
}

/** Quantity-tracked categories first - they are the ones stock is kept in. */
export function sortStockCategories<T extends { defaultTrackingType?: string }>(categories: T[]): T[] {
  return [...categories].sort(
    (a, b) => Number(b.defaultTrackingType === 'QUANTITY') - Number(a.defaultTrackingType === 'QUANTITY'),
  );
}

export type StockEmptyAction = 'new-item' | 'add-stock' | null;

/** What the empty stock screen says, and which action it offers. */
export function stockEmptyState(input: { canAdjust: boolean; itemCount: number }): {
  title: string;
  message: string;
  action: StockEmptyAction;
} {
  if (!input.canAdjust) {
    return {
      title: 'No stock recorded',
      message: 'Receive a purchase order into a location, and levels appear here.',
      action: null,
    };
  }
  if (input.itemCount === 0) {
    return {
      title: 'No stock items yet',
      message: 'Create your first stock item, then add the quantity you have on the shelf.',
      action: 'new-item',
    };
  }
  return {
    title: 'No stock recorded',
    message: 'Add stock to a location, or receive a purchase order into one.',
    action: 'add-stock',
  };
}
