/**
 * Microsoft 365 subscriptions, as PioAssets records them (v3.12).
 *
 * Microsoft describes what a tenant owns in two lists that have to be read
 * together. `subscribedSkus` says how many seats exist and how many are in
 * use; `directory/subscriptions` says when each purchase began and when it
 * next renews or lapses. Neither is enough alone, and neither says what it
 * cost - price is not available through this route at all, so cost is never
 * written here and stays something a Finance user types in.
 *
 * Everything in this file is a decision about what may honestly be recorded
 * from those two lists. Each rule exists because the obvious reading of the
 * data produces a wrong number that looks like a right one.
 */

/** The fields of a Graph `subscribedSku` this module reads. */
export interface GraphSubscribedSku {
  skuId: string;
  skuPartNumber: string;
  /** "User" for seat licences, "Company" for tenant-wide entitlements. */
  appliesTo?: string | null;
  /** Enabled | Warning | Suspended | Deleted | LockedOut */
  capabilityStatus?: string | null;
  consumedUnits?: number | null;
  prepaidUnits?: {
    enabled?: number | null;
    warning?: number | null;
    suspended?: number | null;
    lockedOut?: number | null;
  } | null;
}

/** The fields of a Graph `companySubscription` this module reads. */
export interface GraphCompanySubscription {
  skuId: string;
  status?: string | null;
  isTrial?: boolean | null;
  createdDateTime?: string | null;
  nextLifecycleDateTime?: string | null;
}

export type M365Family = 'PRODUCTIVITY_SUITE' | 'SECURITY' | 'OPERATING_SYSTEM';

export interface M365License {
  /** The SKU id: stable for the life of the tenant, unlike the name. */
  externalId: string;
  /** Microsoft's own code for the product, kept verbatim. */
  partNumber: string;
  name: string;
  family: M365Family;
  /** Seats that can be used today. */
  seatsPurchased: number;
  /** Seats Microsoft says are assigned. May exceed `seatsPurchased`. */
  seatsUsed: number;
  /** Microsoft's word for the state of the subscription. */
  status: string;
  /** When it next renews or lapses. Null when Microsoft gives no date. */
  renewalDate: Date | null;
  /** When the earliest purchase began. Null when Microsoft gives no date. */
  purchaseDate: Date | null;
  isTrial: boolean;
}

export interface M365Skipped {
  partNumber: string;
  reason: 'free' | 'empty' | 'not-per-user' | 'deleted';
}

export interface M365Normalized {
  licenses: M365License[];
  skipped: M365Skipped[];
}

/**
 * Microsoft's free and self-service products arrive with 10,000 or 1,000,000
 * "seats" - Power Automate Free, Teams Exploratory and the like. Recorded as
 * licences they would put a million unused seats on the dashboard and bury the
 * twelve subscriptions somebody actually pays for. A tenant that really owns
 * ten thousand paid seats of one product can raise this; nobody else should
 * have to look at them.
 */
export const M365_FREE_SEAT_THRESHOLD = 10_000;

/**
 * Names people recognise, for the codes Microsoft actually returns. Only the
 * common commercial products: for anything not listed the code itself is shown
 * rather than a guess, because a wrong product name on a licence is worse than
 * an unfamiliar one.
 */
const FRIENDLY_NAMES: Record<string, string> = {
  O365_BUSINESS_ESSENTIALS: 'Microsoft 365 Business Basic',
  O365_BUSINESS_PREMIUM: 'Microsoft 365 Business Standard',
  SPB: 'Microsoft 365 Business Premium',
  O365_BUSINESS: 'Microsoft 365 Apps for business',
  OFFICESUBSCRIPTION: 'Microsoft 365 Apps for enterprise',
  STANDARDPACK: 'Office 365 E1',
  ENTERPRISEPACK: 'Office 365 E3',
  ENTERPRISEPREMIUM: 'Office 365 E5',
  SPE_E3: 'Microsoft 365 E3',
  SPE_E5: 'Microsoft 365 E5',
  SPE_F1: 'Microsoft 365 F3',
  EXCHANGESTANDARD: 'Exchange Online (Plan 1)',
  EXCHANGEENTERPRISE: 'Exchange Online (Plan 2)',
  EMS: 'Enterprise Mobility + Security E3',
  EMSPREMIUM: 'Enterprise Mobility + Security E5',
  AAD_PREMIUM: 'Microsoft Entra ID P1',
  AAD_PREMIUM_P2: 'Microsoft Entra ID P2',
  INTUNE_A: 'Microsoft Intune Plan 1',
  POWER_BI_PRO: 'Power BI Pro',
  PROJECTPROFESSIONAL: 'Project Plan 3',
  PROJECTPREMIUM: 'Project Plan 5',
  VISIOCLIENT: 'Visio Plan 2',
  TEAMS_ESSENTIALS: 'Microsoft Teams Essentials',
  MCOMEETADV: 'Microsoft 365 Audio Conferencing',
  MCOEV: 'Microsoft Teams Phone Standard',
  ATP_ENTERPRISE: 'Microsoft Defender for Office 365 (Plan 1)',
  THREAT_INTELLIGENCE: 'Microsoft Defender for Office 365 (Plan 2)',
  DEFENDER_ENDPOINT_P1: 'Microsoft Defender for Endpoint P1',
  WIN10_PRO_ENT_SUB: 'Windows Enterprise E3',
  Microsoft_365_Copilot: 'Microsoft 365 Copilot',
};

