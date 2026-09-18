import {
  relativeAge,
  type AssetDetailNavKey,
  type AssetImageSource,
  type HealthTile,
  type IllustrationIcon,
  type ReportFreshness,
} from '@techpioasset/domain';
import type { IconName } from '../components/ui';
import type { TransferView } from './asset-admin';

/**
 * The phone-only half of the redesigned asset screen (v2.62).
 *
 * Which picture leads, which health tiles exist and what the nav lists are the
 * domain package's rules (asset-overview.ts there), shared with the web page.
 * What lives here is the phone's own: which Ionicons glyph stands for each
 * section and device type, the API path a picture source resolves to, what the
 * "More actions" sheet offers, and the small strings the header shows. Nothing
 * here touches React Native, so all of it runs under vitest.
 */

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const NAV_ICONS: Readonly<Record<AssetDetailNavKey, IconName>> = {
  overview: 'grid-outline',
  lifecycle: 'calendar-outline',
  hardware: 'hardware-chip-outline',
  os: 'shield-checkmark-outline',
  software: 'cube-outline',
  health: 'pulse-outline',
  history: 'time-outline',
  notes: 'document-text-outline',
  attachments: 'attach-outline',
  financials: 'wallet-outline',
};

/** One glyph per section of the tab strip; the order and labels come from the domain. */
export function assetNavIcon(key: AssetDetailNavKey): IconName {
  return NAV_ICONS[key];
}

const ILLUSTRATION_ICONS: Readonly<Record<IllustrationIcon, IconName>> = {
  laptop: 'laptop-outline',
  desktop: 'desktop-outline',
  monitor: 'tv-outline',
  phone: 'phone-portrait-outline',
  tablet: 'tablet-portrait-outline',
  headset: 'headset-outline',
  printer: 'print-outline',
  keyboard: 'keypad-outline',
  mouse: 'radio-button-on-outline',
  network: 'git-network-outline',
  server: 'server-outline',
  other: 'cube-outline',
};

/** The Ionicons glyph for a domain illustration (web: the lucide set in asset-image-card.tsx). */
export function illustrationIonicon(icon: IllustrationIcon): IconName {
  return ILLUSTRATION_ICONS[icon];
}

// ---------------------------------------------------------------------------
// The product image card
// ---------------------------------------------------------------------------

/** The API path behind a picture source, or null for an illustration. */
export function assetImagePath(source: AssetImageSource, assetId: string): string | null {
  switch (source.kind) {
    case 'catalogue':
      return `/vendor-products/${source.productId}/images/${source.imageId}`;
    case 'photo':
      return `/assets/${assetId}/photos/${source.photoId}`;
    default:
      return null;
  }
}

/**
 * The caption under the picture: what the cover is, in the slide's own words
 * ("Catalogue picture", "Photo of this unit", "At handover · Rohit"). The web
 * adds "click to view all 7 full size"; on a phone the row shares its width
 * with the photo buttons, and the badge on the cover already carries the count.
 * A picture that failed to load reads as the illustration it fell back to, not
 * as the picture it was meant to be.
 */
export function assetImageCaption(cover: { stageLabel: string } | null, failed: boolean): string {
  if (!cover || failed) return 'No picture on file — illustration by type';
  return cover.stageLabel;
}

/**
 * The one line under "Key information" while it is shut (web: the same three,
 * the same separator): the identifiers somebody reads off a sticker, and where
 * the unit lives. Blank parts drop out rather than leaving a stray dot.
 */
