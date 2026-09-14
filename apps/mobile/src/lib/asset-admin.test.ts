import { describe, expect, it } from 'vitest';
import {
  buildCreateExtras,
  buildDisposalPayload,
  buildDispatchPayload,
  buildUpdatePayload,
  dateError,
  editFormFromAsset,
  editableStatuses,
  isValidIsoDate,
  mergeFresh,
  priceError,
  problemMessage,
  recipientLabel,
  todayIso,
  transferView,
  validateDisposal,
  validateEditForm,
  type EditableAsset,
} from './asset-admin';

/** Asset administration on mobile - the payloads the web forms send, provable without a phone. */

const asset: EditableAsset = {
  name: 'Dell Latitude 5420',
  assetTag: 'AST-0201',
  brand: 'Dell',
  model: null,
  serialNumber: 'C6081F3',
  macAddress: 'A4:BB:6D:1E:22:9F',
  imei: null,
  specs: { cpu: 'i5', ramGb: '16' },
  status: 'IN_USE',
  condition: 'GOOD',
  purchaseDate: '2025-04-01T00:00:00.000Z',
  warrantyEndDate: null,
  notes: 'Spare charger in drawer',
  version: 7,
  category: { id: 'cat-it' },
  subcategory: { id: 'sub-laptop' },
  office: { id: 'off-mohali' },
};

