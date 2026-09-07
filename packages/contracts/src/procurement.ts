import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/** v2.4 Procurement contracts: PR lifecycle, PO issue/convert, GRN receive. */

const money = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Use a plain amount like 199.00');

const qty = z.number().positive().max(1_000_000);

export const prListQuerySchema = pageQuerySchema.extend({
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED']).optional(),
  mine: z.coerce.boolean().optional(),
});
export type PrListQuery = z.infer<typeof prListQuerySchema>;

export const createPurchaseRequestSchema = z.object({
  justification: z
    .string()
    .trim()
    .min(10, 'At least 10 characters - approvers read this first.')
    .max(2000),
  neededBy: z.coerce
    .date()
    .refine((d) => d.getTime() >= new Date(new Date().toDateString()).getTime(), {
      message: 'The needed-by date cannot be in the past',
    })
    .optional()
    .nullable(),
  currency: z.string().trim().length(3).optional().nullable(),
  /// v2.9 C2 - what this spend is charged to. Optional: a company with no cost
  /// centres keeps the v2.4 behaviour exactly.
  costCentreId: z.string().optional().nullable(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(2).max(500),
        quantity: qty,
        estimatedUnitPrice: money.optional().nullable(),
        inventoryItemId: z.string().optional().nullable(),
      }),
    )
    .min(1, 'Add at least one line'),
});
export type CreatePurchaseRequestInput = z.infer<typeof createPurchaseRequestSchema>;

export const decidePurchaseRequestSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().max(1000).optional().nullable(),
});
export type DecidePurchaseRequestInput = z.infer<typeof decidePurchaseRequestSchema>;

export const convertPurchaseRequestSchema = z.object({
  /// Optional from v2.9: when an RFQ has been awarded, the winning quote names
  /// the vendor and the prices, and passing a different one is refused.
  vendorId: z.string().min(1).optional().nullable(),
  quoteId: z.string().min(1).optional().nullable(),
  currency: z.string().trim().length(3).optional().nullable(),
});
export type ConvertPurchaseRequestInput = z.infer<typeof convertPurchaseRequestSchema>;

export const receiveGrnSchema = z.object({
  notes: z.string().trim().max(1000).optional().nullable(),
  lines: z
    .array(
      z.object({
        purchaseOrderLineId: z.string().min(1),
        quantity: qty,
        intake: z.enum(['STOCK', 'ASSET']),
        /// STOCK intake must say where and as which item.
        stockLocationId: z.string().optional().nullable(),
        inventoryItemId: z.string().optional().nullable(),
        /// v2.9 C4 - STOCK intake into a lot. Required when the item is
        /// batch-tracked; ignored otherwise.
        batchNumber: z.string().trim().min(1).max(60).optional().nullable(),
        expiryDate: z.coerce.date().optional().nullable(),
        /// ASSET intake must say what kind of thing arrived, because every asset
        /// needs a category. v2.9 C1.
        categoryId: z.string().optional().nullable(),
        subcategoryId: z.string().optional().nullable(),
        /// Serials and labels captured at the dock, in unit order. Shorter than
        /// the quantity is fine - unknown units are created without one.
        serialNumbers: z.array(z.string().trim().min(1).max(120)).max(500).optional(),
        assetTags: z.array(z.string().trim().min(1).max(60)).max(500).optional(),
        note: z.string().trim().max(500).optional().nullable(),
      }),
    )
    .min(1, 'Receive at least one line'),
});
export type ReceiveGrnInput = z.infer<typeof receiveGrnSchema>;

/**
 * Inspecting a receipt line (v2.42).
 *
 * The counts are checked against what actually arrived on the server, so a
 * caller cannot pass an inspection off against a quantity nobody received. The
 * outcome is derived from the counts rather than sent - "passed" alongside two
 * rejected units would be a contradiction the record could not resolve.
 */
export const qualityCheckSchema = z.object({
  // Not `qty`: that is positive, and a clean pass rejects zero units.
  quantityAccepted: z.number().nonnegative().max(1_000_000),
  quantityRejected: z.number().nonnegative().max(1_000_000),
  rejectionReason: z.string().trim().min(1).max(1000).optional().nullable(),
  disposition: z.enum(['RETURN_TO_VENDOR', 'HOLD_DAMAGED']).optional().nullable(),
  /**
   * Which units failed, for an asset line. Named explicitly because the
   * inspector holds them in their hands and knows which ones - guessing by
   * position would condemn an arbitrary laptop.
   */
  rejectedAssetIds: z.array(z.string().min(1)).max(500).optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});
export type RecordQualityCheckInput = z.infer<typeof qualityCheckSchema>;