export function keyInformationSummary(asset: {
  serialNumber?: string | null;
  assetTag?: string | null;
  office?: { name: string } | null;
}): string {
  return [asset.serialNumber, asset.assetTag, asset.office?.name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

// ---------------------------------------------------------------------------
// The header
// ---------------------------------------------------------------------------

/**
 * The agent pill beside the status badges. Never "online": the agent reports
 * on a schedule, so the honest claim is how recently it did (web: same words).
 */
export function agentPill(
  freshness: ReportFreshness,
  at: string,
  now: number = Date.now(),
): { label: string; tone: 'success' | 'warning' | 'critical' } {
  if (freshness === 'fresh') return { label: 'Agent reporting', tone: 'success' };
  if (freshness === 'ageing') return { label: `Agent last seen ${relativeAge(at, now)}`, tone: 'warning' };
  return { label: `Agent not reporting · ${relativeAge(at, now)}`, tone: 'critical' };
}

/** "Updated 3 days ago · agent" - the small line under the last-sync time. */
export function lastSyncLine(report: { at: string; source: string }, now: number = Date.now()): string {
  return `Updated ${relativeAge(report.at, now)} · ${report.source.toLowerCase()}`;
}

/** The badge on the "Warranty & purchase" card (web: the Tone beside its title). */
export function warrantyStanding(
  warrantyEndDate: string | null | undefined,
  now: Date = new Date(),
): { label: string; tone: 'success' | 'critical' | 'muted'; expired: boolean } {
  if (!warrantyEndDate) return { label: 'Not recorded', tone: 'muted', expired: false };
  const expired = new Date(warrantyEndDate) <= now;
  return expired
    ? { label: 'Warranty out', tone: 'critical', expired }
    : { label: 'Under warranty', tone: 'success', expired };
}

/** The health-score tile that leads the Device health strip when a score exists. */
export function healthScoreTile(
  health: { overall: number; grade: string },
  gradeTone: HealthTile['tone'],
): HealthTile {
  return {
    key: 'smart',
    label: 'Health score',
    value: `${health.overall} / 100`,
    hint: health.grade.toLowerCase(),
    tone: gradeTone,
    percent: Math.max(0, Math.min(100, health.overall)),
  };
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/** The PATCH body for the Notes tab: trimmed, blank becomes null, the version rides along. */
export function notesPayload(draft: string, version: number): { notes: string | null; version: number } {
  return { notes: draft.trim() || null, version };
}

export const NOTES_MAX_LENGTH = 4000;

// ---------------------------------------------------------------------------
// The "More actions" sheet
// ---------------------------------------------------------------------------

export type MoreActionKey = 'receipt' | 'edit' | 'qr' | 'custody' | 'transfer' | 'disposal' | 'price';

export interface MoreAction {
  key: MoreActionKey;
  label: string;
  icon: IconName;
}

export interface MoreActionGroup {
  /** A small heading over the group; omitted for the first, ungrouped set. */
  title?: string;
  items: MoreAction[];
}

/**
 * What the ⋯ sheet offers (web: more-actions-menu.tsx's groups). Each door
 * mirrors the gate of the card it leads to, so the sheet never points at a
 * card that is not there. The ticket doors the web adds for the holder do not
 * exist here: the phone's request form takes no pre-fill yet.
 */
export function moreActions(input: {
  hasHolder: boolean;
  canUpdate: boolean;
  hasQrToken: boolean;
  custody: { show: boolean; recordReturn: boolean };
  transfer: TransferView;
  canDispose: boolean;
  canSeeCost: boolean;
  hasPrice: boolean;
}): MoreActionGroup[] {
  const first: MoreAction[] = [];
  if (input.hasHolder) first.push({ key: 'receipt', label: 'Handover receipt', icon: 'print-outline' });
  if (input.canUpdate) first.push({ key: 'edit', label: 'Edit asset', icon: 'create-outline' });
  if (input.hasQrToken) first.push({ key: 'qr', label: 'QR label', icon: 'qr-code-outline' });

  const manage: MoreAction[] = [];
  if (input.custody.show) {
    manage.push({
      key: 'custody',
      label: input.custody.recordReturn ? 'Hand over / record return' : 'Assign to someone',
      icon: 'person-add-outline',
    });
  }
  if (input.transfer !== 'none') {
    manage.push({
      key: 'transfer',
      label: input.transfer === 'receive' ? 'Confirm arrival' : 'Office transfer',
      icon: 'airplane-outline',
    });
  }
  if (input.canDispose) manage.push({ key: 'disposal', label: 'Record disposal', icon: 'archive-outline' });
  if (input.canSeeCost) {
    manage.push({
      key: 'price',
      label: input.hasPrice ? 'Price & financials' : 'Record price',
      icon: 'cash-outline',
    });
  }

  const groups: MoreActionGroup[] = [];
  if (first.length) groups.push({ items: first });
  if (manage.length) groups.push({ title: 'Manage', items: manage });
  return groups;
}
