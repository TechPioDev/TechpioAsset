/**
 * The laptop inventory agent (v2.13) — how an enrolled device's state is read.
 *
 * Pure so the API list and the web table cannot disagree about what "active"
 * means. The trap this exists to close: a laptop whose credential is refused
 * every day looked exactly like a laptop that was switched off ("Not
 * reporting"), and the fix for the two is completely different.
 */

/** The version the portal currently ships. Older agents get "Update available". */
export const LATEST_AGENT_VERSION = '1.3.0';

/** Seen within this many days counts as reporting. The agent runs daily. */
export const AGENT_ACTIVE_WINDOW_DAYS = 3;

/**
 * v3.14 - agents from 1.3.0 also check in every few minutes, which is what
 * makes "Online" honest. Two missed check-ins plus slack before a laptop reads
 * Offline, so one dropped request on hotel wifi does not flicker the badge.
 */
export const AGENT_HEARTBEAT_INTERVAL_MINUTES = 5;
export const AGENT_ONLINE_WINDOW_MINUTES = 12;

/**
 * A refresh asked for while the laptop is off still happens when it comes
 * back, but not forever: after a week the request is stale and is dropped.
 */
export const AGENT_REFRESH_REQUEST_TTL_HOURS = 24 * 7;

/**
 * ONLINE and ACTIVE mean different things on purpose. ONLINE is only possible
 * for an agent that checks in (1.3.0+): it was heard from minutes ago. ACTIVE
 * is the most an older, once-a-day agent can prove - "it reported recently",
 * which says nothing about whether it is switched on now.
 */
export const AGENT_STATUSES = [
  'ONLINE',
  'ACTIVE',
  'OFFLINE',
  'CREDENTIAL_REJECTED',
  'REVOKED',
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** The words the web and mobile lists both use. */
export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  ONLINE: 'Online',
  ACTIVE: 'Reporting daily',
  OFFLINE: 'Offline',
  CREDENTIAL_REJECTED: 'Needs reinstall',
  REVOKED: 'Revoked',
};

type When = Date | string | null | undefined;

export interface AgentStatusInput {
  revokedAt?: When;
  lastSeenAt?: When;
  lastRejectedAt?: When;
  /** Set by the first check-in; null for agents older than 1.3.0. */
  lastHeartbeatAt?: When;
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
 *
 * lastSeenAt is the last accepted contact of any kind - a check-in or a full
 * report. An agent that has ever checked in is judged on minutes (ONLINE or
 * OFFLINE); one that never has is judged on days, as before.
 */
export function deriveAgentStatus(agent: AgentStatusInput, now: Date = new Date()): AgentStatus {
  if (toTime(agent.revokedAt) !== null) return 'REVOKED';
  const seen = toTime(agent.lastSeenAt);
  const rejected = toTime(agent.lastRejectedAt);
  if (rejected !== null && (seen === null || rejected > seen)) return 'CREDENTIAL_REJECTED';
  if (seen === null) return 'OFFLINE';
  const age = now.getTime() - seen;
  if (agentChecksIn(agent)) {
    return age <= AGENT_ONLINE_WINDOW_MINUTES * 60_000 ? 'ONLINE' : 'OFFLINE';
  }
  return age <= AGENT_ACTIVE_WINDOW_DAYS * 86_400_000 ? 'ACTIVE' : 'OFFLINE';
}

/** Whether this agent checks in, and so can show Online and be refreshed. */
export function agentChecksIn(agent: Pick<AgentStatusInput, 'lastHeartbeatAt'>): boolean {
  return toTime(agent.lastHeartbeatAt) !== null;
}

/**
 * Whether a "Refresh now" is still waiting for the laptop's next check-in.
 * Expired requests read as not pending, so the button comes back.
 */
export function isRefreshPending(refreshRequestedAt: When, now: Date = new Date()): boolean {
  const asked = toTime(refreshRequestedAt);
  return asked !== null && now.getTime() - asked <= AGENT_REFRESH_REQUEST_TTL_HOURS * 3_600_000;
}

/**
 * Why "Refresh now" cannot be used on this laptop, in words, or null when it
 * can. Shared so the button's tooltip and the API's refusal say the same.
 */
export function agentRefreshRefusal(
  agent: Pick<AgentStatusInput, 'revokedAt' | 'lastHeartbeatAt'> & {
    agentVersion?: string | null;
  },
): string | null {
  if (toTime(agent.revokedAt) !== null) {
    return 'This laptop has been revoked. Enrol it again before refreshing.';
  }
  if (!agentChecksIn(agent)) {
    const version = agent.agentVersion ? `agent ${agent.agentVersion}` : 'an older agent';
    return `This laptop runs ${version}, which only reports once a day. Update it to ${LATEST_AGENT_VERSION} (Copy fix command) to refresh it on demand.`;
  }
  return null;
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
