/**
 * The asset detail page's derived wording, shared by the web and the phone.
 *
 * Both apps render the same asset from the same `GET /assets/:id` payload, and
 * every label here was first written inside the web page. The phone then grew
 * its own copies - "Status → ASSIGNED" on one side, "AVAILABLE → ASSIGNED" on
 * the other - and a client comparing the two screens side by side reads the
 * difference as one of them being wrong. So the pure part lives here and both
 * apps only lay it out: nothing below knows about React, the DOM or React
 * Native, and nothing below may drift between them.
 *
 * Tones are the ui-tokens tone names as plain strings (this package sits under
 * ui-tokens, so it cannot import the type). Dates stay as values or go through
 * a formatter the caller passes, so each app keeps its own date style.
 */

import { ASSET_TYPES_BY_KEY, isAgentReportedType } from './asset-types';

export type DetailTone = 'success' | 'warning' | 'critical' | 'info' | 'progress' | 'muted';

// ---------------------------------------------------------------------------
// How old the agent's snapshot is (web: reported-freshness.tsx, v2.38)
// ---------------------------------------------------------------------------

/** Past this, a machine has almost certainly stopped reporting rather than being off for the weekend. */
export const REPORT_STALE_DAYS = 7;
/** Past this it is worth a glance, but a laptop off over a weekend is normal. */
export const REPORT_AGEING_DAYS = 2;

function daysSince(at: string, now: number): number {
  return (now - new Date(at).getTime()) / 86_400_000;
}

/** "3 hours ago", "8 days ago" - the form that makes age obvious at a glance. */
export function relativeAge(at: string, now: number = Date.now()): string {
  const days = daysSince(at, now);
  if (days < 1 / 24) return 'just now';
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const whole = Math.round(days);
  return `${whole} day${whole === 1 ? '' : 's'} ago`;
}

export type ReportFreshness = 'fresh' | 'ageing' | 'stale';

/** Which of the three treatments a snapshot of this age gets. */
export function reportFreshness(at: string, now: number = Date.now()): ReportFreshness {
  const days = daysSince(at, now);
  if (days >= REPORT_STALE_DAYS) return 'stale';
  if (days >= REPORT_AGEING_DAYS) return 'ageing';
  return 'fresh';
}

/**
 * What the banner above an agent snapshot says. Stale gets a bold headline and
 * a warning body; fresh and ageing get one quiet line, relative age first
 * because that is the part being judged, the exact time after it for anyone
 * who needs to quote it. `exact` is the caller's own date-time rendering.
 */
export function reportFreshnessWording(
  source: string,
  at: string,
  exact: string,
  now: number = Date.now(),
): { freshness: ReportFreshness; headline: string; detail: string | null } {
  const freshness = reportFreshness(at, now);
  const who = source.toLowerCase();
  const age = relativeAge(at, now);
  if (freshness === 'stale') {
    return {
      freshness,
      headline: `This machine last reported ${age}.`,
      detail: `What follows is a snapshot from ${exact}, not its current state — the ${who} has stopped checking in, so anything changed since then is not shown here.`,
    };
  }
  return { freshness, headline: `Reported by ${who} ${age} · ${exact}`, detail: null };
}

// ---------------------------------------------------------------------------
// Which tabs exist (web: assets/[id]/page.tsx)
// ---------------------------------------------------------------------------

export type AssetDetailTabKey =
  | 'overview'
  | 'lifecycle'
  | 'hardware'
  | 'os'
  | 'software'
  | 'health'
  | 'history'
  | 'financials';

/**
 * The agent-reported sections belong to things that boot. A headset shows
 * four tabs that say "Nothing discovered yet" forever, which reads as
 * discovery being broken rather than inapplicable.
 *
 * They are still shown for any asset that actually carries the data, whatever
 * its type: something reported it, and hiding that would lose real
 * information. Only the permanently-empty case disappears.
 */
