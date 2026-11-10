import { z } from 'zod';
import { partialUpdate } from './partial-update';
import { pageQuerySchema } from './pagination.js';

/** v2.9 C2 contracts: cost centres, budgets, and the consumption view. */

const money = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Use a plain amount like 25000.00');

/** Dates only - a budget covers whole days, in the company's own calendar. */
const day = z.coerce.date();

export const costCentreListQuerySchema = pageQuerySchema.extend({
  activeOnly: z.coerce.boolean().optional(),
});
export type CostCentreListQuery = z.infer<typeof costCentreListQuerySchema>;

export const createCostCentreSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dot, dash and underscore only'),
  name: z.string().trim().min(2).max(120),
  departmentId: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});
export type CreateCostCentreInput = z.infer<typeof createCostCentreSchema>;

export const updateCostCentreSchema = partialUpdate(createCostCentreSchema).extend({
  isActive: z.boolean().optional(),
});
export type UpdateCostCentreInput = z.infer<typeof updateCostCentreSchema>;

export const budgetListQuerySchema = pageQuerySchema.extend({
  costCentreId: z.string().optional(),
  /// Budgets whose period covers this day; defaults to everything.
  on: z.coerce.date().optional(),
});
export type BudgetListQuery = z.infer<typeof budgetListQuerySchema>;

export const createBudgetSchema = z
  .object({
    costCentreId: z.string().min(1, 'A budget belongs to a cost centre'),
    name: z.string().trim().min(2).max(120),
    periodStart: day,
    periodEnd: day,
    currency: z.string().trim().length(3),
    amount: money,
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((b) => b.periodEnd >= b.periodStart, {
    message: 'A budget period cannot end before it starts',
    path: ['periodEnd'],
  });
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

/**
 * The period and the cost centre are fixed once money is committed against a
 * budget; moving them would silently re-point live commitments. Raising or
 * lowering the amount is the normal adjustment, and it is refused if it would
 * drop below what is already committed.
 */
export const updateBudgetSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  amount: money.optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;
