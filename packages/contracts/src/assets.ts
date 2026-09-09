import { z } from 'zod';
import {
  ASSET_STATUSES,
  ASSET_CONDITIONS,
  TRACKING_TYPES,
  LIFECYCLE_STATES,
  AVAILABILITY_STATES,
  OWNERSHIP_TYPES,
} from '@techpioasset/domain';
import { moneyString } from './money.js';

/** Asset contracts (spec sections 5, 6, 12). */

export const assetStatusEnum = z.enum(ASSET_STATUSES);
export const assetConditionEnum = z.enum(ASSET_CONDITIONS);
export const trackingTypeEnum = z.enum(TRACKING_TYPES);

// v2.1 Workstream A — the four status dimensions (see @techpioasset/domain).
export const lifecycleStateEnum = z.enum(LIFECYCLE_STATES);
export const availabilityStateEnum = z.enum(AVAILABILITY_STATES);
export const ownershipTypeEnum = z.enum(OWNERSHIP_TYPES);

/** Money arrives as a string so it never round-trips through IEEE-754. */

const optionalDate = z.coerce.date().optional().nullable();

export const createAssetSchema = z.object({
  assetTag: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  categoryId: z.string().min(1),
  subcategoryId: z.string().min(1).optional().nullable(),
  trackingType: trackingTypeEnum.default('INDIVIDUAL'),

  brand: z.string().trim().max(120).optional().nullable(),
  model: z.string().trim().max(120).optional().nullable(),
  serialNumber: z.string().trim().max(120).optional().nullable(),
  manufacturerPartNumber: z.string().trim().max(120).optional().nullable(),
  barcode: z.string().trim().max(120).optional().nullable(),

  /**
   * v2.20 identity fields. Both are unique per company in the database, so a
   * second asset carrying the same handset IMEI or NIC address is refused
   * rather than quietly created. Blank is always allowed - most items have
   * neither.
   */
  macAddress: z
    .string()
    .trim()
    .max(32)
    .regex(/^[0-9a-fA-F]{2}([:-]?[0-9a-fA-F]{2}){5}$/, 'Enter a 12-digit MAC address')
    .optional()
    .nullable()
    .or(z.literal('')),
  imei: z
    .string()
    .trim()
    .regex(/^\d{14,16}$/, 'IMEI is 14-16 digits')
    .optional()
    .nullable()
    .or(z.literal('')),
  /**
   * v2.20 type-specific specification. Values arrive as strings and are
   * filtered against the chosen type's declared fields server-side, so an
   * unexpected key never reaches the column.
   */
  specs: z.record(z.string(), z.string().max(200)).optional().nullable(),

  purchaseDate: optionalDate,
  purchaseCost: moneyString.optional().nullable(),
  currency: z.string().length(3).toUpperCase().optional().nullable(),
  vendorId: z.string().optional().nullable(),
  purchaseOrderNumber: z.string().trim().max(64).optional().nullable(),

  warrantyStartDate: optionalDate,
  warrantyEndDate: optionalDate,
  expectedReplacementDate: optionalDate,

  officeId: z.string().optional().nullable(),
  buildingId: z.string().optional().nullable(),
  floorId: z.string().optional().nullable(),
  roomId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),

  condition: assetConditionEnum.default('GOOD'),
  // AVAILABLE, not DRAFT: a caller that names no status is registering real
  // equipment (the phone's form, most API scripts), and a Draft asset is a trap
  // - it cannot be assigned until somebody notices and flips it. Draft remains
  // choosable for genuinely half-entered records; it is just not the silent
  // default.
  status: assetStatusEnum.default('AVAILABLE'),
  // v2.1 Workstream A — optional; lifecycle/availability are derived from status
  // on write when STATUS_MODEL_V2 is on. Ownership is orthogonal, so it is set here.
  ownershipType: ownershipTypeEnum.optional(),
  notes: z.string().trim().max(4000).optional().nullable(),

  /**
   * Required to create a second asset with an existing serial number. Spec
   * section 6 permits the duplicate only when an authorised user records a
   * documented exception, so the reason is the thing that unlocks it.
   */
  duplicateExceptionReason: z.string().trim().min(10).max(500).optional(),
});
export type CreateAssetInput = z.infer<typeof createAssetSchema>;

export const updateAssetSchema = createAssetSchema.partial().extend({
  /** Optimistic-locking token; a stale value is rejected with 409. */
  version: z.number().int().nonnegative().optional(),
});
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

/** Finance records a price once; the server locks it afterwards. */
export const setAssetPriceSchema = z.object({
  purchaseCost: moneyString,
  currency: z.string().length(3).toUpperCase().optional(),
});
export type SetAssetPriceInput = z.infer<typeof setAssetPriceSchema>;

/** Text pasted from a manufacturer's warranty page, for AI date extraction. */
export const warrantyExtractSchema = z.object({
  text: z
    .string()
    .trim()
    .min(20, 'Paste the vendor warranty page text')
    .max(60_000, 'Pasted text is too long'),
});
export type WarrantyExtractInputBody = z.infer<typeof warrantyExtractSchema>;

