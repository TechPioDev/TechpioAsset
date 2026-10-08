import { isHighUtilization } from '@techpioasset/domain';

/** Shared licence UI bits used by the list and detail pages. */

export interface LicenseRow {
  id: string;
  name: string;
  family: string;
  edition: string | null;
  subscriptionType: string;
  unitOfAssignment: 'USER' | 'DEVICE';
  status: 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'RETIRED';
  expiryDate: string | null;
  seatsPurchased: number;
  seatsReserved: number;
  seatsAvailable: number;
  vendor: { id: string; name: string } | null;
  /** "M365" when mirrored from Microsoft 365; null when entered by hand. */
  externalSource?: string | null;
  /** Seats Microsoft says are in use. Can exceed seatsPurchased. */
  externalSeatsUsed?: number | null;
  externalStatus?: string | null;
  externalSyncedAt?: string | null;
}

/** True for a licence whose seats and dates Microsoft 365 owns (v3.12). */
export const isSyncedLicense = (l: Pick<LicenseRow, 'externalSource'>) =>
  l.externalSource === 'M365';

/**
 * Says where a licence comes from, wherever one is listed.
 *
 * Without it a synced licence looks like any other and offers the same
 * actions - which the server refuses, because its seats are assigned in
 * Microsoft 365. The label is the difference between "why won't it let me"
 * and knowing where to go.
 */
export function SyncedBadge() {
  return (
    <span
      className="inline-flex items-center rounded-full border border-[var(--color-border-strong)] px-1.5 py-px text-[10.5px] font-semibold text-[var(--color-content-muted)]"
      title="Synced from Microsoft 365. Seats and dates are managed there."
    >
      Microsoft 365
    </span>
  );
}

const STATUS_TONE: Record<LicenseRow['status'], string> = {
  ACTIVE: 'success',
  EXPIRING: 'warning',
  EXPIRED: 'critical',
  RETIRED: 'neutral',
};

export const STATUS_LABEL: Record<LicenseRow['status'], string> = {
  ACTIVE: 'Active',
  EXPIRING: 'Expiring',
  EXPIRED: 'Expired',
  RETIRED: 'Retired',
};

export function LicenseStatusPill({ status }: { status: LicenseRow['status'] }) {
  return (
    <span
      className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{
        color: `var(--tone-${STATUS_TONE[status]}-fg)`,
        background: `var(--tone-${STATUS_TONE[status]}-bg)`,
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Seats meter: quiet while healthy, amber at ≥90% utilisation, red when full. */
export function SeatsMeter({ purchased, reserved }: { purchased: number; reserved: number }) {
  const pct = purchased > 0 ? Math.min(100, Math.round((reserved / purchased) * 100)) : 0;
  const hot = isHighUtilization(purchased, reserved);
  const full = purchased > 0 && reserved >= purchased;
  const color = full
    ? 'var(--tone-critical-solid)'
    : hot
      ? 'var(--tone-warning-solid)'
      : 'var(--color-brand)';
  return (
    <div className="min-w-28">
      <div className="flex items-center justify-between text-xs tabular-nums">
        <span className="font-semibold">
          {reserved}/{purchased}
        </span>
        {hot ? (
          <span className="font-semibold" style={{ color }}>
            {full ? 'Full' : `Only ${purchased - reserved} left`}
          </span>
        ) : null}
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-[var(--color-surface-sunken)]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

const DAY = 86_400_000;
export function expiryLabel(expiryDate: string | null): string {
  if (!expiryDate) return 'Perpetual';
  const days = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / DAY);
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days <= 90) return `${days}d left`;
  return new Date(expiryDate).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export { controlCls as inputCls } from '@/components/ui';
