/**
 * The procurement assessment form, as pure logic (v2.56 mobile parity).
 *
 * Mirrors apps/web/src/components/requests/procurement-assessment.tsx exactly:
 * the same preview arithmetic and the same PATCH body. The preview is feedback
 * only - the server computes the total that counts and never accepts one from
 * the caller. No AI anywhere near this number.
 */

export interface AssessmentForm {
  suggestedProduct: string;
  unitPrice: string;
  quantity: string;
  taxAmount: string;
  shipping: string;
  discount: string;
  notes: string;
}

export const EMPTY_ASSESSMENT_FORM: AssessmentForm = {
  suggestedProduct: '',
  unitPrice: '',
  quantity: '1',
  taxAmount: '',
  shipping: '',
  discount: '',
  notes: '',
};

const money = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The running total shown while typing, or null before a unit price is entered. */
export function assessmentPreview(form: AssessmentForm): number | null {
  if (form.unitPrice.trim() === '') return null;
  return Math.max(
    0,
    money(form.unitPrice) * Math.max(1, Number(form.quantity) || 1) +
      money(form.taxAmount) +
      money(form.shipping) -
      money(form.discount),
  );
}

/** Same client-side rule the server's moneyString enforces, so a bad figure is caught before sending. */
export const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/** The first money field that the server would refuse, by label - or null when all are fine. */
export function invalidMoneyField(form: AssessmentForm): string | null {
  const fields: [string, string][] = [
    ['Unit price', form.unitPrice],
    ['Tax', form.taxAmount],
    ['Shipping', form.shipping],
    ['Discount', form.discount],
  ];
  for (const [label, value] of fields) {
    const v = value.trim();
    if (v !== '' && !MONEY_PATTERN.test(v)) return label;
  }
  return null;
}

/** The PATCH /requests/:id/assessment body - identical to the web panel's. */
export function assessmentBody(
  purchaseRequired: boolean,
  form: AssessmentForm,
  suitableAssetId: string,
): Record<string, unknown> {
  const note = form.notes.trim();
  const body =
    purchaseRequired === false
      ? {
          inventoryAvailable: true,
          purchaseRequired: false,
          suitableAssetId: suitableAssetId || null,
        }
      : {
          inventoryAvailable: false,
          purchaseRequired: true,
          suitableAssetId: null,
          suggestedProduct: form.suggestedProduct || null,
          unitPrice: form.unitPrice.trim() || null,
          quantity: Number(form.quantity) || 1,
          taxAmount: form.taxAmount.trim() || null,
          shipping: form.shipping.trim() || null,
          discount: form.discount.trim() || null,
        };
  return { ...body, ...(note ? { note } : {}) };
}

/** Human-readable file size, as the web request page shows it. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
