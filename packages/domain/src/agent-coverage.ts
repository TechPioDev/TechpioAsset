/**
 * Which machines in the register have no agent yet (v2.77).
 *
 * The owner rolls the agent out in batches and asked "which devices are still
 * pending?" - until now that meant comparing the asset list with the agents
 * list by hand. A register laptop or desktop is "covered" when a live (not
 * revoked) agent reported its serial number; serials are compared without
 * case or surrounding space, the way the discovery matcher compares them.
 * A machine with no serial on record can never be matched, so it is listed
 * with a reason rather than silently counted as covered.
 */

/** Asset types the agent runs on. Everything else is not expected to enrol. */
export const AGENT_DEVICE_TYPES: readonly string[] = ['laptop', 'desktop', 'server'];

export interface CoverageAsset {
  id: string;
  name: string;
  assetTag: string;
  serialNumber?: string | null;
  subcategoryKey?: string | null;
  holder?: string | null;
}

export interface CoverageAgent {
  serialNumber?: string | null;
  revokedAt?: string | Date | null;
}

export interface NotEnrolledRow extends CoverageAsset {
  /** Why it cannot be matched even after an install, when that is the case. */
  reason: 'no-agent' | 'no-serial';
}

export function normaliseSerial(serial: string | null | undefined): string | null {
  const s = (serial ?? '').trim().toUpperCase();
  return s.length > 0 ? s : null;
}

export function notEnrolledDevices(
  assets: readonly CoverageAsset[],
  agents: readonly CoverageAgent[],
): NotEnrolledRow[] {
  const covered = new Set<string>();
  for (const agent of agents) {
    if (agent.revokedAt) continue;
    const serial = normaliseSerial(agent.serialNumber);
    if (serial) covered.add(serial);
  }
  return assets
    .filter((a) => AGENT_DEVICE_TYPES.includes(a.subcategoryKey ?? ''))
    .flatMap((a): NotEnrolledRow[] => {
      const serial = normaliseSerial(a.serialNumber);
      if (!serial) return [{ ...a, reason: 'no-serial' as const }];
      return covered.has(serial) ? [] : [{ ...a, reason: 'no-agent' as const }];
    });
}

/** "12 of 34 laptops have no agent yet" */
export function coverageSummary(notEnrolled: number, total: number): string {
  if (total === 0) return 'No laptops or desktops in the register';
  if (notEnrolled === 0) return `All ${total} laptops and desktops have an agent`;
  return `${notEnrolled} of ${total} laptops and desktops have no agent yet`;
}
