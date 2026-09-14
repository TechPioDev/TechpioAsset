import {
  computeInvoiceTotal,
  computeLineTotal,
  roundMoney,
  sumMoney,
  totalsAgree,
} from '@techpioasset/domain';
import { isValidIsoDate } from './asset-admin';

/**
 * Manual invoice entry on the phone: the rules behind invoice/new.
 *
 * POST /invoices has always existed (the AI-off path); nothing called it. The
 * screen is thin and everything that decides what is sent lives here, so it
 * can be proven without a device. It mirrors apps/web/src/lib/invoice-entry.ts
 * line for line - the two forms send the same body.
 *
 * Every figure is exact decimal arithmetic from @techpioasset/domain, the same
 * functions the server's verification engine runs. The totals shown are a
 * preview only: the server recomputes and records any mismatch for review, it
 * does not trust these.
 */

/** contracts moneyString: non-negative, at most 12 digits and two decimals. */
export const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
/** Its own words, so a phone and the server say the same thing. */
export const MONEY_HINT = 'Enter a non-negative amount with at most two decimal places';
/** InvoiceLine.quantity is Decimal(14,3). */
export const QUANTITY_PATTERN = /^\d{1,11}(\.\d{1,3})?$/;
export const MAX_LINES = 200;

export interface InvoiceLineDraft {
  description: string;
  quantity: string;
  unitPrice: string;
  /** As printed on the bill. Blank means quantity x unit price. */
  lineTotal: string;
}

export interface InvoiceDraft {
  vendorId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  purchaseDate: string;
  currency: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  discount: string;
  tax: string;
  shipping: string;
  otherCharges: string;
  /** Blank means the sum of the lines. */
  subtotal: string;
  /** Blank means subtotal - discount + tax + shipping + other. */
  total: string;
  notes: string;
  lines: InvoiceLineDraft[];
}

export const emptyLine = (): InvoiceLineDraft => ({
  description: '',
  quantity: '1',
  unitPrice: '',
  lineTotal: '',
});

export function emptyInvoiceDraft(currency: string, today: string): InvoiceDraft {
  return {
    vendorId: '',
    invoiceNumber: '',
    invoiceDate: today,
    dueDate: '',
    purchaseDate: '',
    currency,
    purchaseOrderId: '',
    purchaseOrderNumber: '',
    discount: '',
    tax: '',
    shipping: '',
    otherCharges: '',
    subtotal: '',
    total: '',
    notes: '',
    lines: [emptyLine()],
  };
}

const isMoney = (v: string) => MONEY_PATTERN.test(v.trim());

/** quantity x unit price, or null while either box is not a number yet. */
export function computedLineTotal(line: InvoiceLineDraft): string | null {
  if (!QUANTITY_PATTERN.test(line.quantity.trim()) || !isMoney(line.unitPrice)) return null;
  return computeLineTotal(line.quantity.trim(), line.unitPrice.trim()).toFixed(2);
}

/** What the line will be saved with: the stated total when given, else the computed one. */
export function effectiveLineTotal(line: InvoiceLineDraft): string | null {
  const stated = line.lineTotal.trim();
  if (stated) return isMoney(stated) ? stated : null;
  return computedLineTotal(line);
}

export interface InvoicePreview {
  /** Per line, what it will be saved with (null while incomplete). */
  lineTotals: (string | null)[];
  /** Sum of the line totals, null while any line is incomplete. */
  computedSubtotal: string | null;
  /** From the subtotal that will be sent; null while incomplete. */
  computedTotal: string | null;
  /** What will actually be sent. */
  subtotal: string | null;
  total: string | null;
}

const orZero = (v: string) => (v.trim() ? v.trim() : '0');

