import {
  NOT_VERIFIABLE_STATUSES,
  PERMISSIONS,
  canVerifyAssets,
  custodyOptions,
  type AssetStatus,
} from '@techpioasset/domain';

/**
 * What the scanner offers once it has found the asset (0.3.31).
 *
 * Until now a scan did one thing: open the asset's page, where the person then
 * scrolled to Custody to do what they had come for. For somebody standing at a
 * desk with the laptop in hand that is the wrong way round - they scanned it
 * BECAUSE they are about to hand it over, take it back, or tick it off a
 * verification round. So a scan by somebody who may do one of those now stops
 * on a sheet with those acts as buttons.
 *
 * The flow that existed is kept on purpose, in two ways. Somebody with nothing
 * to do but look - an employee, an auditor - still goes straight to the asset
 * page, exactly as before. And "Open asset" is always the first thing on the
 * sheet, so the old path is one tap for everybody else.
 *
 * Every act here is a door to a flow that already exists (the asset screen's
 * hand-over sheet, its damage report): nothing about custody is re-implemented,
 * so its rules - custodyOptions, the server's checks - stay in one place.
 */

export type ScanActionKey = 'seen' | 'assign' | 'reassign' | 'return' | 'damage' | 'open';

export interface ScanAction {
  key: ScanActionKey;
  label: string;
  hint: string;
  /** Ionicons name. */
  icon: string;
  tone: 'primary' | 'neutral' | 'danger';
}

export interface ScannedAsset {
  id: string;
  name: string;
  assetTag: string;
  status: AssetStatus;
  assignedUser?: {
    id: string;
    email?: string;
    profile?: { firstName?: string | null; lastName?: string | null } | null;
  } | null;
  lastVerification?: { verifiedAt: string; by?: string | null } | null;
}

export function holderNameOf(asset: Pick<ScannedAsset, 'assignedUser'>): string | null {
  const u = asset.assignedUser;
  if (!u) return null;
  const name = [u.profile?.firstName, u.profile?.lastName].filter(Boolean).join(' ');
  return name || u.email || 'Somebody';
}

const ACTIONS: Record<ScanActionKey, Omit<ScanAction, 'key'>> = {
  open: { label: 'Open asset', hint: 'Everything about it', icon: 'open-outline', tone: 'neutral' },
  seen: {
    label: 'Mark as seen',
    hint: 'Counts towards this quarter’s verification',
    icon: 'checkmark-circle-outline',
    tone: 'primary',
  },
  assign: {
    label: 'Assign',
    hint: 'Give it to somebody',
    icon: 'person-add-outline',
    tone: 'primary',
  },
  reassign: {
    label: 'Hand over',
    hint: 'From its holder to somebody else',
    icon: 'swap-horizontal-outline',
    tone: 'primary',
  },
  return: {
    label: 'Record return',
    hint: 'It has come back',
    icon: 'return-down-back-outline',
    tone: 'neutral',
  },
  damage: {
    label: 'Report damage',
    hint: 'IT is told it is damaged',
    icon: 'warning-outline',
    tone: 'danger',
  },
};

export function scanActions(input: {
  asset: Pick<ScannedAsset, 'status' | 'assignedUser'>;
  permissions: readonly string[];
  userId: string | null | undefined;
}): ScanAction[] {
  const { asset, permissions, userId } = input;
  const can = (p: string) => permissions.includes(p);
  const isHeld = Boolean(asset.assignedUser);
  const isMine = Boolean(userId && asset.assignedUser?.id === userId);

  const offer = custodyOptions({
    canAssign: can(PERMISSIONS.ASSETS_ASSIGN),
    canReturn: can(PERMISSIONS.ASSETS_RETURN),
    status: asset.status,
    isHeld,
  });

  const keys: ScanActionKey[] = ['open'];
  if (
    canVerifyAssets(permissions) &&
    !(NOT_VERIFIABLE_STATUSES as readonly string[]).includes(asset.status)
  ) {
    keys.push('seen');
  }
  if (offer.show && offer.assign) keys.push('assign');
  if (offer.show && offer.handOver) keys.push('reassign');
  if (offer.show && offer.recordReturn) keys.push('return');
  // The asset screen's rule: a fleet manager or the holder, and not twice.
  if (asset.status !== 'DAMAGED' && (can(PERMISSIONS.ASSETS_UPDATE) || isMine)) keys.push('damage');

  return keys.map((key) => ({ key, ...ACTIONS[key] }));
}

/**
 * Whether the scan stops on the sheet. Only for somebody with floor work to do
 * on this unit: marking it seen or moving its custody. "Report damage" alone
 * does not count - an employee scanning their own laptop keeps the flow they
 * have always had, and finds Report damage on the asset page as before.
 */
export function stopsOnSheet(actions: readonly ScanAction[]): boolean {
  return actions.some(
    (a) => a.key === 'seen' || a.key === 'assign' || a.key === 'reassign' || a.key === 'return',
  );
}

/** Where an act leads: the asset page, asked to open the flow it already has. */
export function scanActionHref(assetId: string, key: Exclude<ScanActionKey, 'seen'>): string {
  return key === 'open' ? `/asset/${assetId}` : `/asset/${assetId}?action=${key}`;
}

/**
 * The `action` the asset screen was opened with, if it is one it knows.
 * `confirm-receipt` (v2.78) comes from the button on a handover push.
 */
export function assetScreenAction(
  param: string | string[] | undefined,
): 'assign' | 'reassign' | 'return' | 'damage' | 'confirm-receipt' | null {
  const value = Array.isArray(param) ? param[0] : param;
  return value === 'assign' ||
    value === 'reassign' ||
    value === 'return' ||
    value === 'damage' ||
    value === 'confirm-receipt'
    ? value
    : null;
}

// ---------------------------------------------------------------------------
// Typing the tag, for a label that will not scan
// ---------------------------------------------------------------------------

/**
 * Pick the asset a typed tag or serial means out of a search. Only an exact
 * match on the tag or the serial counts - the search also matches names, and
 * "Dell" must not quietly open the first of forty laptops.
 */
export function matchTypedCode<T extends { assetTag: string; serialNumber?: string | null }>(
  typed: string,
  candidates: readonly T[],
): { match: T | null; reason: string | null } {
  const want = typed.trim().toLowerCase();
  if (!want)
    return { match: null, reason: 'Type the asset tag or serial number printed on the label.' };
  const exact = candidates.filter(
    (a) => a.assetTag.toLowerCase() === want || (a.serialNumber ?? '').toLowerCase() === want,
  );
  if (exact.length === 1) return { match: exact[0]!, reason: null };
  if (exact.length > 1)
    return {
      match: null,
      reason: 'More than one asset carries that code. Open it from the Assets list instead.',
    };
  return { match: null, reason: `No asset you can see has the tag or serial "${typed.trim()}".` };
}
