import {
  assetDetailTabs,
  formatGb,
  SMART_TONE,
  type AssetDetailTabKey,
  type HardwareSnapshot,
} from '@techpioasset/domain';

/**
 * The redesigned asset page's pure helpers (v2.61): which picture leads, which
 * health tiles exist, what the side nav lists. Nothing here touches React, so
 * every rule can be tested against a plain object.
 */

// ---------------------------------------------------------------------------
// The side nav
// ---------------------------------------------------------------------------

/** The domain's tabs plus the two the web adds: notes and attachments. */
export type AssetDetailNavKey = AssetDetailTabKey | 'notes' | 'attachments';

export interface AssetNavItem {
  key: AssetDetailNavKey;
  label: string;
  /** A count shown as a pill after the label, e.g. installed software. */
  badge?: number;
}

/**
 * The side nav in order. Built from the domain's tab list so the web and the
 * phone agree on which agent tabs exist and when; the count moves out of the
 * label and into a badge because a vertical nav has room for one.
 */
export function assetDetailNav(input: {
  showDiscovery: boolean;
  softwareCount: number;
  canSeeCost: boolean;
}): AssetNavItem[] {
  const items: AssetNavItem[] = [];
  for (const tab of assetDetailTabs(input)) {
    if (tab.key === 'software') {
      items.push({
        key: 'software',
        label: 'Software',
        ...(input.softwareCount ? { badge: input.softwareCount } : {}),
      });
    } else {
      items.push({ key: tab.key, label: tab.label });
    }
    // Notes and attachments sit after the record's history and before money.
    if (tab.key === 'history') {
      items.push({ key: 'notes', label: 'Notes' }, { key: 'attachments', label: 'Attachments' });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Which picture leads
// ---------------------------------------------------------------------------

export type IllustrationIcon =
  | 'laptop'
  | 'desktop'
  | 'monitor'
  | 'phone'
  | 'tablet'
  | 'headset'
  | 'printer'
  | 'keyboard'
  | 'mouse'
  | 'network'
  | 'server'
  | 'other';

const ILLUSTRATION_BY_TYPE: Readonly<Record<string, IllustrationIcon>> = {
  laptop: 'laptop',
  desktop: 'desktop',
  server: 'server',
  monitor: 'monitor',
  projector: 'monitor',
  'mobile-phone': 'phone',
  tablet: 'tablet',
  headset: 'headset',
  printer: 'printer',
  scanner: 'printer',
  keyboard: 'keyboard',
  mouse: 'mouse',
  'network-switch': 'network',
  firewall: 'network',
  'wireless-access-point': 'network',
  'docking-station': 'network',
  ups: 'server',
  'external-storage': 'server',
};

/** The clean illustration for a type; unknown or untyped assets get a box. */
export function illustrationIcon(typeKey: string | null | undefined): IllustrationIcon {
  return (typeKey && ILLUSTRATION_BY_TYPE[typeKey]) || 'other';
}

export type AssetImageSource =
  /** The catalogue listing's primary picture - the unit came through procurement. */
  | { kind: 'catalogue'; productId: string; imageId: string }
  /** A picture somebody uploaded of this very unit. */
  | { kind: 'photo'; photoId: string }
  /** Nothing on file: an illustration by type, plus the brand. */
  | { kind: 'illustration'; icon: IllustrationIcon; brand: string | null };

/**
 * Catalogue first, then the unit's own photo, then an illustration. The
 * listing wins because it is the better picture of what was bought; the
 * unit's own photo is the fallback for everything that never went through
 * the catalogue, which is most of the register.
 */
export function resolveAssetImageSource(asset: {
  vendorProduct?: { id: string; primaryImageId?: string | null } | null;
  photo?: { id: string } | null;
  subcategory?: { key: string } | null;
  brand: string | null;
}): AssetImageSource {
  if (asset.vendorProduct?.primaryImageId) {
    return {
      kind: 'catalogue',
      productId: asset.vendorProduct.id,
      imageId: asset.vendorProduct.primaryImageId,
    };
  }
  if (asset.photo) return { kind: 'photo', photoId: asset.photo.id };
  return {
    kind: 'illustration',
    icon: illustrationIcon(asset.subcategory?.key),
    brand: asset.brand,
  };
}

// ---------------------------------------------------------------------------
// Device health tiles
// ---------------------------------------------------------------------------

export interface HealthTile {
  key: 'disk' | 'memory' | 'battery' | 'smart' | 'uptime';
  label: string;
  value: string;
  hint?: string;
  tone?: 'success' | 'warning' | 'critical';
  /** 0-100 when the tile has a fill bar (disk, battery). */
  percent?: number;
}

/** "3d 4h", "5h 12m", "42m" - whole units, largest two. */
export function formatUptime(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

const num = (v: string | null): number | null => (v != null && v !== '' ? Number(v) : null);

/**
 * The tiles the agent's snapshot can honestly fill. The agent reports installed
 * memory, total and free storage, battery health, SMART and the last boot -
 * not live CPU or memory usage - so those tiles do not exist here rather than
 * showing a number nobody measured. Each tile is dropped when its field is
 * missing, so an asset with no battery has no battery tile.
 *
 * Uptime is measured to the moment of the report, not to now: a machine that
 * last checked in eight days ago has not been "up 8 days" since.
 */
export function deviceHealthTiles(
  hw: HardwareSnapshot | null | undefined,
  os: { lastBootAt: string | null; lastDiscoveredAt?: string } | null | undefined,
): HealthTile[] {
  const tiles: HealthTile[] = [];
  if (hw) {
    const total = num(hw.storageTotalGb);
    const free = num(hw.storageFreeGb);
    if (total != null && total > 0 && free != null) {
      const used = Math.max(0, total - free);
      const percent = Math.min(100, Math.round((used / total) * 100));
      tiles.push({
        key: 'disk',
        label: 'Disk usage',
        value: `${used.toLocaleString()} / ${total.toLocaleString()} GB`,
        hint: `${free.toLocaleString()} GB free`,
        percent,
        tone: percent >= 90 ? 'critical' : percent >= 75 ? 'warning' : 'success',
      });
    }
    const ram = formatGb(hw.ramGb);
    if (ram) {
      tiles.push({
        key: 'memory',
        label: 'Memory installed',
        value: ram,
        ...(hw.ramSlotsTotal != null
          ? { hint: `${hw.ramSlotsUsed ?? '?'} of ${hw.ramSlotsTotal} slots used` }
          : {}),
      });
    }
    if (hw.batteryHealthPct != null) {
      const pct = hw.batteryHealthPct;
      tiles.push({
        key: 'battery',
        label: 'Battery health',
        value: `${pct}%`,
        ...(hw.batteryCycleCount != null ? { hint: `${hw.batteryCycleCount} cycles` } : {}),
        percent: Math.max(0, Math.min(100, pct)),
        tone: pct < 50 ? 'critical' : pct < 80 ? 'warning' : 'success',
      });
    }
    if (hw.smartStatus) {
      tiles.push({
        key: 'smart',
        label: 'Drive (SMART)',
        value: hw.smartStatus.toLowerCase(),
        tone: SMART_TONE[hw.smartStatus] as HealthTile['tone'],
      });
    }
  }
  if (os?.lastBootAt) {
    const reportedAt = os.lastDiscoveredAt ? new Date(os.lastDiscoveredAt).getTime() : Date.now();
    const booted = new Date(os.lastBootAt).getTime();
    if (Number.isFinite(booted) && reportedAt >= booted) {
      tiles.push({
        key: 'uptime',
        label: 'Uptime',
        value: formatUptime(reportedAt - booted),
        hint: 'at last report',
      });
    }
  }
  return tiles;
}

/**
 * When the agent last reported, whichever snapshot is newer. Null when nothing
 * has ever reported - the header then shows no "last sync" block at all.
 */
export function latestAgentReport(
  hw: { source: string; lastDiscoveredAt: string } | null | undefined,
  os: { source: string; lastDiscoveredAt: string } | null | undefined,
): { at: string; source: string } | null {
  const candidates = [hw, os].filter((s): s is { source: string; lastDiscoveredAt: string } =>
    Boolean(s?.lastDiscoveredAt),
  );
  if (candidates.length === 0) return null;
  const newest = candidates.reduce((a, b) =>
    new Date(b.lastDiscoveredAt).getTime() > new Date(a.lastDiscoveredAt).getTime() ? b : a,
  );
  return { at: newest.lastDiscoveredAt, source: newest.source };
}

// ---------------------------------------------------------------------------
// Overview cards
// ---------------------------------------------------------------------------

const CONDITION_SENTENCE: Readonly<Record<string, string>> = {
  NEW: 'Brand new, never issued.',
  GOOD: 'Device is in good condition.',
  FAIR: 'Shows wear but is fully serviceable.',
  POOR: 'In poor condition — consider repair or replacement.',
  DAMAGED: 'Damaged and awaiting attention.',
  UNUSABLE: 'Not usable in its current state.',
  END_OF_LIFE: 'At the end of its life — due for retirement.',
};

/** The one-line reading under the condition badge. */
export function conditionSentence(condition: string): string {
  return CONDITION_SENTENCE[condition] ?? 'Condition recorded.';
}

/**
 * The "Quick specs" card: agent-reported values first, the register's typed
 * specification second, so a monitor with no agent still shows what was typed.
 */
export function quickSpecs(input: {
  hw: { cpu: string | null; ramGb: string | null } | null | undefined;
  os: { osName: string | null; osVersion: string | null } | null | undefined;
  specs: Record<string, string> | null | undefined;
  assetTag: string;
}): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const cpu = input.hw?.cpu ?? input.specs?.cpu;
  if (cpu) rows.push({ label: 'Processor', value: cpu });
  const ram =
    formatGb(input.hw?.ramGb ?? null) ?? (input.specs?.ramGb ? `${input.specs.ramGb} GB` : null);
  if (ram) rows.push({ label: 'RAM', value: ram });
  const os = input.os?.osName
    ? [input.os.osName, input.os.osVersion].filter(Boolean).join(' ')
    : input.specs?.os;
  if (os) rows.push({ label: 'OS', value: os });
  rows.push({ label: 'Asset tag', value: input.assetTag });
  return rows;
}

/** "Lenovo ThinkPad P14s | Laptop | Assigned to Gurpreet Singh" */
export function headerMeta(input: {
  brand: string | null;
  model: string | null;
  typeName: string | null | undefined;
  holderName: string | null;
}): string[] {
  const make = [input.brand, input.model].filter(Boolean).join(' ');
  return [
    make || null,
    input.typeName ?? null,
    input.holderName ? `Assigned to ${input.holderName}` : 'Unassigned',
  ].filter((s): s is string => Boolean(s));
}

/** The first line of the notes, trimmed for the footer strip. */
export function noteSummary(notes: string | null | undefined, max = 140): string | null {
  const first = notes
    ?.split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!first) return null;
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}
