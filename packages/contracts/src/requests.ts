import { z } from 'zod';
import { REQUEST_STATUSES } from '@techpioasset/domain';

/** Request contracts (spec section 11). */

export const REQUEST_TYPES = [
  'NEW_EMPLOYEE_ONBOARDING',
  'REPLACEMENT',
  'DAMAGE',
  'LOSS',
  'UPGRADE',
  'TEMPORARY_ASSIGNMENT',
  'PROJECT_REQUIREMENT',
  'OFFICE_REQUIREMENT',
  'KITCHEN_REQUIREMENT',
  'ACCESSIBILITY_REQUIREMENT',
  'ADDITIONAL_EQUIPMENT',
  'REPAIR',
  'RETURN',
] as const;

export const requestTypeEnum = z.enum(REQUEST_TYPES);
export const requestStatusEnum = z.enum(REQUEST_STATUSES);
export const requestPriorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

const moneyString = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount with at most two decimal places');

export const requestItemSchema = z.object({
  categoryId: z.string().optional().nullable(),
  subcategoryId: z.string().optional().nullable(),
  description: z.string().trim().min(1).max(500),
  quantity: z.coerce.number().positive().max(9999).default(1),
  preferredSpec: z.string().trim().max(1000).optional().nullable(),
  /**
   * v2.25 - accepted only from a caller holding `requests:assess`; the server
   * drops it otherwise. An employee stating the price of their own request is
   * how a Finance threshold gets walked around, so the figure that routes a
   * request is only ever one an authorised role entered.
   */
  estimatedCost: moneyString.optional().nullable(),
  /** v2.17 - the item is not in the catalog; admins review and may promote it. */
  isUncatalogued: z.boolean().optional(),
  manufacturer: z.string().trim().max(120).optional().nullable(),
  model: z.string().trim().max(120).optional().nullable(),
  referenceUrl: z.string().trim().max(500).optional().nullable(),
});

/** Admin action: promote an uncatalogued name into the equipment catalog. */
export const catalogItemSchema = z.object({
  name: z.string().trim().min(2, 'Name the equipment').max(120),
  categoryId: z.string().optional().nullable(),
});
export type CatalogItemInput = z.infer<typeof catalogItemSchema>;

/**
 * Structured context for the dynamic request form (v2.17). All optional so the
 * older flows (issue reports, API clients) keep working; the web form enforces
 * per-type requirements and the service enforces asset ownership.
 */
export const requestDetailsSchema = z
  .object({
    /** The requester's own asset this request is about (upgrade/repair/replace). */
    targetAssetId: z.string().optional().nullable(),
    upgradeType: z
      .enum(['RAM', 'STORAGE', 'CPU_PERFORMANCE', 'DISPLAY', 'WARRANTY', 'DOCKING_CONNECTIVITY', 'OPERATING_SYSTEM', 'OTHER'])
      .optional()
      .nullable(),
    currentSpec: z.string().trim().max(200).optional().nullable(),
    requestedSpec: z.string().trim().max(200).optional().nullable(),
    replacementReason: z
      .enum(['DAMAGED', 'LOST', 'END_OF_LIFE', 'PERFORMANCE_ISSUE', 'WARRANTY_ISSUE', 'UPGRADE_REQUIRED', 'OTHER'])
      .optional()
      .nullable(),
    /** The "please specify" text whenever an OTHER option is chosen. */
    otherText: z.string().trim().max(300).optional().nullable(),
  })
  .optional()
  .nullable();
export type RequestDetails = z.infer<typeof requestDetailsSchema>;

export const createRequestSchema = z.object({
  type: requestTypeEnum,
  details: requestDetailsSchema,
  priority: requestPriorityEnum.default('NORMAL'),
  /** HR and similar roles raise requests for someone else; needs requests:create-on-behalf. */
  beneficiaryId: z.string().optional().nullable(),
  /** v2.14 - the published issue-catalogue key when raised via "Report an
   * issue". Validated as a plain string here and checked against the
   * catalogue in the service, so contracts stay free of domain imports. */
  issueCategory: z.string().trim().max(40).optional().nullable(),
  businessReason: z.string().trim().min(10, 'Explain why this is needed').max(2000),
  requiredBy: z.coerce.date().optional().nullable(),
  preferredSpec: z.string().trim().max(1000).optional().nullable(),
  isReplacement: z.boolean().default(false),
  replacesAssetId: z.string().optional().nullable(),
  estimatedCost: moneyString.optional().nullable(),
  currency: z.string().length(3).toUpperCase().optional().nullable(),
  officeId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  /**
   * v2.21 - optional. Asset-linked requests (repair, damage, loss, upgrade)
   * are ABOUT an existing asset, so listing an item was noise; and the
   * mandatory business reason already says what is wanted. A row that IS added
   * still has to name the equipment - a blank row is worse than no row.
   */
  items: z.array(requestItemSchema).max(50).default([]),
});
export type CreateRequestInput = z.infer<typeof createRequestSchema>;

/** Pre-check query: is there an open ticket that makes this a duplicate? */
export const openDuplicateQuerySchema = z.object({
  type: requestTypeEnum,
  targetAssetId: z.string().optional(),
  item: z.string().trim().max(500).optional(),
});
export type OpenDuplicateQuery = z.infer<typeof openDuplicateQuerySchema>;

export const requestListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  q: z.string().trim().min(1).max(200).optional(),
  status: requestStatusEnum.optional(),
  type: requestTypeEnum.optional(),
  /**
   * Still in flight (v2.26). `status` takes a single value, so there was no way
   * to ask for "not finished" - which is exactly what the dashboard's open
   * tiles count, leaving them linking to an unfiltered list.
   */
  open: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  /** Only requests currently awaiting the caller's decision. */
  awaitingMe: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  /** A specific person's requests - the profile page's view. Narrows within
   * the caller's scope, so an OWN-scope caller naming a colleague gets an
   * empty page, never a wider one. */
  requesterId: z.string().optional(),
  /** Only requests the caller raised - the "my requests" view. */
  mine: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type RequestListQuery = z.infer<typeof requestListQuerySchema>;

export const approvalDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().trim().max(2000).optional(),
});

export const requestCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  /** Internal comments are hidden from the requesting employee. */
  isInternal: z.boolean().default(false),
});

/** How many images one message may carry (v2.60). */
export const MAX_COMMENT_IMAGES = 6;

/**
 * The same message arriving as multipart/form-data with `images[]` (v2.60).
 * Form fields are strings, so `isInternal` comes as "true"/"false"; the text
 * may be empty because a photo on its own is a message.
 */
export const requestCommentMultipartSchema = z.object({
  body: z.string().trim().max(4000).default(''),
  isInternal: z.preprocess((value) => value === true || value === 'true', z.boolean()),
});

export const fulfilRequestSchema = z.object({
  /** Asset to hand over; must be assignable. */
  assetId: z.string().min(1),
  requestItemId: z.string().optional(),
  expectedReturnAt: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
