import { z } from 'zod';

/**
 * v2.6 A3 - integrations hub contracts. The webhook event catalogue is the
 * closed set of things the platform actually emits; a subscription cannot
 * name an event that will never fire.
 */

export const WEBHOOK_EVENTS = [
  'asset.created',
  'request.decided',
  'license.seat_blocked',
  'workorder.escalated',
  'discovery.conflict',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const createWebhookSchema = z.object({
  url: z
    .string()
    .url()
    .max(500)
    .refine(
      (u) =>
        u.startsWith('https://') ||
        u.startsWith('http://localhost') ||
        u.startsWith('http://127.0.0.1'),
      {
        message: 'Webhook URLs must be https (localhost allowed for development)',
      },
    ),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = z.object({
  url: createWebhookSchema.shape.url.optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;

/** SCIM 2.0 user resource, the subset the provisioning endpoint honours. */
export const scimUserSchema = z.object({
  schemas: z.array(z.string()).optional(),
  userName: z.string().email(),
  name: z
    .object({
      givenName: z.string().max(100).optional(),
      familyName: z.string().max(100).optional(),
    })
    .optional(),
  active: z.boolean().default(true),
  roles: z.array(z.object({ value: z.string() })).optional(),
});
export type ScimUserInput = z.infer<typeof scimUserSchema>;

export const scimPatchSchema = z.object({
  schemas: z.array(z.string()).optional(),
  Operations: z
    .array(
      z.object({
        op: z.string(),
        path: z.string().optional(),
        value: z.unknown(),
      }),
    )
    .min(1),
});
export type ScimPatchInput = z.infer<typeof scimPatchSchema>;

/**
 * Team alerts (v2.12): one Teams/Slack incoming-webhook per company, posted to
 * for high-signal operational events. HTTPS only - an incoming webhook IS the
 * write credential for the channel, and it never travels in clear.
 */
export const setTeamAlertsSchema = z
  .object({
    webhookUrl: z
      .string()
      .trim()
      .url()
      .max(500)
      .refine((v) => v.startsWith('https://'), 'Webhook URL must use https')
      .nullable(),
  })
  .strict();
export type SetTeamAlertsInput = z.infer<typeof setTeamAlertsSchema>;

/**
 * v3.12 - a company's Microsoft 365 connection, for reading the subscriptions
 * it owns into Licences.
 *
 * The tenant and client ids are GUIDs. Checking the shape here means a tenant
 * NAME pasted by mistake, or an id with a stray character, is refused on the
 * settings screen with a sentence - rather than being sent to Microsoft, which
 * answers a malformed tenant with an error about something else entirely.
 *
 * The secret is optional so that an existing connection can have its ids
 * corrected without fetching the secret out of Entra again; the service
 * requires it the first time.
 */
const guid = (label: string) =>
  z
    .string()
    .trim()
    .regex(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      `${label} should look like 00000000-0000-0000-0000-000000000000`,
    );

export const saveM365ConnectionSchema = z
  .object({
    tenantId: guid('Tenant ID'),
    clientId: guid('Client ID'),
    clientSecret: z
      .string()
      .trim()
      .min(8, 'That is too short to be a client secret')
      .max(500)
      .optional(),
  })
  .strict();
export type SaveM365ConnectionInput = z.infer<typeof saveM365ConnectionSchema>;
