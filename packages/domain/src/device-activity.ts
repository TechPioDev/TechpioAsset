import { relativeAge, reportFreshness } from './asset-detail';
import { formatUptime } from './asset-overview';

/**
 * Uptime and the signed-in user, for the asset list (v2.76).
 *
 * The owner asked for two more columns on the laptop list: how long each
 * machine has been up, and who is using it. Both come from the agent's last
 * report, so both are only as fresh as that report - and on the live register
 * most laptops have not reported for weeks. Saying "Up 3d 4h" about a snapshot
 * three weeks old would be a lie, so every label here carries the age of the
 * report it came from, and a stale report says "Not reporting" instead.
 *
 * `lastBootAt` has been reported since the first agent. `activeUser` arrives
 * from agent 1.2.0: `activeUserAt` is the time of the report that carried the
 * field at all (a signed-in user OR "nobody"), so a laptop on an older agent
 * reads "Needs agent 1.2.0" rather than "Nobody signed in".
 */

export interface DeviceActivityInput {
  lastBootAt?: string | null;
  activeUser?: string | null;
  activeUserAt?: string | null;
  /** When the agent last reported at all. */
  reportedAt?: string | null;
}

export type ActivityTone = 'active' | 'ageing' | 'stale' | 'none';

export interface ActivityLabel {
  label: string;
  /** One line under it: which report this came from. */
  detail: string | null;
  tone: ActivityTone;
}

/**
 * The Windows account as a person reads it: "TECHPIO\ravi" and "AzureAD\Ravi
 * Menon" lose their domain; an address is left whole.
 */
export function displayAccount(account: string): string {
  const slash = account.lastIndexOf('\\');
  return (slash >= 0 ? account.slice(slash + 1) : account).trim();
}

export function deviceUptime(input: DeviceActivityInput, now: number = Date.now()): ActivityLabel {
  if (!input.reportedAt) return { label: '—', detail: 'No agent report', tone: 'none' };
  const freshness = reportFreshness(input.reportedAt, now);
  const age = relativeAge(input.reportedAt, now);
  if (freshness === 'stale') return { label: 'Not reporting', detail: `Last seen ${age}`, tone: 'stale' };
  if (!input.lastBootAt) return { label: '—', detail: `No boot time in the report ${age}`, tone: 'none' };
  // Uptime as it stood when the machine reported, not extrapolated to now: the
  // machine may have been switched off since.
  const up = new Date(input.reportedAt).getTime() - new Date(input.lastBootAt).getTime();
  return {
    label: `Up ${formatUptime(up)}`,
    detail: freshness === 'ageing' ? `As of ${age}` : `Reported ${age}`,
    tone: freshness === 'ageing' ? 'ageing' : 'active',
  };
}

export function deviceActiveUser(input: DeviceActivityInput, now: number = Date.now()): ActivityLabel {
  if (!input.reportedAt) return { label: '—', detail: 'No agent report', tone: 'none' };
  const freshness = reportFreshness(input.reportedAt, now);
  const age = relativeAge(input.reportedAt, now);
  if (freshness === 'stale') return { label: 'Not reporting', detail: `Last seen ${age}`, tone: 'stale' };
  if (!input.activeUserAt) return { label: '—', detail: 'Needs agent 1.2.0', tone: 'none' };
  const tone: ActivityTone = freshness === 'ageing' ? 'ageing' : 'active';
  const when = freshness === 'ageing' ? `As of ${age}` : `Signed in at last report, ${age}`;
  if (!input.activeUser) return { label: 'Nobody signed in', detail: `At last report, ${age}`, tone };
  return { label: displayAccount(input.activeUser), detail: when, tone };
}