/** The product name to show, and whether it is one this module recognises. */
export function m365ProductName(partNumber: string): string {
  return FRIENDLY_NAMES[partNumber] ?? partNumber.replace(/_/g, ' ').trim();
}

function familyOf(name: string): M365Family {
  if (/defender|entra|intune|mobility \+ security|purview/i.test(name)) return 'SECURITY';
  if (/^windows\b/i.test(name)) return 'OPERATING_SYSTEM';
  return 'PRODUCTIVITY_SUITE';
}

const count = (n: number | null | undefined) =>
  typeof n === 'number' && n > 0 ? Math.floor(n) : 0;

const date = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

const earliest = (dates: (Date | null)[]): Date | null =>
  dates.reduce<Date | null>((min, d) => (d && (!min || d < min) ? d : min), null);

/** A subscription still in force: running, or in the grace period after expiry. */
const inForce = (s: GraphCompanySubscription) => s.status === 'Enabled' || s.status === 'Warning';

/**
 * Turns Microsoft's two lists into the licences worth recording.
 *
 *   SEATS ARE THE ONES YOU CAN USE. `enabled` plus `warning`: a subscription
 *   in its grace period still works, so its seats still count. `suspended`
 *   and `lockedOut` seats are not counted - they are owed, not owned.
 *
 *   THE DATE IS THE NEXT ONE THAT MATTERS. A product bought in two batches
 *   has two renewal dates; the earlier is the one somebody has to act on, so
 *   that is the one recorded. Batches that have already lapsed are ignored,
 *   or a subscription that ended last year would make a live one look expired.
 *
 *   NOT EVERYTHING IS A LICENCE. Tenant-wide entitlements have no seats, the
 *   free products have a million, and a row with nothing bought and nothing
 *   used is noise. All three are left out - and REPORTED, so that "we synced
 *   six" is never mistaken for "you own six".
 */
export function normalizeM365Subscriptions(
  skus: GraphSubscribedSku[],
  subscriptions: GraphCompanySubscription[],
  { freeSeatThreshold = M365_FREE_SEAT_THRESHOLD }: { freeSeatThreshold?: number } = {},
): M365Normalized {
  const bySku = new Map<string, GraphCompanySubscription[]>();
  for (const s of subscriptions) {
    const list = bySku.get(s.skuId) ?? [];
    list.push(s);
    bySku.set(s.skuId, list);
  }

  const licenses: M365License[] = [];
  const skipped: M365Skipped[] = [];

  for (const sku of skus) {
    const partNumber = sku.skuPartNumber;
    if (sku.capabilityStatus === 'Deleted') {
      skipped.push({ partNumber, reason: 'deleted' });
      continue;
    }
    if (sku.appliesTo && sku.appliesTo !== 'User') {
      skipped.push({ partNumber, reason: 'not-per-user' });
      continue;
    }

    const seatsPurchased = count(sku.prepaidUnits?.enabled) + count(sku.prepaidUnits?.warning);
    const seatsUsed = count(sku.consumedUnits);

    if (seatsPurchased >= freeSeatThreshold) {
      skipped.push({ partNumber, reason: 'free' });
      continue;
    }
    if (seatsPurchased === 0 && seatsUsed === 0) {
      skipped.push({ partNumber, reason: 'empty' });
      continue;
    }

    const mine = bySku.get(sku.skuId) ?? [];
    const live = mine.filter(inForce);
    const baseName = m365ProductName(partNumber);
    // A trial only if EVERY live purchase is one: a paid subscription with a
    // trial top-up beside it is a paid subscription.
    const isTrial = live.length > 0 && live.every((s) => s.isTrial === true);

    licenses.push({
      externalId: sku.skuId,
      partNumber,
      name: isTrial ? `${baseName} (trial)` : baseName,
      family: familyOf(baseName),
      seatsPurchased,
      seatsUsed,
      status: sku.capabilityStatus ?? 'Unknown',
      renewalDate: earliest(live.map((s) => date(s.nextLifecycleDateTime))),
      purchaseDate: earliest(mine.map((s) => date(s.createdDateTime))),
      isTrial,
    });
  }

  licenses.sort((a, b) => a.name.localeCompare(b.name));
  return { licenses, skipped };
}

