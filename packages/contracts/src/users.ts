import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/**
 * Role keys are tenant role identifiers, not a fixed enum — custom roles
 * (v2.2 Workstream G) are addressed by key too. Existence and the read-only /
 * last-Super-Admin invariants are enforced server-side against the tenant's roles.
 */
const roleKey = z.string().trim().min(1).max(60);

/** Users list, with an optional role filter on top of the standard page query. */
export const userListQuerySchema = pageQuerySchema.extend({
  role: roleKey.optional(),
  /** Deactivated accounts live in their own view instead of padding the
   * default list with people who cannot sign in. */
  view: z.enum(['active', 'deactivated']).default('active'),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

/** Replace a user's roles wholesale. Empty is rejected — everyone keeps at least one. */
export const setUserRolesSchema = z.object({
  roleKeys: z.array(roleKey).min(1, 'A user must keep at least one role'),
});
export type SetUserRolesInput = z.infer<typeof setUserRolesSchema>;

/**
 * Change a user's account status. INVITED is set by the invite flow, not here,
 * so an admin may only move a user between active and (de)activated states.
 */
export const setUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
  reason: z.string().trim().max(500).optional(),
});
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;

/**
 * v2.54 - change the address a user signs in with.
 *
 * Its own endpoint rather than a field on the profile edit, because it is not a
 * profile detail: it is the account's identity. Login resolves by email, so a
 * typo here locks somebody out, and an address changed by the wrong hands is an
 * account takeover waiting for a password reset. Both are reasons to keep it
 * separate, permissioned and audited on its own.
 */
export const changeUserEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email('That is not a valid email address').max(254),
});
export type ChangeUserEmailInput = z.infer<typeof changeUserEmailSchema>;

/**
 * v2.11 profile editing — two surfaces, deliberately different.
 *
 * Self-service covers what is YOURS to say: name, phone, job title. It stops
 * exactly where a field starts to drive access — department and office feed the
 * DEPARTMENT data scope, so letting a user move their own department would let
 * them choose whose assets they see.
 */
export const updateMyProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().min(1).max(60).optional(),
    displayName: z.string().trim().min(2).max(120).optional().nullable(),
    phone: z.string().trim().max(30).optional().nullable(),
    jobTitle: z.string().trim().max(120).optional().nullable(),
    // v2.12 personal display preferences - safe for self-service; they never
    // affect access or scope, only how dates and language render for this user.
    locale: z.string().trim().max(20).optional().nullable(),
    timezone: z.string().trim().max(60).optional().nullable(),
    dateFormat: z.string().trim().max(20).optional().nullable(),
  })
  // Strict on purpose. Zod's default strips unknown keys, which turned a
  // self-service attempt to set departmentId into a 200 that silently ignored
  // it - the field feeds the data scope, and "refused with a reason" must never
  // degrade into "accepted and dropped".
  .strict();
export type UpdateMyProfileInput = z.infer<typeof updateMyProfileSchema>;

/**
 * Invite a new user (v2.12). The missing registration path: until now accounts
 * only arrived via platform provisioning or SCIM. Strict for the same reason
 * every other user-shaped schema is.
 */
export const inviteUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    jobTitle: z.string().trim().max(120).optional().nullable(),
    departmentId: z.string().optional().nullable(),
    officeId: z.string().optional().nullable(),
    /** Defaults to Registered Employee - least privilege unless the inviter says otherwise. */
    roleKeys: z.array(roleKey).min(1).default(['EMPLOYEE']),
  })
  .strict();
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

/** The admin surface adds the org-placement fields self-service must not touch. */
export const adminUpdateProfileSchema = updateMyProfileSchema.extend({
  departmentId: z.string().optional().nullable(),
  officeId: z.string().optional().nullable(),
  employeeNumber: z.string().trim().max(40).optional().nullable(),
  /**
   * v2.26 - the line manager, at last settable. The column has existed since
   * v2.2 and the approval chain has always read it, but nothing ever wrote it,
   * so every LINE_MANAGER step fell back to whoever holds the MANAGER role.
   *
   * Admin-only, and for a sharper reason than department or office: this field
   * decides who approves this person's requests. Self-service would let anyone
   * nominate their own approver, which is not a placement mistake but a way to
   * pick the person who signs off your own spending.
   */
  managerId: z.string().optional().nullable(),
  /**
   * v2.22 - per-person exception to the company's request policy. null follows
   * the company setting; true always allows; false blocks this account.
   */
  canRaiseRequests: z.boolean().optional().nullable(),
});
export type AdminUpdateProfileInput = z.infer<typeof adminUpdateProfileSchema>;
