import { describe, expect, it } from 'vitest';
import { createInvoiceSchema } from '@techpioasset/contracts';
import {
  buildCreateInvoicePayload,
  computedLineTotal,
  emptyInvoiceDraft,
  emptyLine,
  formatInvoiceMoney,
  previewInvoice,
  previewWarnings,
  validateInvoiceDraft,
  type InvoiceDraft,
} from './invoice-entry';

function draft(over: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return {
    ...emptyInvoiceDraft('INR', '2026-09-14'),
    vendorId: 'vendor-1',
    invoiceNumber: ' INV-001 ',
    lines: [
      { description: 'Laptop', quantity: '2', unitPrice: '45000.50', lineTotal: '' },
      { description: 'Mouse', quantity: '3', unitPrice: '0.10', lineTotal: '' },
    ],
    ...over,
  };
}

describe('line totals', () => {
  it('is quantity x unit price in exact decimals', () => {
    // 3 x 0.10 is 0.30000000000000004 in floating point.
    expect(
      computedLineTotal({ description: '', quantity: '3', unitPrice: '0.10', lineTotal: '' }),
    ).toBe('0.30');
    expect(
      computedLineTotal({ description: '', quantity: '2.5', unitPrice: '33.33', lineTotal: '' }),
    ).toBe('83.33');
  });

  it('waits while a box is not a number yet', () => {
    expect(computedLineTotal({ ...emptyLine(), unitPrice: '' })).toBeNull();
    expect(computedLineTotal({ ...emptyLine(), quantity: 'two', unitPrice: '10' })).toBeNull();
  });
});

describe('previewInvoice', () => {
  it('sums lines and applies discount, tax, shipping and other charges', () => {
    const p = previewInvoice(
      draft({ discount: '1.30', tax: '16200', shipping: '500', otherCharges: '99.99' }),
    );
    expect(p.lineTotals).toEqual(['90001.00', '0.30']);
    expect(p.subtotal).toBe('90001.30');
    // 90001.30 - 1.30 + 16200 + 500 + 99.99
    expect(p.total).toBe('106799.99');
  });

  it('sends a figure as printed on the bill when one is typed', () => {
    const p = previewInvoice(draft({ subtotal: '90000', total: '90000' }));
    expect(p.subtotal).toBe('90000');
    expect(p.total).toBe('90000');
    expect(p.computedSubtotal).toBe('90001.30');
  });

  it('has no total while a line is incomplete', () => {
    const p = previewInvoice(draft({ lines: [emptyLine()] }));
    expect(p.subtotal).toBeNull();
    expect(p.total).toBeNull();
  });
});

describe('previewWarnings', () => {
  it('uses the verification engine wording for figures that do not add up', () => {
    expect(
      previewWarnings(
        draft({
          lines: [{ description: 'Laptop', quantity: '2', unitPrice: '100', lineTotal: '150' }],
          subtotal: '140',
          total: '999',
        }),
      ),
    ).toEqual([
      'Line 1: quantity × unit price is 200.00, invoice says 150.00',
      'Line totals sum to 150.00, subtotal says 140.00',
      'Computed total is 140.00, invoice says 999.00',
    ]);
  });

  it('forgives a one-paisa rounding difference, as the server does', () => {
    expect(
      previewWarnings(
        draft({
          lines: [{ description: 'A', quantity: '3', unitPrice: '33.33', lineTotal: '100.00' }],
        }),
      ),
    ).toEqual([]);
  });
});

