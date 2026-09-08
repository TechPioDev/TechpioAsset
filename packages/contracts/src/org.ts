import { z } from 'zod';

/**
 * Office writes (v2.11). Offices were seed-only reference data until now —
 * readable everywhere, creatable nowhere. These schemas are `.strict()` for the
 * same reason the profile ones are: an unknown key silently stripped is a
 * request that lies about what it did.
 */

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/**
 * v2.21 - departments were readable but never creatable: the model, the picker
 * on a person and the approval routing all existed, with no way to add one, so
 * the dropdown said "No department" forever.
 */
export const createDepartmentSchema = z.object({
  /** Short unique handle, e.g. ENG. Uppercased server-side. */
  code: trimmed(20),
  name: trimmed(120),
  /** Parent department, for a nested org structure. */
  parentId: z.string().min(1).optional().nullable(),
  /** Where the department mainly sits. */
  officeId: z.string().min(1).optional().nullable(),
  costCentre: optionalText(40),
  /** Who signs for it - feeds DEPARTMENT_HEAD approvals. */
  headId: z.string().min(1).optional().nullable(),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = createDepartmentSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

export const createOfficeSchema = z
  .object({
    /** Short unique handle, e.g. BLR-HQ. Uppercased server-side. */
    code: trimmed(20),
    name: trimmed(120),
    addressLine1: optionalText(200),
    addressLine2: optionalText(200),
    city: optionalText(80),
    region: optionalText(80),
    postalCode: optionalText(20),
    country: optionalText(80),
    /** IANA name, e.g. Asia/Kolkata. Free text on purpose — validating the
     * full IANA set here would go stale; a wrong value only affects display. */
    timezone: optionalText(60),
  })
  .strict();

export const updateOfficeSchema = createOfficeSchema
  .partial()
  .extend({
    /** Deactivating hides the office from pickers without unlinking anyone. */
    isActive: z.boolean().optional(),
  })
  .strict();

export type CreateOfficeInput = z.infer<typeof createOfficeSchema>;
export type UpdateOfficeInput = z.infer<typeof updateOfficeSchema>;

/**
 * Vendors (v2.40).
 *
 * `vendors:manage` existed, was granted to Finance and Procurement Manager, and
 * was enforced by nothing: there was no way to add a vendor at all. The only
 * row that ever appeared was the "Unknown vendor" placeholder an uploaded bill
 * falls back to, which meant a purchase order could only ever be raised against
 * a vendor nobody chose.
 *
 * Contact and tax details are optional because a vendor is often created in a
 * hurry, mid-purchase, with only a name to hand - refusing the record until
 * somebody finds the GSTIN is how people end up filing under "Unknown" forever.
 */
export const createVendorSchema = z
  .object({
    /** Short unique handle, e.g. SCS. Uppercased server-side. */
    code: trimmed(20),
    name: trimmed(160),
    contactName: optionalText(120),
    contactEmail: optionalText(160),
    contactPhone: optionalText(40),
    website: optionalText(200),
    /** GSTIN in India; free text, since the format differs by country. */
    taxId: optionalText(40),
    addressLine1: optionalText(200),
    city: optionalText(80),
    country: optionalText(80),
    notes: optionalText(500),
  })
  .strict();

export const updateVendorSchema = createVendorSchema
  .partial()
  .extend({
    /**
     * Deactivating hides a vendor from pickers without touching a single
     * existing order or invoice. A vendor you have stopped buying from is not
     * a vendor you were never billed by, and the history has to stay.
     */
    isActive: z.boolean().optional(),
  })
  .strict();

export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;

/**
 * The details a supplier may maintain about itself (v2.45).
 *
 * Contact and address only. Deliberately not `name`, `code`, `isActive` or
 * `notes`: identity and standing are the buyer's record of the supplier, not
 * the supplier's to edit, and `notes` is where internal remarks about them are
 * kept. A supplier renaming itself, reactivating itself, or reading the buyer's
 * notes are three different problems, and omitting the fields prevents all
 * three without a second check anywhere.
 */
export const updateOwnVendorSchema = z
  .object({
    contactName: optionalText(120),
    contactEmail: z.string().trim().email().max(200).optional().nullable(),
    contactPhone: optionalText(40),
    website: optionalText(200),
    taxId: optionalText(60),
    addressLine1: optionalText(200),
    city: optionalText(120),
    country: optionalText(120),
  })
  .strict();

export type UpdateOwnVendorInput = z.infer<typeof updateOwnVendorSchema>;
