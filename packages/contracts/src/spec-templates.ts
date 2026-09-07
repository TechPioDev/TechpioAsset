import { z } from 'zod';

/**
 * Spec templates (v2.42).
 *
 * What a category's offers are described by, and therefore what they can be
 * compared on. Administrator-editable: the fields worth asking a laptop
 * supplier for are not the ones worth asking a chair supplier for.
 */

const trimmed = (max: number) => z.string().trim().min(1).max(max);

/** A machine key, matching the keys used inside VendorProduct.specs. */
const specKey = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'Use lower-case letters, digits and underscores, starting with a letter',
  );

export const specFieldTypes = ['TEXT', 'NUMBER', 'BOOLEAN', 'ENUM'] as const;
export const numericIntents = ['AT_LEAST', 'AT_MOST', 'EXACTLY'] as const;

const specFieldFields = {
  key: specKey,
  label: trimmed(80),
  dataType: z.enum(specFieldTypes).default('TEXT'),
  unit: z.string().trim().max(20).optional(),
  intent: z.enum(numericIntents).optional(),
  /** 0.1 = within 10% still counts as a partial match. */
  tolerance: z.number().min(0).max(1).optional(),
  options: z.array(trimmed(80)).max(50).default([]),
  isRequired: z.boolean().default(false),
  isComparable: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
};

/**
 * A NUMBER field with no intent would be compared as "at least" by default,
 * which silently inverts a limit like weight. An ENUM with no options is a free
 * text field wearing a dropdown's clothes. Both are caught here rather than
 * discovered during a comparison.
 */
function checkShape(v: {
  dataType: (typeof specFieldTypes)[number];
  intent?: string | undefined;
  options: string[];
  unit?: string | undefined;
}, ctx: z.RefinementCtx) {
  if (v.dataType === 'NUMBER' && !v.intent) {
    ctx.addIssue({
      code: 'custom',
      path: ['intent'],
      message: 'Say which way this points: at least, at most, or exactly',
    });
  }
  if (v.dataType !== 'NUMBER' && v.intent) {
    ctx.addIssue({
      code: 'custom',
      path: ['intent'],
      message: 'Only a number field points a direction',
    });
  }
  if (v.dataType === 'ENUM' && v.options.length < 2) {
    ctx.addIssue({
      code: 'custom',
      path: ['options'],
      message: 'A list needs at least two choices',
    });
  }
  if (v.dataType !== 'ENUM' && v.options.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['options'],
      message: 'Only a list field has choices',
    });
  }
}

export const createSpecFieldSchema = z
  .object({ categoryId: z.string(), ...specFieldFields })
  .strict()
  .superRefine(checkShape);

export const updateSpecFieldSchema = z
  .object(specFieldFields)
  .strict()
  .partial()
  .superRefine((v, ctx) => {
    // Only check the shape when enough of it is present to judge.
    if (v.dataType === undefined) return;
    checkShape(
      {
        dataType: v.dataType,
        intent: v.intent,
        options: v.options ?? [],
        unit: v.unit,
      },
      ctx,
    );
  });

/** One thing asked for, when comparing offers. */
export const requirementSchema = z
  .object({
    key: specKey,
    value: trimmed(200),
    mandatory: z.boolean().default(false),
  })
  .strict();

export const compareOffersSchema = z
  .object({
    categoryId: z.string(),
    /** The offers to compare. Two is the point; one is just a product page. */
    vendorProductIds: z.array(z.string()).min(2).max(10),
    requirements: z.array(requirementSchema).max(50).default([]),
  })
  .strict();

export type CreateSpecFieldInput = z.infer<typeof createSpecFieldSchema>;
export type UpdateSpecFieldInput = z.infer<typeof updateSpecFieldSchema>;
export type CompareOffersInput = z.infer<typeof compareOffersSchema>;