export function hasDiscoveryTabs(asset: {
  subcategory?: { key: string } | null;
  hardwareProfile?: unknown;
  osInfo?: unknown;
  health?: unknown;
  _count?: { installedSoftware: number } | null;
}): boolean {
  return (
    isAgentReportedType(asset.subcategory?.key) ||
    Boolean(asset.hardwareProfile) ||
    Boolean(asset.osInfo) ||
    Boolean(asset.health) ||
    (asset._count?.installedSoftware ?? 0) > 0
  );
}

/** The tab strip, in order. Financials only for holders of assets:cost:read. */
export function assetDetailTabs(input: {
  showDiscovery: boolean;
  softwareCount: number;
  canSeeCost: boolean;
}): { key: AssetDetailTabKey; label: string }[] {
  return [
    { key: 'overview', label: 'Overview' },
    { key: 'lifecycle', label: 'Lifecycle' },
    ...(input.showDiscovery
      ? [
          { key: 'hardware' as const, label: 'Hardware' },
          { key: 'os' as const, label: 'OS & Security' },
          {
            key: 'software' as const,
            label: `Software${input.softwareCount ? ` (${input.softwareCount})` : ''}`,
          },
          { key: 'health' as const, label: 'Health' },
        ]
      : []),
    { key: 'history', label: 'History' },
    ...(input.canSeeCost ? [{ key: 'financials' as const, label: 'Financials' }] : []),
  ];
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

interface NamedProfile {
  firstName: string;
  lastName: string;
}

/**
 * Who handed the current holder the device, from the open assignment. Null for
 * imported records - nobody issued those inside the system, and inventing a
 * name would be worse than saying nothing.
 */
export function issuedByName(
  assignments: readonly {
    returnedAt: string | null;
    assignedBy?: { profile: NamedProfile | null } | null;
  }[],
): string | null {
  const open = assignments.find((a) => !a.returnedAt);
  const p = open?.assignedBy?.profile;
  return p ? `${p.firstName} ${p.lastName}` : null;
}

/**
 * The stored specification in the type's own field order, labelled from the
 * shared catalogue rather than as raw keys, so two monitors always read the
 * same way round. An unknown type falls back to the stored pairs as-is.
 */
export function assetSpecRows(
  typeKey: string | null | undefined,
  specs: Record<string, string> | null | undefined,
): { title: string; rows: [string, string][] } {
  const typeDef = typeKey ? ASSET_TYPES_BY_KEY[typeKey] : undefined;
  const rows: [string, string][] = typeDef
    ? typeDef.fields
        .filter((f) => specs?.[f.key])
        .map((f) => [f.unit ? `${f.label} (${f.unit})` : f.label, specs![f.key]!])
    : Object.entries(specs ?? {});
  return { title: typeDef?.name ?? 'Specification', rows };
}

// ---------------------------------------------------------------------------
// Hardware / OS & Security (web: discovery-tabs.tsx)
// ---------------------------------------------------------------------------

export interface DetailRow {
  label: string;
  /** Null renders as a dash - never an invented value. */
  value: string | null;
  /** Set when the value is shown as a coloured badge. */
  tone?: DetailTone;
}

export interface HardwareSnapshot {
  manufacturer: string | null;
  modelName: string | null;
  cpu: string | null;
  cpuCores: number | null;
  ramGb: string | null;
  ramSlotsUsed: number | null;
  ramSlotsTotal: number | null;
  storageTotalGb: string | null;
  storageFreeGb: string | null;
  smartStatus: 'HEALTHY' | 'WARNING' | 'FAILING' | null;
  batteryHealthPct: number | null;
  batteryCycleCount: number | null;
  gpu: string | null;
  biosVersion: string | null;
}

export const SMART_TONE: Readonly<Record<NonNullable<HardwareSnapshot['smartStatus']>, DetailTone>> = {
  HEALTHY: 'success',
  WARNING: 'warning',
  FAILING: 'critical',
};

/** Decimal-string gigabytes with grouping, e.g. "1,024 GB". */
export function formatGb(v: string | null): string | null {
  return v != null ? `${Number(v).toLocaleString()} GB` : null;
}

const str = (v: number | null): string | null => (v != null ? String(v) : null);

export function hardwareRows(hw: HardwareSnapshot): DetailRow[] {
  return [
    { label: 'Manufacturer', value: hw.manufacturer },
    { label: 'Model', value: hw.modelName },
    { label: 'Processor', value: hw.cpu },
    { label: 'Cores', value: str(hw.cpuCores) },
    { label: 'Memory', value: formatGb(hw.ramGb) },
    {
      label: 'Memory slots',
      value: hw.ramSlotsTotal != null ? `${hw.ramSlotsUsed ?? '?'} of ${hw.ramSlotsTotal} used` : null,
    },
    { label: 'Storage', value: formatGb(hw.storageTotalGb) },
    { label: 'Free space', value: formatGb(hw.storageFreeGb) },
    hw.smartStatus
      ? { label: 'Drive (SMART)', value: hw.smartStatus.toLowerCase(), tone: SMART_TONE[hw.smartStatus] }
      : { label: 'Drive (SMART)', value: null },
    { label: 'Battery', value: hw.batteryHealthPct != null ? `${hw.batteryHealthPct}% health` : null },
    { label: 'Battery cycles', value: str(hw.batteryCycleCount) },
    { label: 'Graphics', value: hw.gpu },
    { label: 'BIOS', value: hw.biosVersion },
  ];
}

export interface OsSnapshot {
  osName: string | null;
  osVersion: string | null;
  osBuild: string | null;
  osSupported: boolean | null;
  osActivated: boolean | null;
  lastBootAt: string | null;
  diskEncrypted: boolean | null;
  defenderEnabled: boolean | null;
  firewallEnabled: boolean | null;
  tpmPresent: boolean | null;
  localAdminCount: number | null;
  missingCriticalPatches: number | null;
}

/** The "Operating system" card. Last boot goes through the caller's formatter. */
export function osRows(os: OsSnapshot, formatDateTime: (iso: string) => string): DetailRow[] {
  return [
    { label: 'OS', value: os.osName },
    { label: 'Version', value: os.osVersion },
    { label: 'Build', value: os.osBuild },
    os.osSupported == null
      ? { label: 'Support', value: null }
      : {
          label: 'Support',
          value: os.osSupported ? 'supported' : 'out of support',
          tone: os.osSupported ? 'success' : 'critical',
        },
    os.osActivated == null
      ? { label: 'Activation', value: null }
      : {
          label: 'Activation',
          value: os.osActivated ? 'activated' : 'not activated',
          tone: os.osActivated ? 'success' : 'warning',
        },
    { label: 'Last boot', value: os.lastBootAt ? formatDateTime(os.lastBootAt) : null },
  ];
}

export interface PostureRow {
  label: string;
  /** Null when the agent did not report it - shown as "not reported". */
  state: { text: string; tone: 'success' | 'critical' } | null;
}

function posture(label: string, ok: boolean | null, detail?: string): PostureRow {
  return {
    label,
    state: ok === null ? null : { text: detail ?? (ok ? 'on' : 'off'), tone: ok ? 'success' : 'critical' },
  };
}

/** The "Security posture" card. */
export function securityPostureRows(os: OsSnapshot): PostureRow[] {
  return [
    posture('Disk encryption', os.diskEncrypted),
    posture('Antivirus', os.defenderEnabled),
    posture('Firewall', os.firewallEnabled),
    posture('TPM', os.tpmPresent, os.tpmPresent ? 'present' : 'missing'),
    posture(
      'Local administrators',
      os.localAdminCount == null ? null : os.localAdminCount <= 1,
      os.localAdminCount != null ? `${os.localAdminCount}` : undefined,
    ),
    posture(
      'Missing critical updates',
      os.missingCriticalPatches == null ? null : os.missingCriticalPatches === 0,
      os.missingCriticalPatches != null ? `${os.missingCriticalPatches}` : undefined,
    ),
  ];
}

// ---------------------------------------------------------------------------
// Health tab
// ---------------------------------------------------------------------------

export const HEALTH_GRADE_TONE: Readonly<
  Record<'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'CRITICAL', DetailTone>
> = {
  EXCELLENT: 'success',
  GOOD: 'success',
  FAIR: 'warning',
  POOR: 'critical',
  CRITICAL: 'critical',
};

const HEALTH_DIMENSION_LABELS: Record<string, string> = {
  battery: 'Battery',
  storage: 'Storage',
  memory: 'Memory',
  warranty: 'Warranty',
  security: 'Security',
  updates: 'Updates',
};

export function healthDimensionLabel(key: string): string {
  return HEALTH_DIMENSION_LABELS[key] ?? key;
}

/** The bar colour for one sub-score. */
export function healthSubScoreTone(score: number): 'success' | 'warning' | 'critical' {
  return score >= 75 ? 'success' : score >= 40 ? 'warning' : 'critical';
}

// ---------------------------------------------------------------------------
// History and lifecycle
// ---------------------------------------------------------------------------

interface HistoryPerson {
  email: string;
  profile: NamedProfile | null;
}

export interface DetailAssignment {
  id: string;
  assignedAt: string;
  returnedAt: string | null;
  assignedBy?: { profile: NamedProfile | null } | null;
  user: HistoryPerson | null;
  assetReturn: { conditionIn?: string | null; damageNotes: string | null } | null;
}

export interface DetailConditionLog {
  id: string;
  recordedAt: string;
  previousStatus: string | null;
  newStatus: string | null;
  previousCondition: string | null;
  newCondition: string | null;
  reason: string | null;
}

export interface CustodyHistoryEntry {
  key: string;
  kind: 'assignment' | 'condition';
  title: string;
  /** Already formatted. */
  date: string;
  /** Trails the date, e.g. " · issued by Asha Rao". Empty when there is none. */
  suffix: string;
  note: string | null;
  /** Damage notes read as a warning; a status reason is quiet. */
  noteTone: 'warning' | 'muted';
}

/**
 * The "Custody & condition history" list: assignments (newest first, as the
 * API sends them), then condition and status changes.
 */
export function custodyHistory(
  data: { assignments: readonly DetailAssignment[]; conditionLogs: readonly DetailConditionLog[] },
  formatDate: (iso: string) => string,
): CustodyHistoryEntry[] {
  const entries: CustodyHistoryEntry[] = [];
  for (const a of data.assignments) {
    entries.push({
      key: `a-${a.id}`,
      kind: 'assignment',
      title: `${a.returnedAt ? 'Returned by ' : 'Assigned to '}${
        a.user?.profile ? `${a.user.profile.firstName} ${a.user.profile.lastName}` : (a.user?.email ?? 'someone')
      }`,
      date: formatDate(a.returnedAt ?? a.assignedAt),
      suffix:
        !a.returnedAt && a.assignedBy?.profile
          ? ` · issued by ${a.assignedBy.profile.firstName} ${a.assignedBy.profile.lastName}`
          : '',
      note: a.assetReturn?.damageNotes ?? null,
      noteTone: 'warning',
    });
  }
  for (const log of data.conditionLogs) {
    entries.push({
      key: `c-${log.id}`,
      kind: 'condition',
      title:
        log.previousStatus && log.newStatus && log.previousStatus !== log.newStatus
          ? `${log.previousStatus} → ${log.newStatus}`
          : log.previousCondition && log.newCondition
            ? `Condition ${log.previousCondition} → ${log.newCondition}`
            : 'Status change',
      date: formatDate(log.recordedAt),
      suffix: '',
      note: log.reason ?? null,
      noteTone: 'muted',
    });
  }
  return entries;
}

/**
 * Calendar months between two dates, ignoring the day of the month - for the
 * lifecycle tab's age and warranty-remaining. Not depreciation's
 * `monthsBetween`, which waits for the day of the month to come round.
 */
export function calendarMonthsBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()));
}

