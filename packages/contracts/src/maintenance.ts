import { z } from 'zod';
import { MAINTENANCE_STATUSES } from '@techpioasset/domain';
import { moneyString } from './money.js';

/** Maintenance contracts (spec section 14). */

export const maintenanceTypeEnum = z.enum([
  'SCHEDULED',
  'REPAIR',
  'INSPECTION',
  'WARRANTY_CLAIM',
  'CALIBRATION',
  'CLEANING',
]);

export const maintenanceStatusEnum = z.enum(MAINTENANCE_STATUSES);

export const createMaintenanceSchema = z.object({
  assetId: z.string().min(1),
  type: maintenanceTypeEnum,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  vendorId: z.string().optional().nullable(),
  isInternal: z.boolean().default(false),
  scheduledFor: z.coerce.date().optional().nullable(),
});
export type CreateMaintenanceInput = z.infer<typeof createMaintenanceSchema>;

export const completeMaintenanceSchema = z.object({
  serviceCost: moneyString.optional().nullable(),
  currency: z.string().length(3).toUpperCase().optional().nullable(),
  downtimeHours: z
    .string()
    .regex(/^\d{1,6}(\.\d{1,2})?$/)
    .optional()
    .nullable(),
  resolutionNotes: z.string().trim().max(2000).optional().nullable(),
  replacementRecommended: z.boolean().default(false),
  recommendationNote: z.string().trim().max(1000).optional().nullable(),
  /**
   * Whether the asset returns to service. Applied when a manager approves the
   * work (the sign-off), not at completion - until then it stays under repair.
   */
  restoreAsset: z.boolean().default(true),
});

export const scheduleMaintenanceSchema = z.object({
  scheduledFor: z.coerce.date(),
});

export const maintenanceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  order: z.enum(['asc', 'desc']).default('desc'),
  status: maintenanceStatusEnum.optional(),
  /** Any not-yet-closed status (incl. on hold, awaiting approval) - what "Open maintenance" counts. */
  open: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  assetId: z.string().optional(),
  type: maintenanceTypeEnum.optional(),
  /** v2.5: filter to one technician's work orders (mobile "my work orders"). */
  technicianId: z.string().optional(),
});
export type MaintenanceListQuery = z.infer<typeof maintenanceListQuerySchema>;

// ── v2.5 work orders (plan section H3) ─────────────────────────────────────────

export const assignWorkOrderSchema = z.object({
  technicianId: z.string().min(1),
  /** Agreed completion deadline; the escalation sweep watches it. */
  slaDueAt: z.coerce.date().optional().nullable(),
});
export type AssignWorkOrderInput = z.infer<typeof assignWorkOrderSchema>;

export const diagnosisSchema = z.object({
  diagnosis: z.string().trim().min(1).max(4000),
});
export type DiagnosisInput = z.infer<typeof diagnosisSchema>;

export const holdWorkOrderSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});
export type HoldWorkOrderInput = z.infer<typeof holdWorkOrderSchema>;

// ── work-order sign-off ────────────────────────────────────────────────────────

export const approveWorkOrderSchema = z.object({
  /**
   * Return the asset to service now the work is signed off. Omitted: whatever
   * the technician asked for when completing (true when they said nothing).
   */
  restoreAsset: z.boolean().optional(),
});
export type ApproveWorkOrderInput = z.infer<typeof approveWorkOrderSchema>;

export const sendBackWorkOrderSchema = z.object({
  /** Required: the technician must be told what is still wrong. */
  reason: z.string().trim().min(1, 'Say why the work is being sent back').max(500),
});
export type SendBackWorkOrderInput = z.infer<typeof sendBackWorkOrderSchema>;

/** Optional so the pre-existing body-less cancel call keeps working. */
export const cancelMaintenanceSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});
export type CancelMaintenanceInput = z.infer<typeof cancelMaintenanceSchema>;

export const consumePartSchema = z.object({
  inventoryItemId: z.string().min(1),
  stockLocationId: z.string().min(1),
  quantity: z.number().int().min(1).max(10_000),
  note: z.string().trim().max(500).optional().nullable(),
});
export type ConsumePartInput = z.infer<typeof consumePartSchema>;

export const createMaintenanceScheduleSchema = z.object({
  assetId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  /** Whole days between occurrences; 1..3650. */
  intervalDays: z.number().int().min(1).max(3650),
  /** First due date; defaults server-side to now + intervalDays. */
  firstDueAt: z.coerce.date().optional().nullable(),
});
export type CreateMaintenanceScheduleInput = z.infer<typeof createMaintenanceScheduleSchema>;

export const updateMaintenanceScheduleSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  intervalDays: z.number().int().min(1).max(3650).optional(),
  nextDueAt: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateMaintenanceScheduleInput = z.infer<typeof updateMaintenanceScheduleSchema>;
