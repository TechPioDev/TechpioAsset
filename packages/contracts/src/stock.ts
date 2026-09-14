import { z } from 'zod';
import { moneyString } from './money.js';
import { pageQuerySchema } from './pagination.js';

/** v2.4 Warehouse stock contracts: locations, guarded movements, conversion. */

const qty = z.number().positive().max(1_000_000);

/**
 * A new stock item in the catalogue (Sep 2026).
 *
 * Stock previously arrived only through purchase-order receiving, so a tenant
 * with no procurement flow had no way to put anything on the shelf. This only
 * describes the item - quantity arrives through /stock/adjust, so every unit on
 * the shelf still has a ledger row and a reason behind it.
 *
 * The SKU is upper-cased so the per-company unique index is effectively
 * case-insensitive: "cab-hdmi" and "CAB-HDMI" are the same box.
 *
 * `unitCost` is money: only holders of the cost permission may send it, and the
 * API refuses it (403) from anyone else rather than silently dropping it.
 */
export const createInventoryItemSchema = z.object({
  name: z.string().trim().min(2).max(200),
  sku: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/, 'Letters, digits and . _ - / only')
    .toUpperCase(),
  categoryId: z.string().min(1),
  subcategoryId: z.string().min(1).optional().nullable(),
  unit: z.string().trim().min(1).max(20).default('unit'),
  description: z.string().trim().max(1000).optional().nullable(),
  /** Low-stock level: at or below this a location raises LOW_STOCK. */
  minStock: z.number().min(0).max(1_000_000).optional().nullable(),
  reorderLevel: z.number().min(0).max(1_000_000).optional().nullable(),
  unitCost: moneyString.optional().nullable(),
  currency: z.string().length(3).toUpperCase().optional().nullable(),
});
export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>;

export const createStockLocationSchema = z.object({
  code: z.string().trim().min(2).max(30).toUpperCase(),
  name: z.string().trim().min(2).max(120),
  officeId: z.string().optional().nullable(),
});
export type CreateStockLocationInput = z.infer<typeof createStockLocationSchema>;

export const updateStockLocationSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    officeId: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateStockLocationInput = z.infer<typeof updateStockLocationSchema>;

export const stockMovementQuerySchema = pageQuerySchema.extend({
  inventoryItemId: z.string().optional(),
  stockLocationId: z.string().optional(),
});
export type StockMovementQuery = z.infer<typeof stockMovementQuerySchema>;

const itemAtLocation = {
  inventoryItemId: z.string().min(1),
  stockLocationId: z.string().min(1),
};

export const issueStockSchema = z.object({
  ...itemAtLocation,
  quantity: qty,
  reason: z.string().trim().max(500).optional().nullable(),
  /**
   * v2.21 - who walked away with it. Consumables were leaving the shelf with no
   * record of the recipient, so "what does this person actually hold" could not
   * include the cable or the spare mouse. Optional: stock issued to a room or a
   * job still has no person attached.
   */
  issuedToUserId: z.string().min(1).optional().nullable(),
  /**
   * v2.9 C4 - permission to fall back on expired stock, never an instruction to
   * reach for it. Usable lots are always consumed first, and the reason is
   * recorded on the movement and the audit log.
   */
  allowExpired: z.boolean().optional(),
  expiredReason: z
    .string()
    .trim()
    .min(10, 'Say why expired stock is still fit for use - it goes on the record')
    .max(500)
    .optional()
    .nullable(),
});
export type IssueStockInput = z.infer<typeof issueStockSchema>;

/** v2.21 - hand a consumable back, so a person's holding can go down again. */
export const returnStockSchema = z.object({
  ...itemAtLocation,
  quantity: qty,
  returnedByUserId: z.string().min(1),
  reason: z.string().trim().max(500).optional().nullable(),
});
export type ReturnStockInput = z.infer<typeof returnStockSchema>;

export const adjustStockSchema = z.object({
  ...itemAtLocation,
  /** Positive adds stock, negative removes it. Zero is meaningless. */
  delta: z.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0, {
    message: 'An adjustment of zero changes nothing',
  }),
  reason: z.string().trim().min(5, 'Say why - adjustments are audited').max(500),
});
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export const transferStockSchema = z
  .object({
    inventoryItemId: z.string().min(1),
    fromLocationId: z.string().min(1),
    toLocationId: z.string().min(1),
    quantity: qty,
    note: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => v.fromLocationId !== v.toLocationId, {
    message: 'Source and destination must differ',
    path: ['toLocationId'],
  });
export type TransferStockInput = z.infer<typeof transferStockSchema>;

export const reserveStockSchema = z.object({
  ...itemAtLocation,
  quantity: qty,
});
export type ReserveStockInput = z.infer<typeof reserveStockSchema>;

export const countCorrectionSchema = z.object({
  ...itemAtLocation,
  countedQuantity: z.number().min(0).max(1_000_000),
  sessionId: z.string().optional().nullable(),
});
export type CountCorrectionInput = z.infer<typeof countCorrectionSchema>;

export const convertToAssetSchema = z.object({
  ...itemAtLocation,
  assetTag: z.string().trim().min(2).max(60),
  /** Defaults to the inventory item's name. */
  name: z.string().trim().min(2).max(200).optional().nullable(),
  serialNumber: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});
export type ConvertToAssetInput = z.infer<typeof convertToAssetSchema>;

/** v2.9 C4 - lots on the shelf, with what is about to go off. */
export const batchListQuerySchema = z.object({
  inventoryItemId: z.string().optional(),
  stockLocationId: z.string().optional(),
  /// Only lots expiring within this many days (or already expired).
  expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
  includeEmpty: z.coerce.boolean().optional(),
});
export type BatchListQuery = z.infer<typeof batchListQuerySchema>;
