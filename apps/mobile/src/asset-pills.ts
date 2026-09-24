import {
  AVAILABILITY_STATE_TOKENS,
  LIFECYCLE_STATE_TOKENS,
  OWNERSHIP_TYPE_TOKENS,
  TONE_PALETTE_DARK,
  TONE_PALETTE_LIGHT,
} from '@techpioasset/ui-tokens';
import type {
  AssetStatus,
  AvailabilityState,
  LifecycleState,
  OwnershipType,
} from '@techpioasset/domain';
import { assetStateToShow } from '@techpioasset/domain';
import { statusColor, statusLabel, type Scheme } from './theme';

/**
 * The badges shown for an asset, deduplicated by what they say.
 *
 * An asset carries three separate dimensions - status, lifecycle and
 * availability - and they frequently agree: an available asset reads
 * "Available / In stock / Available", which looks like the app printed the same
 * badge three times by mistake. On the web there is room to label the columns
 * so the repetition reads as three answers; on a phone they are three unlabelled
 * pills in a row and the repetition reads as a bug.
 *
 * The dimensions are not merged - each still decides its own pill - but a label
 * already on screen is not repeated. Nothing is hidden that was not already
 * being said.
 */

export interface AssetPill {
  label: string;
  bg: string;
  fg: string;
}

export function assetPills(
  asset: {
    status: AssetStatus;
    lifecycleState?: LifecycleState | null;
    availabilityState?: AvailabilityState | null;
    ownershipType?: OwnershipType | null;
  },
  scheme: Scheme,
  { includeOwnership = false }: { includeOwnership?: boolean } = {},
): AssetPill[] {
  const palette = scheme === 'dark' ? TONE_PALETTE_DARK : TONE_PALETTE_LIGHT;
  const pills: AssetPill[] = [];
  const seen = new Set<string>();

  const push = (label: string, tone: { bg: string; fg: string }) => {
    const key = label.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    pills.push({ label, bg: tone.bg, fg: tone.fg });
  };

  // v2.89 - the dedupe below compares LABELS, so it only caught two
  // dimensions producing the same word. A damaged laptop in the shop produced
  // three DIFFERENT words for one situation - "Damaged", "In maintenance",
  // "In repair" - which reads as three separate problems. `assetStateToShow`
  // groups them by meaning and keeps the others only when they say something
  // the status does not.
  const shown = assetStateToShow(asset);

  push(statusLabel(shown.status), statusColor(shown.status, scheme));

  if (shown.lifecycleState) {
    const token = LIFECYCLE_STATE_TOKENS[shown.lifecycleState];
    push(token.label, palette[token.tone]);
  }
  if (shown.availabilityState) {
    const token = AVAILABILITY_STATE_TOKENS[shown.availabilityState];
    push(token.label, palette[token.tone]);
  }
  if (includeOwnership && asset.ownershipType) {
    const token = OWNERSHIP_TYPE_TOKENS[asset.ownershipType];
    push(token.label, palette[token.tone]);
  }

  return pills;
}