// ── deciding what to write ────────────────────────────────────────────────────

/** A licence PioAssets already holds from an earlier sync. */
export interface M365Existing {
  id: string;
  externalId: string;
  name: string;
  seatsPurchased: number;
  seatsUsed: number | null;
  renewalDate: Date | null;
  externalStatus: string | null;
  retired: boolean;
}

export interface M365SyncPlan {
  create: M365License[];
  update: {
    id: string;
    license: M365License;
    /** Seats added (or removed) since the last sync. Zero when unchanged. */
    seatsDelta: number;
    /** True when anything a reader would see is different. */
    changed: boolean;
    /** True when it had been retired and Microsoft now lists it again. */
    revived: boolean;
  }[];
  /** Held here, no longer listed by Microsoft, and not yet retired. */
  retire: { id: string; name: string }[];
}

const sameDay = (a: Date | null, b: Date | null) =>
  (a === null && b === null) || (a !== null && b !== null && a.getTime() === b.getTime());

/**
 * Compares what Microsoft lists now with what is already recorded.
 *
 *   MATCHED BY ID, NEVER BY NAME. Microsoft renames products (Office 365
 *   Business Premium became Microsoft 365 Business Standard overnight); the
 *   SKU id is what stays put. Matching on the name would have turned that
 *   rename into one licence retired and a second one created, with the cost
 *   and notes somebody typed left behind on the dead one.
 *
 *   GONE MEANS RETIRED, NOT DELETED. A subscription that is cancelled was
 *   still owned and paid for until then. Deleting the record would remove the
 *   history along with it.
 *
 *   A SEAT CHANGE IS REPORTED AS A DELTA, so the caller can add it to the
 *   append-only renewal history rather than overwrite the number and lose the
 *   fact that it ever changed.
 */
export function planM365Sync(existing: M365Existing[], incoming: M365License[]): M365SyncPlan {
  const held = new Map(existing.map((e) => [e.externalId, e]));
  const listed = new Set(incoming.map((l) => l.externalId));

  const plan: M365SyncPlan = { create: [], update: [], retire: [] };

  for (const license of incoming) {
    const current = held.get(license.externalId);
    if (!current) {
      plan.create.push(license);
      continue;
    }
    const seatsDelta = license.seatsPurchased - current.seatsPurchased;
    plan.update.push({
      id: current.id,
      license,
      seatsDelta,
      revived: current.retired,
      changed:
        current.retired ||
        seatsDelta !== 0 ||
        current.name !== license.name ||
        current.seatsUsed !== license.seatsUsed ||
        current.externalStatus !== license.status ||
        !sameDay(current.renewalDate, license.renewalDate),
    });
  }

  for (const e of existing) {
    if (!listed.has(e.externalId) && !e.retired) plan.retire.push({ id: e.id, name: e.name });
  }

  return plan;
}

/**
 * How many seats to show as taken.
 *
 * Microsoft will report more seats in use than owned - it happens while a
 * subscription is being reduced, and during a grace period. The app's seat
 * counter is guarded by a database rule that it can never exceed the seats
 * allocated, and that rule is right for licences managed here. So the counter
 * is capped at what is owned, and the true figure is kept separately so the
 * overshoot can still be shown rather than quietly absorbed.
 */
export function m365SeatsReserved(license: Pick<M365License, 'seatsPurchased' | 'seatsUsed'>): {
  reserved: number;
  overAssignedBy: number;
} {
  return {
    reserved: Math.min(license.seatsUsed, license.seatsPurchased),
    overAssignedBy: Math.max(0, license.seatsUsed - license.seatsPurchased),
  };
}
