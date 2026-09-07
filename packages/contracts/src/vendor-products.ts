import { z } from 'zod';

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

/**
 * Vendor catalogue (v2.42).
 *
 * An offer a supplier publishes: what it will sell, at what price, until when.
 * Employees never see or enter any of this - pricing is vendor, office admin and
 * finance territory - so nothing here is reachable from the request forms.
 */

const money = () => z.number().nonnegative().max(99_999_999).multipleOf(0.01);

export const vendorProductConditions = [
  'NEW',
  'REFURBISHED',
  'OPEN_BOX',
  'OTHER',
] as const;

const vendorProductFields = z
  .object({
    /** Omitted by vendor users, who may only publish under their own vendor. */
    vendorId: z.string().optional(),

    name: trimmed(180),
    categoryId: z.string(),
    subcategoryId: z.string().optional(),
    brand: optionalText(80),
    manufacturer: optionalText(120),
    model: optionalText(120),
    vendorSku: optionalText(80),
    mpn: optionalText(80),
    description: optionalText(4000),
    condition: z.enum(vendorProductConditions).default('NEW'),

    /** Category-shaped fields, checked against the template for the category. */
    specs: z.record(z.string(), z.string()).optional(),

    /** A full YouTube URL; only the video id is stored. */
    youtubeUrl: z.string().max(300).optional(),

    unitPrice: money(),
    gstPercent: z.number().min(0).max(100).default(0),
    discount: money().default(0),
    shippingCost: money().default(0),
    installationCost: money().default(0),
    otherCharges: money().default(0),

    minOrderQuantity: z.number().int().positive().max(100_000).default(1),
    availableQuantity: z.number().int().nonnegative().max(1_000_000).default(0),
    paymentTerms: optionalText(200),
    leadTimeDays: z.number().int().nonnegative().max(365).optional(),
    warrantyMonths: z.number().int().nonnegative().max(240).optional(),

    availableFrom: z.string().datetime({ offset: true }),
    /** Required: an offer with no end date is a price nobody has promised. */
    availableUntil: z.string().datetime({ offset: true }),
  })
  .strict();

/**
 * The two cross-field rules, applied to a create in full and to an edit only
 * where both halves are present - a partial update that touches neither the
 * dates nor the price must not be rejected for a comparison it never made.
 */
function checkCrossFields(
  v: {
    availableFrom?: string;
    availableUntil?: string;
    unitPrice?: number;
    discount?: number;
  },
  ctx: z.RefinementCtx,
): void {
  if (v.availableFrom && v.availableUntil && new Date(v.availableUntil) <= new Date(v.availableFrom)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'availableUntil must be after availableFrom',
      path: ['availableUntil'],
    });
  }
  if (v.unitPrice !== undefined && v.discount !== undefined && v.discount > v.unitPrice) {
    // A discount above the price is a data-entry slip, and the arithmetic would
    // clamp it silently. Better to refuse it than accept a line nobody meant.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Discount cannot exceed the unit price',
      path: ['discount'],
    });
  }
}

export const createVendorProductSchema = vendorProductFields.superRefine(checkCrossFields);

export const updateVendorProductSchema = vendorProductFields
  .omit({ vendorId: true })
  .partial()
  .strict()
  .superRefine(checkCrossFields);

export const reviewVendorProductSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED', 'RETURNED_TO_VENDOR', 'CORRECTION_REQUESTED']),
    comments: optionalText(2000),
  })
  .strict()
  .refine((v) => v.decision === 'APPROVED' || Boolean(v.comments), {
    // A rejection without a reason is a decision the vendor cannot act on.
    message: 'Say why, so the vendor knows what to change',
    path: ['comments'],
  });

/**
 * Choosing an offer. No prices here on purpose: the figures are snapshotted
 * from the offer on the server, so a caller cannot record a purchase against a
 * price the vendor never published.
 */
export const selectOfferSchema = z
  .object({
    quantity: z.number().int().positive().max(100_000),
    purchaseRequestId: z.string().optional(),
    assetRequestId: z.string().optional(),
  })
  .strict();

export type SelectOfferInput = z.infer<typeof selectOfferSchema>;
export type CreateVendorProductInput = z.infer<typeof createVendorProductSchema>;
export type UpdateVendorProductInput = z.infer<typeof updateVendorProductSchema>;
export type ReviewVendorProductInput = z.infer<typeof reviewVendorProductSchema>;
