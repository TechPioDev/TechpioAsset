import { PERMISSIONS } from './permissions';

/**
 * Physical verification of assets (v2.72): the rules the API, the web and the
 * phone share.
 *
 * A verification round is somebody walking the floor and confirming each unit
 * is where the register says: scan the label, the unit is marked seen. The
 * owner asked for it on the phone with a running count - "142 of 168 verified".
 *
 * Who may record one. Recording is a write (`verify` is in the permission
 * catalogue's write pattern), and the Auditor role is read-only by invariant,
 * so an auditor never marks anything seen: the people who handle the equipment
 * attest, and the auditor reads what they attested. That is the separation an
 * audit wants anyway. No new permission is introduced - the act belongs to
 * whoever may already edit the record or move its custody.
 */

/** Holding ANY of these lets somebody record "I saw this unit". */
export const ASSET_VERIFY_PERMISSIONS = [
  PERMISSIONS.ASSETS_UPDATE,
  PERMISSIONS.ASSETS_ASSIGN,
  PERMISSIONS.ASSETS_RETURN,
] as const;

export function canVerifyAssets(permissions: readonly string[]): boolean {
  return ASSET_VERIFY_PERMISSIONS.some((p) => permissions.includes(p));
}

/**
 * Units a round does not expect to find: they have left the company, or are
 * already known to be missing. Counting them would make 100% unreachable.
 */
export const NOT_VERIFIABLE_STATUSES = ['DISPOSED', 'DONATED', 'RETIRED', 'LOST', 'STOLEN'] as const;

/** Two scans of one label inside this window are one confirmation, not two. */
export const VERIFICATION_DEDUPE_SECONDS = 120;

/**
 * The start of the round a date falls in: the calendar quarter, in UTC. A
 * quarter because that is how often an asset register is normally walked, and
 * a fixed boundary rather than "the last 90 days" so the count does not slide
 * backwards overnight as old confirmations age out.
 */
export function verificationPeriodStart(now: Date): Date {
  const quarterMonth = Math.floor(now.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(now.getUTCFullYear(), quarterMonth, 1));
}

/** "Q3 2026" */
export function verificationPeriodLabel(now: Date): string {
  return `Q${Math.floor(now.getUTCMonth() / 3) + 1} ${now.getUTCFullYear()}`;
}

export interface VerificationProgress {
  total: number;
  verified: number;
  pending: number;
  /** Whole percent, 0-100; 100 only when nothing at all is pending. */
  percent: number;
  label: string;
}

export function verificationProgress(total: number, verified: number): VerificationProgress {
  const safeTotal = Math.max(0, Math.floor(total));
  const safeVerified = Math.min(safeTotal, Math.max(0, Math.floor(verified)));
  const pending = safeTotal - safeVerified;
  const percent =
    safeTotal === 0 ? 0 : pending === 0 ? 100 : Math.min(99, Math.floor((safeVerified / safeTotal) * 100));
  return {
    total: safeTotal,
    verified: safeVerified,
    pending,
    percent,
    label: safeTotal === 0 ? 'Nothing to verify' : `${safeVerified} of ${safeTotal} verified`,
  };
}

/** "Seen today by Marcus Bell" / "Seen 12 Sep 2026 by Marcus Bell" / "Never verified". */
export function lastVerifiedLabel(
  last: { verifiedAt: string | Date; by?: string | null } | null | undefined,
  now: Date,
  formatDate: (date: Date) => string,
): string {
  if (!last) return 'Never verified';
  const at = new Date(last.verifiedAt);
  const sameDay =
    at.getUTCFullYear() === now.getUTCFullYear() &&
    at.getUTCMonth() === now.getUTCMonth() &&
    at.getUTCDate() === now.getUTCDate();
  return `Seen ${sameDay ? 'today' : formatDate(at)}${last.by ? ` by ${last.by}` : ''}`;
}
