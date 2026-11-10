import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { partialUpdate } from './partial-update';
import { createAssetSchema, updateAssetSchema } from './assets';
import { updateCostCentreSchema } from './budgets';
import { updateDepartmentSchema, updateOfficeSchema, updateVendorSchema } from './org';
import { updateSpecFieldSchema } from './spec-templates';
import { updateVendorProductSchema } from './vendor-products';

/**
 * v3.25 - Zod 4 fills `.default()` fields inside `.partial()`. A PATCH must
 * carry only what the caller sent; these tests are the reason that cannot
 * quietly come back with the next default added to a create schema.
 */
describe('partialUpdate', () => {
  const create = z
    .object({
      name: z.string(),
      status: z.enum(['A', 'B']).default('A'),
      count: z.number().int().default(0),
      note: z.string().optional(),
    })
    .strict();

  it('leaves out what the caller left out, defaults included', () => {
    expect(partialUpdate(create).parse({})).toEqual({});
    expect(partialUpdate(create).parse({ name: 'x' })).toEqual({ name: 'x' });
  });

  it('still validates what is sent, and keeps the base strictness', () => {
    expect(partialUpdate(create).safeParse({ status: 'C' }).success).toBe(false);
    expect(partialUpdate(create).safeParse({ unknown: 1 }).success).toBe(false);
    expect(partialUpdate(create).parse({ status: 'B', count: 3 })).toEqual({
      status: 'B',
      count: 3,
    });
  });

  it('does not change what a create still does', () => {
    expect(create.parse({ name: 'x' })).toEqual({ name: 'x', status: 'A', count: 0 });
  });
});

describe('the update schemas carry only what was sent', () => {
  const updates: [string, z.ZodType][] = [
    ['updateAssetSchema', updateAssetSchema],
    ['updateVendorProductSchema', updateVendorProductSchema],
    ['updateSpecFieldSchema', updateSpecFieldSchema],
    ['updateCostCentreSchema', updateCostCentreSchema],
    ['updateDepartmentSchema', updateDepartmentSchema],
    ['updateOfficeSchema', updateOfficeSchema],
    ['updateVendorSchema', updateVendorSchema],
  ];

  it.each(updates)('%s: an empty update stays empty', (_name, schema) => {
    expect(schema.parse({})).toEqual({});
  });

  it('a condition-only asset edit does not smuggle in a status', () => {
    expect(updateAssetSchema.parse({ condition: 'GOOD' })).toEqual({ condition: 'GOOD' });
    // The create still defaults, so a new asset is never status-less.
    expect(
      createAssetSchema.safeParse({ assetTag: 'T-1', name: 'x', categoryId: 'c' }).data,
    ).toMatchObject({
      status: 'AVAILABLE',
      condition: 'GOOD',
    });
  });

  it('a stock-only offer edit touches nothing else', () => {
    expect(updateVendorProductSchema.parse({ availableQuantity: 5 })).toEqual({
      availableQuantity: 5,
    });
  });

  it('a label-only spec field edit does not reset its flags', () => {
    expect(updateSpecFieldSchema.parse({ label: 'Screen size' })).toEqual({ label: 'Screen size' });
  });
});
