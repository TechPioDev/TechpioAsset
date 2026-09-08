/**
 * The paperwork that comes with a product (v2.49).
 *
 * A datasheet settles what a thing actually is when a specification field does
 * not stretch far enough; a compliance certificate is the reason a buyer is
 * allowed to buy it at all. Both used to arrive by email and live in somebody's
 * inbox, which is where they are when nobody can find them.
 *
 * FILE TYPES. PDF and images only, and deliberately not Word or Excel. An
 * Office file is a zip archive that can carry macros and external references,
 * and these arrive from outside the company by definition - a supplier is not
 * a colleague. A supplier with a .docx can print it to PDF; the buyer opening
 * it cannot un-run a macro. Images are allowed because a certificate is very
 * often a photograph or a scan of one.
 */

export const PRODUCT_DOCUMENT_KINDS = [
  'DATASHEET',
  'USER_MANUAL',
  'WARRANTY',
  'BROCHURE',
  'COMPLIANCE_CERTIFICATE',
  'TECHNICAL_SPECIFICATION',
  'INSTALLATION_GUIDE',
  'OTHER',
] as const;

export type ProductDocumentKind = (typeof PRODUCT_DOCUMENT_KINDS)[number];

/** What each kind is called on screen. */
export const PRODUCT_DOCUMENT_LABELS: Readonly<Record<ProductDocumentKind, string>> = {
  DATASHEET: 'Datasheet',
  USER_MANUAL: 'User manual',
  WARRANTY: 'Warranty document',
  BROCHURE: 'Brochure',
  COMPLIANCE_CERTIFICATE: 'Compliance certificate',
  TECHNICAL_SPECIFICATION: 'Technical specification',
  INSTALLATION_GUIDE: 'Installation guide',
  OTHER: 'Other document',
};

export const PRODUCT_DOCUMENT_RULES = {
  /** Per product. Enough for the full set of kinds twice over, and no more. */
  max: 10,
  /** A datasheet is a few pages; a manual can be a hundred. */
  maxBytes: 10 * 1024 * 1024,
  mimes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const,
} as const;

/** Whether another document can be added. Null when it can. */
export function documentSetProblem(count: number): string | null {
  if (count >= PRODUCT_DOCUMENT_RULES.max) {
    return `A product may have at most ${PRODUCT_DOCUMENT_RULES.max} documents`;
  }
  return null;
}

/**
 * A title worth showing in a list.
 *
 * Falls back to the kind rather than to the file name, because "scan_0001.pdf"
 * tells a buyer nothing and "Compliance certificate" tells them everything they
 * need to decide whether to open it.
 */
export function documentTitle(input: {
  title?: string | null;
  kind: ProductDocumentKind;
}): string {
  return input.title?.trim() || PRODUCT_DOCUMENT_LABELS[input.kind];
}