export function previewInvoice(draft: InvoiceDraft): InvoicePreview {
  const lineTotals = draft.lines.map(effectiveLineTotal);
  const complete = lineTotals.length > 0 && lineTotals.every((t): t is string => t !== null);
  const computedSubtotal = complete ? sumMoney(lineTotals).toFixed(2) : null;

  const statedSubtotal = draft.subtotal.trim();
  const subtotal = statedSubtotal
    ? isMoney(statedSubtotal)
      ? statedSubtotal
      : null
    : computedSubtotal;

  let computedTotal: string | null = null;
  const charges = [draft.discount, draft.tax, draft.shipping, draft.otherCharges];
  if (subtotal !== null && charges.every((v) => !v.trim() || isMoney(v))) {
    try {
      computedTotal = computeInvoiceTotal({
        subtotal,
        discount: orZero(draft.discount),
        tax: orZero(draft.tax),
        shipping: orZero(draft.shipping),
        otherCharges: orZero(draft.otherCharges),
      }).toFixed(2);
    } catch {
      // Discount larger than the subtotal; validateInvoiceDraft says so.
      computedTotal = null;
    }
  }

  const statedTotal = draft.total.trim();
  const total = statedTotal ? (isMoney(statedTotal) ? statedTotal : null) : computedTotal;
  return { lineTotals, computedSubtotal, computedTotal, subtotal, total };
}

/**
 * Figures that do not add up. Not blocking: a bill can be wrong, and entering
 * it as printed is how that gets caught - the server records the same finding
 * (same wording as the verification engine) and the invoice goes to review.
 */
export function previewWarnings(draft: InvoiceDraft): string[] {
  const warnings: string[] = [];
  draft.lines.forEach((line, i) => {
    const stated = line.lineTotal.trim();
    const computed = computedLineTotal(line);
    if (stated && isMoney(stated) && computed !== null && !totalsAgree(stated, computed)) {
      warnings.push(
        `Line ${i + 1}: quantity × unit price is ${computed}, invoice says ${roundMoney(stated).toFixed(2)}`,
      );
    }
  });
  const p = previewInvoice(draft);
  const statedSubtotal = draft.subtotal.trim();
  if (
    statedSubtotal &&
    isMoney(statedSubtotal) &&
    p.computedSubtotal !== null &&
    !totalsAgree(statedSubtotal, p.computedSubtotal)
  ) {
    warnings.push(
      `Line totals sum to ${p.computedSubtotal}, subtotal says ${roundMoney(statedSubtotal).toFixed(2)}`,
    );
  }
  const statedTotal = draft.total.trim();
  if (
    statedTotal &&
    isMoney(statedTotal) &&
    p.computedTotal !== null &&
    !totalsAgree(statedTotal, p.computedTotal)
  ) {
    warnings.push(
      `Computed total is ${p.computedTotal}, invoice says ${roundMoney(statedTotal).toFixed(2)}`,
    );
  }
  return warnings;
}

function moneyFieldError(value: string, label: string): string | null {
  const v = value.trim();
  if (!v || isMoney(v)) return null;
  return `${label}: ${MONEY_HINT}`;
}

function optionalDateError(value: string, label: string): string | null {
  const v = value.trim();
  if (!v || isValidIsoDate(v)) return null;
  return `${label}: use YYYY-MM-DD, e.g. 2026-04-01`;
}