/** "2 yrs 3 mo" - a dash for nothing at all. */
export function humanDuration(months: number): string {
  if (months <= 0) return '—';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} yr${y > 1 ? 's' : ''}` : '', m ? `${m} mo` : ''].filter(Boolean).join(' ') || '—';
}

export interface LifecycleEvent {
  date: Date | null;
  title: string;
  detail?: string;
  tone: DetailTone;
}

export interface DeviceLifecycle {
  chips: { label: string; value: string }[];
  events: LifecycleEvent[];
  /** The real total, not the length of the capped assignment list. */
  timesAssigned: number;
}

/**
 * Device lifecycle (v2.12) - the story of one device, for the person holding it.
 *
 * Built entirely from data the asset endpoint already returns and already
 * anonymises for OWN-scope viewers: purchase and warranty dates, assignment
 * events (previous holders reduced to a count, never named), and condition /
 * status changes that stand in for repairs and maintenance. No cost, no vendor,
 * no colleague identities - those never leave the API for an employee.
 */
export function deviceLifecycle(
  data: {
    purchaseDate: string | null;
    warrantyStartDate?: string | null;
    warrantyEndDate: string | null;
    expectedReplacementDate?: string | null;
    assignmentCount?: number;
    assignments: readonly DetailAssignment[];
    conditionLogs: readonly DetailConditionLog[];
  },
  formatDate: (iso: string | null) => string,
  now: Date = new Date(),
): DeviceLifecycle {
  const purchase = data.purchaseDate ? new Date(data.purchaseDate) : null;
  const warrantyEnd = data.warrantyEndDate ? new Date(data.warrantyEndDate) : null;
  const ageMonths = purchase ? calendarMonthsBetween(purchase, now) : 0;
  const warrantyMonthsLeft = warrantyEnd && warrantyEnd > now ? calendarMonthsBetween(now, warrantyEnd) : 0;
  const underWarranty = Boolean(warrantyEnd && warrantyEnd > now);

  const events: LifecycleEvent[] = [];
  if (purchase) events.push({ date: purchase, title: 'Purchased', tone: 'info' });
  if (data.warrantyStartDate)
    events.push({ date: new Date(data.warrantyStartDate), title: 'Warranty started', tone: 'success' });

  for (const a of data.assignments) {
    events.push({
      date: new Date(a.assignedAt),
      title: a.user ? 'Assigned to you' : 'Assigned',
      detail: a.user ? undefined : 'to a team member',
      tone: 'progress',
    });
    if (a.returnedAt)
      events.push({
        date: new Date(a.returnedAt),
        title: 'Returned',
        detail: a.assetReturn?.conditionIn ? `condition: ${a.assetReturn.conditionIn.toLowerCase()}` : undefined,
        tone: 'muted',
      });
  }

  for (const log of data.conditionLogs) {
    const bits = [
      log.previousStatus && log.newStatus && log.previousStatus !== log.newStatus
        ? `${log.previousStatus.toLowerCase()} → ${log.newStatus.toLowerCase()}`
        : null,
      log.previousCondition && log.newCondition && log.previousCondition !== log.newCondition
        ? `condition ${log.newCondition.toLowerCase()}`
        : null,
      log.reason ?? null,
    ].filter(Boolean);
    events.push({
      date: new Date(log.recordedAt),
      title: 'Status update',
      detail: bits.join(' · ') || undefined,
      tone: 'warning',
    });
  }

  if (warrantyEnd)
    events.push({
      date: warrantyEnd,
      title: warrantyEnd > now ? 'Warranty ends' : 'Warranty ended',
      tone: warrantyEnd > now ? 'muted' : 'critical',
    });
  if (data.expectedReplacementDate)
    events.push({
      date: new Date(data.expectedReplacementDate),
      title: 'Expected replacement',
      tone: 'info',
    });

  // Chronological story, oldest first, ending with where the device stands now.
  events.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));

  const timesAssigned = data.assignmentCount ?? data.assignments.length;
  const chips = [
    { label: 'Purchased', value: formatDate(data.purchaseDate) },
    { label: 'Asset age', value: purchase ? humanDuration(ageMonths) : '—' },
    {
      label: 'Warranty',
      value: warrantyEnd ? (underWarranty ? `${humanDuration(warrantyMonthsLeft)} left` : 'Expired') : '—',
    },
    { label: 'Expected replacement', value: formatDate(data.expectedReplacementDate ?? null) },
    { label: 'Times assigned', value: String(timesAssigned) },
  ];

  return { chips, events, timesAssigned };
}

// ---------------------------------------------------------------------------
// Custody, condition photos and the kit (web: custody-panel.tsx,
// condition-photos.tsx, equipment-kit.tsx)
// ---------------------------------------------------------------------------

/**
 * Which custody moves to offer. Nothing at all when the actor has neither right
 * or the asset is in a state where custody cannot move (under repair,
 * disposed…) - saying nothing beats a dead button. The API re-checks all of it.
 */
export function custodyOptions(input: {
  canAssign: boolean;
  canReturn: boolean;
  status: string;
  isHeld: boolean;
}): { show: boolean; assign: boolean; handOver: boolean; recordReturn: boolean } {
  const assignable = input.status === 'AVAILABLE' || input.status === 'RESERVED';
  const show = (input.canAssign || input.canReturn) && (input.isHeld || assignable);
  return {
    show,
    assign: show && !input.isHeld && assignable && input.canAssign,
    handOver: show && input.isHeld && input.canAssign && input.canReturn,
    recordReturn: show && input.isHeld && input.canReturn,
  };
}

/**
 * The one line shown when an asset has no condition photos but the viewer
 * could add some. Which line depends on whether there is a custody event to
 * attach to at all: an asset can show a holder while having no handover
 * record, which is how the import left them, and telling someone to "assign it
 * first" when the page says it is already with somebody loses their trust.
 */
export function conditionPhotosEmptyMessage(hasCustodyEvent: boolean, holderName: string | null | undefined): string {
  return hasCustodyEvent
    ? 'No photos recorded yet.'
    : holderName
      ? `Recorded as being with ${holderName}, but never handed over through the system — imported records carry no handover. Use "Hand over" above, and photos will attach to it.`
      : 'Photos attach to a handover or a return, so there is nothing to attach them to until this asset is given to someone.';
}

/** Serial is the usual identifier; a phone is known by its IMEI, a NIC by MAC. */
export function assetIdentifier(a: {
  serialNumber?: string | null;
  imei?: string | null;
  macAddress?: string | null;
}): { label: string; value: string } | null {
  if (a.serialNumber) return { label: 'SN', value: a.serialNumber };
  if (a.imei) return { label: 'IMEI', value: a.imei };
  if (a.macAddress) return { label: 'MAC', value: a.macAddress };
  return null;
}

// ---------------------------------------------------------------------------
// The agent tabs' fixed sentences
// ---------------------------------------------------------------------------

/**
 * What each agent tab says when there is nothing to show - an empty state,
 * never invented values - and the health card's two fixed sentences.
 */
export const ASSET_DETAIL_COPY = {
  notDiscovered: {
    title: 'Nothing discovered yet',
    description:
      'No agent or connector has reported this machine. Data appears here after a discovery run matches it.',
  },
  noSoftware: {
    title: 'No software inventory',
    description: 'Installed applications appear here once discovery reports this machine.',
  },
  noHealth: {
    title: 'No health score',
    description:
      'Health is derived from discovered hardware and security posture. Nothing is known about this machine yet, so no score is shown — never a made-up one.',
  },
  healthCapped:
    'Capped at Poor: a safety-critical dimension (security or storage) scored badly, so the overall cannot read higher no matter how good the rest looks.',
  healthExcluded: 'dimensions discovery knows nothing about are excluded, not guessed.',
} as const;
