import { describe, expect, it } from 'vitest';
import { assetReceipt, type ReceiptAssetInput } from './asset-receipt';

/**
 * The handover receipt's wording, pinned. The web page prints it and the phone
 * prints it; a change here is a change to both documents.
 */

const fmt = (iso: string) => iso.slice(0, 10);
const now = new Date('2026-09-15T10:00:00Z');

function asset(overrides: Partial<ReceiptAssetInput> = {}): ReceiptAssetInput {
  return {
    assetTag: 'PT-LAP-0042',
    name: 'ThinkPad T14',
    brand: 'Lenovo',
    model: 'T14 Gen 4',
    serialNumber: 'PF3ABC12',
    office: { name: 'MOHALI' },
    category: { name: 'Laptop' },
    assignedUser: { email: 'asha@example.com', profile: { firstName: 'Asha', lastName: 'Rao' } },
    assignments: [
      {
        assignedAt: '2026-08-01T09:00:00Z',
        returnedAt: null,
        conditionOut: 'LIKE_NEW',
        acknowledgedAt: '2026-08-02T09:00:00Z',
        expectedReturnAt: null,
        accessoriesIssued: 'Charger, bag',
        assignedBy: { profile: { firstName: 'Ravi', lastName: 'Kumar' } },
        user: { email: 'asha@example.com', profile: { firstName: 'Asha', lastName: 'Rao' } },
      },
    ],
    ...overrides,
  };
}

describe('assetReceipt', () => {
  it('builds the full receipt for an open assignment', () => {
    const r = assetReceipt(asset(), fmt, now);
    expect(r.title).toBe('Equipment handover receipt');
    expect(r.generatedLine).toBe('PioAssets · generated 2026-09-15');
    expect(r.notIssuedNotice).toBeNull();
    expect(r.deviceRows).toEqual([
      { label: 'Asset tag', value: 'PT-LAP-0042' },
      { label: 'Name', value: 'ThinkPad T14' },
      { label: 'Make / model', value: 'Lenovo T14 Gen 4' },
      { label: 'Serial number', value: 'PF3ABC12' },
      { label: 'Category', value: 'Laptop' },
      { label: 'Office', value: 'MOHALI' },
    ]);
    expect(r.handoverRows).toEqual([
      { label: 'Issued to', value: 'Asha Rao' },
      { label: 'Issued by', value: 'Ravi Kumar' },
      { label: 'Issued on', value: '2026-08-01' },
      { label: 'Condition at issue', value: 'Like new' },
      { label: 'Accessories', value: 'Charger, bag' },
      { label: 'Expected return', value: 'Until further notice' },
      { label: 'Receipt confirmed', value: 'Yes — 2026-08-02 (in app)' },
    ]);
    expect(r.confirmation).toBe(
      'I confirm that I have received the equipment listed above in the stated condition, and that I will return it on request or when I leave the company.',
    );
    expect(r.signatureLabels).toEqual(['Signature — Asha Rao (recipient)', 'Signature — issued by, and date']);
    expect(r.footer).toBe(
      'Generated from pioassets.com — PT-LAP-0042, issued 2026-08-01. In-app receipt confirmation is recorded in the audit log independently of this paper copy.',
    );
  });

  it('documents the device only when nobody holds it', () => {
    const r = assetReceipt(asset({ assignedUser: null, assignments: [] }), fmt, now);
    expect(r.notIssuedNotice).toBe(
      'This asset is not currently issued to anyone. This receipt documents the device only.',
    );
    expect(r.handoverRows).toBeNull();
    expect(r.confirmation).toBeNull();
    expect(r.signatureLabels).toBeNull();
    expect(r.footer).toBe(
      'Generated from pioassets.com — PT-LAP-0042. In-app receipt confirmation is recorded in the audit log independently of this paper copy.',
    );
  });

  it('ignores returned assignments', () => {
    const [a] = asset().assignments;
    const r = assetReceipt(asset({ assignments: [{ ...a!, returnedAt: '2026-09-01T00:00:00Z' }] }), fmt, now);
    expect(r.handoverRows).toBeNull();
  });

  it('says a shared brand/model word once, and dashes what is missing', () => {
    const r = assetReceipt(
      asset({ brand: 'Dell', model: 'Dell', serialNumber: null, office: null, category: undefined }),
      fmt,
      now,
    );
    expect(r.deviceRows.find((x) => x.label === 'Make / model')?.value).toBe('Dell');
    expect(r.deviceRows.slice(3).map((x) => x.value)).toEqual(['—', '—', '—']);
    const none = assetReceipt(asset({ brand: null, model: null }), fmt, now);
    expect(none.deviceRows[2]?.value).toBe('—');
  });

  it('falls back through holder, email, and unconfirmed wording', () => {
    const [a] = asset().assignments;
    const r = assetReceipt(
      asset({
        assignedUser: null,
        assignments: [
          {
            ...a!,
            user: { email: 'x@example.com', profile: null },
            assignedBy: null,
            acknowledgedAt: null,
            accessoriesIssued: null,
            expectedReturnAt: '2026-12-31T00:00:00Z',
            conditionOut: 'NEEDS_REPAIR',
          },
        ],
      }),
      fmt,
      now,
    );
    const values = Object.fromEntries(r.handoverRows!.map((x) => [x.label, x.value]));
    expect(values['Issued to']).toBe('x@example.com');
    expect(values['Issued by']).toBe('—');
    expect(values['Condition at issue']).toBe('Needs repair');
    expect(values['Accessories']).toBe('None recorded');
    expect(values['Expected return']).toBe('2026-12-31');
    expect(values['Receipt confirmed']).toBe('Not yet confirmed in app');

    // With no user on the open assignment, the asset's own holder names it.
    const imported = assetReceipt(asset({ assignments: [{ ...a!, user: null }] }), fmt, now);
    expect(imported.handoverRows![0]?.value).toBe('Asha Rao');
    const nobody = assetReceipt(asset({ assignedUser: null, assignments: [{ ...a!, user: null }] }), fmt, now);
    expect(nobody.handoverRows![0]?.value).toBe('—');
  });
});