describe('validateInvoiceDraft', () => {
  it('accepts a complete draft', () => {
    expect(validateInvoiceDraft(draft())).toBeNull();
  });

  it.each([
    [{ vendorId: '' }, 'Choose a vendor'],
    [{ invoiceNumber: '  ' }, 'Enter the invoice number'],
    [{ invoiceDate: '2026-02-31' }, 'Invoice date: use YYYY-MM-DD, e.g. 2026-04-01'],
    [{ dueDate: '14/09/2026' }, 'Due date: use YYYY-MM-DD, e.g. 2026-04-01'],
    [{ currency: 'RS' }, 'Currency: use a three-letter code, e.g. INR'],
    [{ lines: [] }, 'Add at least one line'],
    [{ tax: '-5' }, 'Tax: Enter a non-negative amount with at most two decimal places'],
    [
      { discount: '1.999' },
      'Discount: Enter a non-negative amount with at most two decimal places',
    ],
    [{ discount: '999999' }, 'Discount may not exceed subtotal'],
  ] as [Partial<InvoiceDraft>, string][])('refuses %o', (over, message) => {
    expect(validateInvoiceDraft(draft(over))).toBe(message);
  });

  it('names the line that is wrong', () => {
    const lines = draft().lines;
    expect(
      validateInvoiceDraft(draft({ lines: [lines[0]!, { ...lines[1]!, description: '' }] })),
    ).toBe('Line 2: describe the item');
    expect(validateInvoiceDraft(draft({ lines: [{ ...lines[0]!, quantity: '0' }] }))).toBe(
      'Line 1: the quantity must be more than 0',
    );
    expect(validateInvoiceDraft(draft({ lines: [{ ...lines[0]!, unitPrice: '' }] }))).toBe(
      'Line 1: enter the unit price',
    );
    expect(validateInvoiceDraft(draft({ lines: [{ ...lines[0]!, unitPrice: '12,000' }] }))).toBe(
      'Line 1 unit price: Enter a non-negative amount with at most two decimal places',
    );
  });

  it('refuses more lines than the server takes', () => {
    expect(
      validateInvoiceDraft(draft({ lines: Array.from({ length: 201 }, () => draft().lines[0]!) })),
    ).toBe('An invoice can have at most 200 lines');
  });
});

describe('buildCreateInvoicePayload', () => {
  it('builds a body the server schema accepts, omitting blanks', () => {
    const payload = buildCreateInvoicePayload(
      draft({ currency: 'inr', tax: '16200.09', purchaseOrderNumber: ' PO-7 ', notes: '' }),
    );
    expect(payload).toEqual({
      vendorId: 'vendor-1',
      invoiceNumber: 'INV-001',
      invoiceDate: '2026-09-14',
      currency: 'INR',
      subtotal: '90001.30',
      total: '106201.39',
      tax: '16200.09',
      purchaseOrderNumber: 'PO-7',
      lines: [
        {
          lineNumber: 1,
          description: 'Laptop',
          quantity: '2',
          unitPrice: '45000.50',
          lineTotal: '90001.00',
        },
        {
          lineNumber: 2,
          description: 'Mouse',
          quantity: '3',
          unitPrice: '0.10',
          lineTotal: '0.30',
        },
      ],
    });
    expect(createInvoiceSchema.safeParse(payload).success).toBe(true);
  });

  it('carries a linked purchase order and the optional dates', () => {
    const payload = buildCreateInvoicePayload(
      draft({
        purchaseOrderId: 'po-1',
        purchaseOrderNumber: 'PO-1',
        dueDate: '2026-10-14',
        purchaseDate: '2026-09-01',
      }),
    );
    expect(payload).toMatchObject({
      purchaseOrderId: 'po-1',
      purchaseOrderNumber: 'PO-1',
      dueDate: '2026-10-14',
      purchaseDate: '2026-09-01',
    });
    expect(createInvoiceSchema.safeParse(payload).success).toBe(true);
  });
});

describe('formatInvoiceMoney', () => {
  it('uses Indian grouping and paise for rupees', () => {
    expect(formatInvoiceMoney('106201.39', 'INR')).toBe('₹1,06,201.39');
    expect(formatInvoiceMoney('90000', 'INR')).toBe('₹90,000.00');
  });

  it('keeps the code and Western grouping for other currencies', () => {
    expect(formatInvoiceMoney('1234567.5', 'USD')).toBe('USD 1,234,567.50');
  });

  it('shows a dash while there is nothing to show', () => {
    expect(formatInvoiceMoney(null, 'INR')).toBe('—');
  });
});