export const assetListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  q: z.string().trim().min(1).max(200).optional(),
  status: assetStatusEnum.optional(),
  categoryId: z.string().optional(),
  /**
   * v2.23 - the asset TYPE (laptop, monitor, mouse). Category alone is too
   * coarse: a fleet where everything is "IT Assets" cannot be narrowed by it.
   *
   * The literal `none` matches assets with no type set. Without it those assets
   * are unreachable by this filter and simply look missing - and an asset
   * registered before its type existed is exactly the one someone needs to find.
   */
  subcategoryId: z.string().optional(),
  officeId: z.string().optional(),
  departmentId: z.string().optional(),
  /**
   * Warranty ending within N days, still in service (v2.26). The dashboard has
   * counted this for a long time and had nowhere to send anyone who clicked it.
   */
  warrantyWithinDays: z.coerce.number().int().min(1).max(3650).optional(),
  assignedUserId: z.string().optional(),
  condition: assetConditionEnum.optional(),
  vendorId: z.string().optional(),
  /// v2.53 - the units bought against one catalogue listing, so the rollup on
  /// a product page can send somebody to the assets it is counting.
  vendorProductId: z.string().optional(),
  // v2.1 Workstream A — filter by any of the four status dimensions (AST-051).
  lifecycleState: lifecycleStateEnum.optional(),
  availabilityState: availabilityStateEnum.optional(),
  ownershipType: ownershipTypeEnum.optional(),
});
export type AssetListQuery = z.infer<typeof assetListQuerySchema>;

export const assignAssetSchema = z.object({
  userId: z.string().min(1),
  expectedReturnAt: optionalDate,
  conditionOut: assetConditionEnum.default('GOOD'),
  accessoriesIssued: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type AssignAssetInput = z.infer<typeof assignAssetSchema>;

export const returnAssetSchema = z.object({
  conditionIn: assetConditionEnum,
  missingAccessories: z.string().trim().max(1000).optional().nullable(),
  damageNotes: z.string().trim().max(2000).optional().nullable(),
  /** Where the asset lands after return; constrained by the status machine. */
  resultingStatus: assetStatusEnum.default('AVAILABLE'),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type ReturnAssetInput = z.infer<typeof returnAssetSchema>;

/**
 * Sends an asset to another office (v2.15 Phase 2d). The asset goes IN_TRANSIT
 * and stays attributed to the origin office until the destination confirms
 * arrival - a laptop in a courier van is not "at" either site, and pretending
 * it has already arrived hides exactly the window where kit goes missing.
 */
export const transferAssetSchema = z.object({
  toOfficeId: z.string().min(1),
  reason: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type TransferAssetInput = z.infer<typeof transferAssetSchema>;

/** Destination confirms the asset arrived. */
export const receiveTransferSchema = z.object({
  /** Where it lands: on the shelf or in the store room. */
  resultingStatus: z.enum(['AVAILABLE', 'IN_STORAGE']).default('AVAILABLE'),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type ReceiveTransferInput = z.infer<typeof receiveTransferSchema>;

export const DISPOSAL_METHODS = [
  'SOLD',
  'SCRAPPED',
  'RECYCLED',
  'DONATED',
  'RETURNED_TO_VENDOR',
  'WRITTEN_OFF',
] as const;

/**
 * Records an asset's end of life (spec section 22: disposal is recorded, never
 * a delete). The reason is mandatory - "why did this leave the company" is the
 * question every disposal audit starts with.
 */
export const disposeAssetSchema = z.object({
  method: z.enum(DISPOSAL_METHODS),
  disposedAt: z.coerce.date(),
  /** What the sale raised, if it was sold. */
  proceeds: moneyString.optional().nullable(),
  currency: z.string().length(3).toUpperCase().optional().nullable(),
  /** Buyer, charity, recycler or vendor the asset went to. */
  recipient: z.string().trim().max(200).optional().nullable(),
  reason: z.string().trim().min(10, 'Explain why this asset is being disposed of').max(2000),
});
export type DisposeAssetInput = z.infer<typeof disposeAssetSchema>;

export const changeAssetStatusSchema = z.object({
  status: assetStatusEnum,
  reason: z.string().trim().max(500).optional(),
});

/** Apply one status change to many assets at once (bulk action). */
export const bulkChangeStatusSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'Select at least one asset').max(200),
  status: assetStatusEnum,
  reason: z.string().trim().max(500).optional(),
});
export type BulkChangeStatusInput = z.infer<typeof bulkChangeStatusSchema>;

/** Per-asset outcome of a bulk operation, so partial failures surface clearly. */
export interface BulkActionResult {
  succeeded: string[];
  failed: { id: string; reason: string }[];
}

/**
 * Hand a device straight from one person to another (v2.15).
 *
 * Reassignment used to mean two calls - return, then assign - with a window in
 * between where the asset belonged to nobody and nothing recorded that a
 * handover was intended. This carries both halves so the server can do it in
 * one transaction.
 */
export const reassignAssetSchema = z.object({
  /** Who receives it. */
  userId: z.string().min(1),
  /** Condition as it comes back from the current holder. */
  conditionIn: assetConditionEnum,
  /** Condition as it goes out to the next one; usually the same. */
  conditionOut: assetConditionEnum.optional(),
  expectedReturnAt: optionalDate,
  accessoriesIssued: z.string().trim().max(1000).optional().nullable(),
  damageNotes: z.string().trim().max(2000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type ReassignAssetInput = z.infer<typeof reassignAssetSchema>;
