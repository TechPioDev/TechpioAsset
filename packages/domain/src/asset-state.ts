import type { AssetStatus } from './asset-status';
import type { AvailabilityState, LifecycleState } from './asset-dimensions';

/**
 * One state, said once (v2.89).
 *
 * An asset carries three separate dimensions - status, lifecycle state and
 * availability state - and a damaged laptop in the repair shop sets all three:
 * "Damaged", "In maintenance", "In repair". Three true statements about one
 * situation, printed as three peer badges, which reads as three different
 * problems and invites the reasonable question of which one to believe.
 *
 * There is already a dedupe, but it compares LABELS, so it only catches the
 * case where two dimensions produce the same word ("Assigned · Assigned").
 * Different words for the same situation sailed through.
 *
 * So the dimensions are grouped by what they MEAN. The status leads, because
 * it is what people act on; another dimension is shown only when it says
 * something the status does not. Nothing is hidden that was not already being
 * said twice.
 */

/** What a dimension is really telling you. */
export type AssetSituation =
  | 'incoming'
  | 'spare'
  | 'in-use'
  | 'out-of-service'
  | 'gone'
  | 'retired'
  | 'unknown';

const STATUS_SITUATION: Record<AssetStatus, AssetSituation> = {
  DRAFT: 'incoming',
  REQUESTED: 'incoming',
  ORDERED: 'incoming',
  RECEIVED: 'incoming',
  IN_TRANSIT: 'incoming',
  AVAILABLE: 'spare',
  IN_STORAGE: 'spare',
  RESERVED: 'spare',
  RETURNED: 'spare',
  ASSIGNED: 'in-use',
  IN_USE: 'in-use',
  UNDER_REPAIR: 'out-of-service',
  DAMAGED: 'out-of-service',
  LOST: 'gone',
  STOLEN: 'gone',
  RETIRED: 'retired',
  DISPOSED: 'retired',
  DONATED: 'retired',
};

const LIFECYCLE_SITUATION: Record<LifecycleState, AssetSituation> = {
  PLANNED: 'incoming',
  IN_PROCUREMENT: 'incoming',
  IN_STOCK: 'spare',
  DEPLOYED: 'in-use',
  IN_MAINTENANCE: 'out-of-service',
  RETIRED: 'retired',
  DISPOSED: 'retired',
};

const AVAILABILITY_SITUATION: Record<AvailabilityState, AssetSituation> = {
  AVAILABLE: 'spare',
  RESERVED: 'spare',
  ASSIGNED: 'in-use',
  IN_TRANSIT: 'incoming',
  IN_REPAIR: 'out-of-service',
  LOST: 'gone',
};

export function statusSituation(status: AssetStatus): AssetSituation {
  return STATUS_SITUATION[status] ?? 'unknown';
}

export interface AssetStateDimensions {
  status: AssetStatus;
  lifecycleState?: LifecycleState | null;
  availabilityState?: AvailabilityState | null;
}

/**
 * Which dimensions are worth showing: always the status, plus any other that
 * describes a different situation from it.
 *
 * Returns the KEYS rather than rendered badges, because the two apps draw a
 * badge differently and neither should have to agree with the other about
 * colours to agree about meaning.
 */
export function assetStateToShow(a: AssetStateDimensions): {
  status: AssetStatus;
  lifecycleState: LifecycleState | null;
  availabilityState: AvailabilityState | null;
  /** True when the other two were saying the same thing and were dropped. */
  collapsed: boolean;
} {
  const here = statusSituation(a.status);
  const lifecycle =
    a.lifecycleState && LIFECYCLE_SITUATION[a.lifecycleState] !== here ? a.lifecycleState : null;
  const availability =
    a.availabilityState && AVAILABILITY_SITUATION[a.availabilityState] !== here
      ? a.availabilityState
      : null;
  const dropped =
    (a.lifecycleState != null && lifecycle === null) ||
    (a.availabilityState != null && availability === null);
  return {
    status: a.status,
    lifecycleState: lifecycle,
    availabilityState: availability,
    collapsed: dropped,
  };
}