/** The first thing the server would refuse, or null when the draft can be sent. */
export function validateInvoiceDraft(draft: InvoiceDraft): string | null {
  if (!draft.vendorId) return 'Choose a vendor';
  const number = draft.invoiceNumber.trim();
  if (!number) return 'Enter the invoice number';
  if (number.length > 100) return 'The invoice number can be at most 100 characters';
  if (!isValidIsoDate(draft.invoiceDate.trim()))
    return 'Invoice date: use YYYY-MM-DD, e.g. 2026-04-01';
  const dates =
    optionalDateError(draft.dueDate, 'Due date') ??
    optionalDateError(draft.purchaseDate, 'Purchase date');
  if (dates) return dates;
  if (!/^[A-Za-z]{3}$/.test(draft.currency.trim()))
    return 'Currency: use a three-letter code, e.g. INR';
  if (draft.purchaseOrderNumber.trim().length > 64)
    return 'The PO number can be at most 64 characters';
  if (draft.notes.trim().length > 2000) return 'Notes can be at most 2000 characters';

  // Same message as createInvoiceSchema.
  if (draft.lines.length === 0) return 'Add at least one line';
  if (draft.lines.length > MAX_LINES) return `An invoice can have at most ${MAX_LINES} lines`;
  for (const [i, line] of draft.lines.entries()) {
    const n = i + 1;
    if (!line.description.trim()) return `Line ${n}: describe the item`;
    if (line.description.trim().length > 500)
      return `Line ${n}: the description can be at most 500 characters`;
    if (!QUANTITY_PATTERN.test(line.quantity.trim()))
      return `Line ${n}: enter a quantity, e.g. 2 or 2.5`;
    if (Number(line.quantity) <= 0) return `Line ${n}: the quantity must be more than 0`;
    const price = line.unitPrice.trim()
      ? moneyFieldError(line.unitPrice, `Line ${n} unit price`)
      : `Line ${n}: enter the unit price`;
    if (price) return price;
    const lineTotal = moneyFieldError(line.lineTotal, `Line ${n} total`);
    if (lineTotal) return lineTotal;
  }

  for (const [value, label] of [
    [draft.discount, 'Discount'],
    [draft.tax, 'Tax'],
    [draft.shipping, 'Shipping'],
    [draft.otherCharges, 'Other charges'],
    [draft.subtotal, 'Subtotal'],
    [draft.total, 'Total'],
  ] as const) {
    const problem = moneyFieldError(value, label);
    if (problem) return problem;
  }

  const p = previewInvoice(draft);
  // A computed figure still has to fit the column the server stores it in.
  if (p.subtotal === null || !isMoney(p.subtotal)) return `Subtotal: ${MONEY_HINT}`;
  if (p.computedTotal === null && !draft.total.trim()) return 'Discount may not exceed subtotal';
  if (p.total === null || !isMoney(p.total)) return `Total: ${MONEY_HINT}`;
  return null;
}

export interface CreateInvoicePayload {
  vendorId: string;
  invoiceNumber: string;
  invoiceDate: string;
  currency: string;
  subtotal: string;
  total: string;
  lines: {
    lineNumber: number;
    description: string;
    quantity: string;
    unitPrice: string;
    lineTotal: string;
  }[];
  dueDate?: string;
  purchaseDate?: string;
  purchaseOrderId?: string;
  purchaseOrderNumber?: string;
  discount?: string;
  tax?: string;
  shipping?: string;
  otherCharges?: string;
  notes?: string;
}

/**
 * The POST /invoices body. Call only after validateInvoiceDraft returned null.
 * Blank optional fields are omitted so the schema's own defaults apply.
 */
export function buildCreateInvoicePayload(draft: InvoiceDraft): CreateInvoicePayload {
  const p = previewInvoice(draft);
  const optional = (key: string, value: string) => (value.trim() ? { [key]: value.trim() } : {});
  return {
    vendorId: draft.vendorId,
    invoiceNumber: draft.invoiceNumber.trim(),
    invoiceDate: draft.invoiceDate.trim(),
    currency: draft.currency.trim().toUpperCase(),
    subtotal: p.subtotal ?? '',
    total: p.total ?? '',
    lines: draft.lines.map((line, i) => ({
      lineNumber: i + 1,
      description: line.description.trim(),
      quantity: line.quantity.trim(),
      unitPrice: line.unitPrice.trim(),
      lineTotal: p.lineTotals[i] ?? '',
    })),
    ...optional('dueDate', draft.dueDate),
    ...optional('purchaseDate', draft.purchaseDate),
    ...optional('purchaseOrderId', draft.purchaseOrderId),
    ...optional('purchaseOrderNumber', draft.purchaseOrderNumber),
    ...optional('discount', draft.discount),
    ...optional('tax', draft.tax),
    ...optional('shipping', draft.shipping),
    ...optional('otherCharges', draft.otherCharges),
    ...optional('notes', draft.notes),
  } as CreateInvoicePayload;
}
