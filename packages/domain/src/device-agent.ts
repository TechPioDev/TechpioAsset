/**
 * The laptop inventory agent (v2.13) — how an enrolled device's state is read.
 *
 * Pure so the API list and the web table cannot disagree about what "active"
 * means. The trap this exists to close: a laptop whose credential is refused
 * every day looked exactly like a laptop that was switched off ("Not
 * reporting"), and the fix for the two is completely different.
 */

/** The version the portal currently ships. Older agents get "Update available". */
export const LATEST_AGENT_VERSION = '1.2.1';

/** Seen within this many days counts as reporting. The agent runs daily. */
export const AGENT_ACTIVE_WINDOW_DAYS = 3;

export const AGENT_STATUSES = ['ACTIVE', 'OFFLINE', 'CREDENTIAL_REJECTED', 'REVOKED'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

type When = Date | string | null | undefined;

export interface AgentStatusInput {
  revokedAt?: When;
  lastSeenAt?: When;
  lastRejectedAt?: When;
}

function toTime(value: When): number | null {
  if (value === null || value === undefined) return null;
  const t = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Revoked wins outright; then a rejection newer than the last accepted
 * contact (the laptop is trying and being refused — reinstall fixes it); then
 * recency. A rejection OLDER than the last accepted contact is history, not
 * state: the device has since healed.
 */
export function deriveAgentStatus(agent: AgentStatusInput, now: Date = new Date()): AgentStatus {
  if (toTime(agent.revokedAt) !== null) return 'REVOKED';
  const seen = toTime(agent.lastSeenAt);
  const rejected = toTime(agent.lastRejectedAt);
  if (rejected !== null && (seen === null || rejected > seen)) return 'CREDENTIAL_REJECTED';
  if (seen !== null && now.getTime() - seen <= AGENT_ACTIVE_WINDOW_DAYS * 86_400_000) {
    return 'ACTIVE';
  }
  return 'OFFLINE';
}

/**
 * Numeric dotted-version compare ("1.10.0" > "1.9.0"). Non-numeric parts read
 * as 0, so a malformed version sorts old rather than throwing.
 */
export function compareAgentVersions(a: string, b: string): number {
  const pa = a.trim().replace(/^v/i, '').split('.');
  const pb = b.trim().replace(/^v/i, '').split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = Number.parseInt(pa[i] ?? '0', 10) || 0;
    const y = Number.parseInt(pb[i] ?? '0', 10) || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** An unknown version is treated as outdated: nothing proves it is current. */
export function isAgentOutdated(
  agentVersion: string | null | undefined,
  latest: string = LATEST_AGENT_VERSION,
): boolean {
  if (!agentVersion || !agentVersion.trim()) return true;
  return compareAgentVersions(agentVersion, latest) < 0;
}

/**
 * The elevated one-liner that installs the agent on a laptop. Shared so the
 * API's reveal response and the web page build byte-identical commands.
 *
 * Download comes from the portal (web origin); -PortalUrl is the API base
 * including /api/v1 — in development those are different hosts. The script is
 * run with -ExecutionPolicy Bypass because Windows' default policy refuses a
 * downloaded .ps1, and a command that dies on the first laptop is never run on
 * the second.
 */
export function buildAgentInstallCommand(input: {
  scriptUrl: string;
  portalUrl: string;
  enrolmentToken: string;
}): string {
  return (
    `iwr -useb ${input.scriptUrl} -OutFile $env:TEMP\\TechpioAgent.ps1; ` +
    `powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\\TechpioAgent.ps1 ` +
    `-PortalUrl ${input.portalUrl} -EnrolmentToken ${input.enrolmentToken} -Install`
  );
}