describe('dates', () => {
  it('accepts real calendar dates only', () => {
    expect(isValidIsoDate('2026-04-01')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2026-02-31')).toBe(false);
    expect(isValidIsoDate('2026-4-1')).toBe(false);
    expect(isValidIsoDate('01/04/2026')).toBe(false);
  });

  it('treats blank as fine and names the field otherwise', () => {
    expect(dateError('', 'Purchased on')).toBeNull();
    expect(dateError('2026-13-01', 'Purchased on')).toMatch(/^Purchased on: use YYYY-MM-DD/);
  });

  it('formats today in local time', () => {
    expect(todayIso(new Date(2026, 8, 4, 23, 30))).toBe('2026-09-04');
  });
});

describe('price', () => {
  it('uses the web rule', () => {
    expect(priceError('')).toBeNull();
    expect(priceError('45000')).toBeNull();
    expect(priceError('45000.50')).toBeNull();
    expect(priceError('45,000')).not.toBeNull();
    expect(priceError('45000.505')).not.toBeNull();
    expect(priceError('-1')).not.toBeNull();
  });
});

describe('edit', () => {
  it('round-trips an untouched form without clearing anything', () => {
    const values = editFormFromAsset(asset);
    const body = buildUpdatePayload(values, { ...asset.specs }, asset);
    expect(body).toEqual({
      name: 'Dell Latitude 5420',
      assetTag: 'AST-0201',
      categoryId: 'cat-it',
      subcategoryId: 'sub-laptop',
      brand: 'Dell',
      model: null,
      serialNumber: 'C6081F3',
      macAddress: 'A4:BB:6D:1E:22:9F',
      imei: null,
      specs: { cpu: 'i5', ramGb: '16' },
      officeId: 'off-mohali',
      purchaseDate: '2025-04-01',
      warrantyEndDate: null,
      condition: 'GOOD',
      status: 'IN_USE',
      version: 7,
    });
    // Notes untouched: not sent, so never rewritten.
    expect(body).not.toHaveProperty('notes');
    // Never a price: that goes through PATCH /assets/:id/price.
    expect(body).not.toHaveProperty('purchaseCost');
  });

  it('sends blank as null, drops cleared specs and sends a changed note', () => {
    const values = { ...editFormFromAsset(asset), brand: '  ', officeId: '', notes: '' };
    const body = buildUpdatePayload(values, { cpu: '', ramGb: '32' }, asset);
    expect(body.brand).toBeNull();
    expect(body.officeId).toBeNull();
    expect(body.specs).toEqual({ ramGb: '32' });
    expect(body.notes).toBeNull();
  });

  it('after a conflict keeps edited fields and takes the rest from the fresh copy', () => {
    const loaded = editFormFromAsset(asset);
    const current = { ...loaded, model: 'Latitude 5420' };
    const fresh = editFormFromAsset({ ...asset, brand: 'DELL', version: 8 });
    const merged = mergeFresh(current, loaded, fresh);
    expect(merged.model).toBe('Latitude 5420');
    expect(merged.brand).toBe('DELL');
  });

  it('surfaces field errors from a problem', () => {
    const e = Object.assign(new Error('Validation failed'), {
      problem: { errors: [{ path: 'imei', message: 'IMEI is 14-16 digits' }] },
    });
    expect(problemMessage(e, 'x')).toBe('IMEI is 14-16 digits');
    expect(problemMessage(new Error('Conflict'), 'x')).toBe('Conflict');
    expect(problemMessage('nope', 'x')).toBe('x');
  });

  it('validates required fields and dates', () => {
    const values = editFormFromAsset(asset);
    expect(validateEditForm(values)).toBeNull();
    expect(validateEditForm({ ...values, name: ' ' })).toMatch(/name/);
    expect(validateEditForm({ ...values, warrantyEndDate: '2026-02-30' })).toMatch(/^Warranty ends/);
  });

  it('keeps custody statuses off the menu unless the asset is already in one', () => {
    expect(editableStatuses('AVAILABLE')).not.toContain('ASSIGNED');
    expect(editableStatuses('AVAILABLE')).not.toContain('IN_USE');
    const inUse = editableStatuses('IN_USE');
    expect(inUse).toContain('IN_USE');
    expect(inUse).not.toContain('ASSIGNED');
  });
});

describe('create extras', () => {
  const input = { officeId: 'off-1', purchaseDate: '2026-01-02', warrantyEndDate: '', purchaseCost: '45000' };

  it('omits blanks and sends the price only with cost permission', () => {
    expect(buildCreateExtras(input, true)).toEqual({
      officeId: 'off-1',
      purchaseDate: '2026-01-02',
      purchaseCost: '45000',
    });
    expect(buildCreateExtras(input, false)).toEqual({ officeId: 'off-1', purchaseDate: '2026-01-02' });
  });
});

describe('transfer', () => {
  const base = { canTransfer: true, status: 'AVAILABLE' as const, holderId: null, hasOpenTransfer: false };

  it('matches the web panel branches', () => {
    expect(transferView({ ...base, canTransfer: false })).toBe('none');
    expect(transferView(base)).toBe('dispatch');
    expect(transferView({ ...base, holderId: 'u1' })).toBe('none');
    expect(transferView({ ...base, status: 'DAMAGED' })).toBe('none');
    expect(transferView({ ...base, status: 'IN_TRANSIT', hasOpenTransfer: true })).toBe('receive');
    expect(transferView({ ...base, status: 'IN_TRANSIT' })).toBe('none');
  });

  it('omits a blank reason', () => {
    expect(buildDispatchPayload('off-2', ' ')).toEqual({ toOfficeId: 'off-2' });
    expect(buildDispatchPayload('off-2', 'New starter')).toEqual({ toOfficeId: 'off-2', reason: 'New starter' });
  });
});

describe('disposal', () => {
  const input = {
    method: 'SOLD' as const,
    disposedAt: '2026-09-01',
    proceeds: '',
    recipient: '',
    reason: 'Beyond economical repair',
  };

  it('validates date, proceeds and reason', () => {
    expect(validateDisposal(input, '2026-09-14')).toBeNull();
    expect(validateDisposal({ ...input, disposedAt: '2026-09-15' }, '2026-09-14')).toMatch(/future/);
    expect(validateDisposal({ ...input, disposedAt: 'soon' }, '2026-09-14')).toMatch(/YYYY-MM-DD/);
    expect(validateDisposal({ ...input, proceeds: '12,000' }, '2026-09-14')).toMatch(/plain amount/);
    expect(validateDisposal({ ...input, reason: 'broken' }, '2026-09-14')).toMatch(/10 characters/);
  });

  it('omits blank optional parts', () => {
    expect(buildDisposalPayload(input)).toEqual({
      method: 'SOLD',
      disposedAt: '2026-09-01',
      reason: 'Beyond economical repair',
    });
    expect(buildDisposalPayload({ ...input, proceeds: '12000', recipient: 'Cashify' })).toMatchObject({
      proceeds: '12000',
      recipient: 'Cashify',
    });
  });

  it('labels the recipient by method', () => {
    expect(recipientLabel('DONATED')).toBe('Donated to');
    expect(recipientLabel('SOLD')).toBe('Buyer');
    expect(recipientLabel('SCRAPPED')).toBe('Recipient (optional)');
  });
});
