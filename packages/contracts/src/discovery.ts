import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/**
 * v2.5 Discovery contracts. The ingest payload is what an agent (or the pull
 * connector) reports about one device; everything is optional except the
 * source-side identity, because real agents report what they can see.
 */

export const discoveredHardwareSchema = z.object({
  manufacturer: z.string().max(120).optional().nullable(),
  modelName: z.string().max(200).optional().nullable(),
  cpu: z.string().max(200).optional().nullable(),
  cpuCores: z.number().int().min(1).max(1024).optional().nullable(),
  ramGb: z.number().min(0).max(4096).optional().nullable(),
  ramSlotsUsed: z.number().int().min(0).max(64).optional().nullable(),
  ramSlotsTotal: z.number().int().min(0).max(64).optional().nullable(),
  storageTotalGb: z.number().min(0).optional().nullable(),
  storageFreeGb: z.number().min(0).optional().nullable(),
  smartStatus: z.enum(['HEALTHY', 'WARNING', 'FAILING']).optional().nullable(),
  batteryHealthPct: z.number().int().min(0).max(100).optional().nullable(),
  batteryCycleCount: z.number().int().min(0).optional().nullable(),
  gpu: z.string().max(200).optional().nullable(),
  biosVersion: z.string().max(120).optional().nullable(),
});

export const discoveredOsSchema = z.object({
  osName: z.string().max(120).optional().nullable(),
  osVersion: z.string().max(120).optional().nullable(),
  osBuild: z.string().max(120).optional().nullable(),
  osSupported: z.boolean().optional().nullable(),
  osActivated: z.boolean().optional().nullable(),
  lastBootAt: z.coerce.date().optional().nullable(),
  diskEncrypted: z.boolean().optional().nullable(),
  defenderEnabled: z.boolean().optional().nullable(),
  firewallEnabled: z.boolean().optional().nullable(),
  tpmPresent: z.boolean().optional().nullable(),
  localAdminCount: z.number().int().min(0).max(1000).optional().nullable(),
  missingCriticalPatches: z.number().int().min(0).max(10_000).optional().nullable(),
  /** v2.76 - the console account (agent 1.2.0); null when nobody is signed in. */
  activeUser: z.string().trim().max(200).optional().nullable(),
});

export const discoveredDeviceSchema = z
  .object({
    externalId: z.string().max(200).optional().nullable(),
    serialNumber: z.string().trim().max(120).optional().nullable(),
    hostname: z.string().trim().max(200).optional().nullable(),
    hardware: discoveredHardwareSchema.optional().nullable(),
    os: discoveredOsSchema.optional().nullable(),
    software: z
      .array(
        z.object({
          name: z.string().min(1).max(300),
          version: z.string().max(120).optional().nullable(),
          publisher: z.string().max(200).optional().nullable(),
          installedAt: z.coerce.date().optional().nullable(),
        }),
      )
      .max(5000)
      .optional()
      .nullable(),
  })
  .refine((d) => d.externalId || d.serialNumber || d.hostname, {
    message: 'A device needs at least one identity: externalId, serialNumber or hostname',
  });
export type DiscoveredDeviceInput = z.infer<typeof discoveredDeviceSchema>;

export const ingestSchema = z.object({
  devices: z.array(discoveredDeviceSchema).min(1).max(1000),
});
export type IngestInput = z.infer<typeof ingestSchema>;

export const discoveryListQuerySchema = pageQuerySchema.extend({
  state: z.enum(['MATCHED', 'PROPOSED', 'CONFLICT', 'UNMATCHED', 'IGNORED']).optional(),
});
export type DiscoveryListQuery = z.infer<typeof discoveryListQuerySchema>;

export const confirmMatchSchema = z.object({
  /** Overrides the proposed asset when the reviewer picks a different one. */
  assetId: z.string().optional().nullable(),
});
export type ConfirmMatchInput = z.infer<typeof confirmMatchSchema>;

/**
 * Agent enrolment (v2.13). A laptop presents the company enrolment token once,
 * identifies itself, and receives a device-scoped credential it uses forever
 * after. `machineId` is the agent's stable local identity (a hardware UUID);
 * it pins every later report to this one machine.
 */
export const agentEnrolSchema = z
  .object({
    machineId: z.string().trim().min(8).max(200),
    hostname: z.string().trim().max(200).optional().nullable(),
    serialNumber: z.string().trim().max(120).optional().nullable(),
    platform: z.string().trim().max(60).optional().nullable(),
    agentVersion: z.string().trim().max(40).optional().nullable(),
  })
  .strict();
export type AgentEnrolInput = z.infer<typeof agentEnrolSchema>;

/**
 * What an enrolled agent reports about ITSELF. Note there is no device
 * identity in the body: the server takes it from the credential, so an agent
 * cannot file a report on another laptop's behalf.
 */
export const agentReportSchema = z
  .object({
    /**
     * Optional, and NEVER used for identity or authorisation - that still comes
     * from the credential. It exists only so a REFUSED report can be recorded
     * against its laptop ("credential rejected - reinstall") instead of looking
     * like a machine that is switched off. Agents may also send it as the
     * x-agent-machine-id header, which older servers ignore.
     */
    machineId: z.string().trim().min(8).max(200).optional().nullable(),
    hostname: z.string().trim().max(200).optional().nullable(),
    serialNumber: z.string().trim().max(120).optional().nullable(),
    agentVersion: z.string().trim().max(40).optional().nullable(),
    hardware: discoveredHardwareSchema.optional().nullable(),
    os: discoveredOsSchema.optional().nullable(),
    software: z
      .array(
        z.object({
          name: z.string().min(1).max(300),
          version: z.string().max(120).optional().nullable(),
          publisher: z.string().max(200).optional().nullable(),
          installedAt: z.coerce.date().optional().nullable(),
        }),
      )
      .max(5000)
      .optional()
      .nullable(),
  })
  .strict();
export type AgentReportInput = z.infer<typeof agentReportSchema>;

/**
 * Replacing the company enrolment token. The previous token keeps enrolling
 * new laptops for `graceDays` so installers already handed out do not break the
 * moment someone replaces it; 0 retires it immediately.
 */
export const enrolmentTokenReplaceSchema = z
  .object({
    graceDays: z.coerce.number().int().min(0).max(30).default(7),
  })
  .strict();
export type EnrolmentTokenReplaceInput = z.infer<typeof enrolmentTokenReplaceSchema>;

/** Why an existing enrolment token cannot be shown again. */
export type EnrolmentTokenUnrevealableReason = 'LEGACY_HASH_ONLY' | 'ENCRYPTION_NOT_CONFIGURED' | 'KEY_CHANGED';

export interface EnrolmentTokenStatus {
  exists: boolean;
  createdAt: string | null;
  createdBy: { id: string; name: string } | null;
  lastUsedAt: string | null;
  revealable: boolean;
  unrevealableReason: EnrolmentTokenUnrevealableReason | null;
  /** Plain-language explanation to show when `revealable` is false. */
  unrevealableMessage: string | null;
  graceToken: { expiresAt: string } | null;
}

export interface EnrolmentTokenSecret {
  token: string;
  installCommand: string;
}
