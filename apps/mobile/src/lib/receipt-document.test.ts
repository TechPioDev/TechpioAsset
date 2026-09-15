import { describe, expect, it } from 'vitest';
import { assetReceipt, type ReceiptAssetInput } from '@techpioasset/domain';
import { receiptHtml, receiptText } from './receipt-document';

const fmt = (iso: string) => iso.slice(0, 10);
const now = new Date('2026-09-15T10:00:00Z');

function asset(overrides: Partial<ReceiptAssetInput> = {}): ReceiptAssetInput {
  return {
    assetTag: 'PT-LAP-0042',
    name: 'ThinkPad <b>T14</b>',
    brand: 'Lenovo',
    model: 'T14',
    serialNumber: 'SN&1',
    office: { name: 'MOHALI' },
    category: { name: 'Laptop' },
    assignedUser: null,
    assignments: [
      {
        assignedAt: '2026-08-01T09:00:00Z',
        returnedAt: null,
        conditionOut: 'GOOD',
        acknowledgedAt: null,
        expectedReturnAt: null,
        accessoriesIssued: '<script>alert("x")</script>',
        assignedBy: null,
        user: { email: 'a@example.com', profile: { firstName: "O'Neil", lastName: 'Rao' } },
      },
    ],
    ...overrides,
  };
}

describe('receiptHtml', () => {
  it('escapes every user-typed value', () => {
    const html = receiptHtml(assetReceipt(asset(), fmt, now));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>T14</b>');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('ThinkPad &lt;b&gt;T14&lt;/b&gt;');
    expect(html).toContain('SN&amp;1');
    expect(html).toContain('Signature — O&#39;Neil Rao (recipient)');
  });

  it('carries every line of the domain model, in order', () => {
    const receipt = assetReceipt(asset(), fmt, now);
    const html = receiptHtml(receipt);
    const labels = [
      receipt.title,
      'Device',
      ...receipt.deviceRows.map((r) => r.label),
      'Handover',
      ...receipt.handoverRows!.map((r) => r.label),
      'I confirm',
      'Signature — issued by, and date',
      'Generated from pioassets.com',
    ];
    let at = html.indexOf('<body>');
    for (const label of labels) {
      const next = html.indexOf(label, at);
      expect(next, label).toBeGreaterThan(at);
      at = next;
    }
  });

  it('prints the device-only notice and no signature lines when nobody holds it', () => {
    const html = receiptHtml(assetReceipt(asset({ assignments: [] }), fmt, now));
    expect(html).toContain('This asset is not currently issued to anyone.');
    expect(html).not.toContain('Handover');
    expect(html).not.toContain('Signature');
  });
});

describe('receiptText', () => {
  it('is readable plain text, unescaped', () => {
    const text = receiptText(assetReceipt(asset(), fmt, now));
    expect(text.split('\n').slice(0, 4)).toEqual([
      'Equipment handover receipt',
      'PioAssets · generated 2026-09-15',
      '',
      'DEVICE',
    ]);
    expect(text).toContain('Name: ThinkPad <b>T14</b>');
    expect(text).toContain('Issued to: O\'Neil Rao');
    expect(text).toContain('HANDOVER');
    expect(text.trimEnd().endsWith('independently of this paper copy.')).toBe(true);
  });

  it('leads with the notice for an unissued device', () => {
    const text = receiptText(assetReceipt(asset({ assignments: [] }), fmt, now));
    expect(text).toContain('This asset is not currently issued to anyone.');
    expect(text).not.toContain('HANDOVER');
  });
});
