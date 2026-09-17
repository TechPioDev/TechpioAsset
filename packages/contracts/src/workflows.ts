import { z } from 'zod';
import { moneyString } from './money';

/**
 * Approval-workflow configuration (v2.24).
 *
 * Spec section 11 has always required Super Admins to configure approval
 * steps, approvers, thresholds and bypass rules. The permission
 * (`workflows:configure`) and the data model both existed; nothing ever read
 * or wrote them, so a chain could only be changed by editing the database by
 * hand - which is exactly the kind of change that should leave an audit trail.
 *
 * v2.24 covered the per-step rules that decide WHEN a step applies. v2.28
 * adds the rest of the chain: adding, renaming, removing and reordering
 * approval steps. The assessment stages stay a pair with a fixed place
 * (see setAssessmentStagesSchema), so they are never edited step by step.
 */

/** A step's display name, as it appears in every chain built from it. */
const stepName = z.string().trim().min(2).max(60);

export const updateWorkflowStepSchema = z
  .object({
    /** Rename (v2.28). Reaches new requests; ones in progress show the old name. */
    name: stepName.optional(),
    /**
     * The On/Off switch (v2.28). Off: the step is skipped for new requests
     * and removed from requests still in progress. On reaches new requests
     * only. The last enabled approval step cannot be switched off.
     */
    isEnabled: z.boolean().optional(),
    /**
     * Only requests estimated at or above this amount include the step. Null
     * means the step always applies - which is how "Finance sees everything"
     * is expressed.
     */
    costThreshold: moneyString.nullable().optional(),
    /** Whether the chain may skip this step when its threshold is not met. */
    isSkippable: z.boolean().optional(),
    /** Hours before the step is considered overdue and escalates. */
    slaHours: z.number().int().min(1).max(2160).nullable().optional(),
    /**
     * Which role staffs this step (v2.26). Previously fixed at the moment a
     * workflow was created, with no way to change it: an owner who decided the
     * Inventory check belonged with the Inventory Manager rather than the
     * Office Administrator had no screen that could say so.
     */
    approverRoleKey: z.string().trim().min(1).max(60).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

export type UpdateWorkflowStepInput = z.infer<typeof updateWorkflowStepSchema>;

/**
 * Add or remove the two assessment stages on a workflow (v2.25).
 *
 * Deliberately narrower than general step editing: these two stages have fixed
 * names, a fixed order relative to each other, and no approver choice - they
 * are the commercial half of the process, not an arbitrary step somebody might
 * insert anywhere. Restructuring a chain properly is still a larger job.
 */
export const setAssessmentStagesSchema = z
  .object({
    enabled: z.boolean(),
    /** Who does the assessment work. Defaults to the office administrator. */
    roleKey: z.string().min(1).max(60).optional(),
  })
  .strict();

export type SetAssessmentStagesInput = z.infer<typeof setAssessmentStagesSchema>;

/**
 * Who a new approval step sits with (v2.28). ROLE names one of the tenant's
 * roles; LINE_MANAGER is the requester's recorded manager, falling back to
 * the Manager role. USER (one named person) and DEPARTMENT_HEAD exist in the
 * engine but are not offered: neither has a picker, and a step tied to one
 * account is a step that stalls the day they leave.
 */
export const NEW_STEP_APPROVER_TYPES = ['ROLE', 'LINE_MANAGER'] as const;

export const createWorkflowStepSchema = z
  .object({
    name: stepName,
    approverType: z.enum(NEW_STEP_APPROVER_TYPES),
    /** Required when approverType is ROLE. */
    approverRoleKey: z.string().trim().min(1).max(60).optional(),
    costThreshold: moneyString.nullable().optional(),
    slaHours: z.number().int().min(1).max(2160).nullable().optional(),
    /**
     * 1-based place among the workflow's APPROVAL steps; omitted or past the
     * end means last. The assessment stages are placed by their own rule
     * around whatever order results.
     */
    position: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .refine((v) => v.approverType !== 'ROLE' || Boolean(v.approverRoleKey), {
    message: 'Choose which role approves this step',
    path: ['approverRoleKey'],
  });

export type CreateWorkflowStepInput = z.infer<typeof createWorkflowStepSchema>;

/** Every APPROVAL step of the workflow, once each, in the wanted order. */
export const reorderWorkflowStepsSchema = z
  .object({
    stepIds: z.array(z.string().min(1).max(60)).min(1).max(100),
  })
  .strict();

export type ReorderWorkflowStepsInput = z.infer<typeof reorderWorkflowStepsSchema>;

export const workflowStepSchema = z.object({
  id: z.string(),
  stepOrder: z.number(),
  name: z.string(),
  approverType: z.string(),
  approverRoleKey: z.string().nullable(),
  approverRoleName: z.string().nullable(),
  costThreshold: z.string().nullable(),
  kind: z.enum(['APPROVAL', 'INVENTORY_CHECK', 'COST_ASSESSMENT']),
  isSkippable: z.boolean(),
  slaHours: z.number().nullable(),
  /** How many active accounts could actually decide this step today. */
  eligibleApprovers: z.number(),
  /** Off means new requests skip this step. Always true for the stages. */
  isEnabled: z.boolean(),
  /**
   * False for the last enabled approval step (a chain needs one) and for the
   * assessment stages, which leave only as a pair.
   */
  canRemove: z.boolean(),
  /** False for the last enabled approval step and for the stages. */
  canDisable: z.boolean(),
});

export const workflowDefinitionSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** Null is the catch-all definition, used by any type without its own. */
  requestType: z.string().nullable(),
  isActive: z.boolean(),
  steps: z.array(workflowStepSchema),
});

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
