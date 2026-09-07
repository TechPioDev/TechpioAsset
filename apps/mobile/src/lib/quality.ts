import { qualityCheckProblem, type RejectDisposition } from '@techpioasset/domain';

/**
 * What the dock sends when it inspects a receipt line (v2.42).
 *
 * Outside the screen for the same reason receive.ts is: the payload has to be
 * exactly right or the inspection is wrong in a way nobody notices.
 *
 * The rules themselves live in @techpioasset/domain, so this screen, the web
 * one and the server all argue from the same page - including the one that
 * matters most, that an asset line's rejected count must agree with the units
 * named, or the server condemns a different laptop from the cracked one.
 */

export interface QualityCheckPayload {
  quantityAccepted: number;
  quantityRejected: number;
  rejectionReason?: string;
  disposition?: RejectDisposition;
  rejectedAssetIds?: string[];
}

export interface QualityDraft {
  /** What the receipt says arrived on this line. */
  received: number;
  /** For a stock line: typed. For an asset line: the units picked. */
  rejected: number;
  reason: string;
  disposition: RejectDisposition;
  /** Only meaningful on an asset line. */
  rejectedAssetIds: string[];
  intake: 'STOCK' | 'ASSET';
}

export function buildQualityCheck(draft: QualityDraft): QualityCheckPayload {
  const rejected = Number.isFinite(draft.rejected) ? Math.max(0, draft.rejected) : 0;
  const accepted = draft.received - rejected;
  return {
    quantityAccepted: accepted,
    quantityRejected: rejected,
    // Sent only when something was turned down: a reason attached to a clean
    // pass reads, later, as though something went wrong.
    ...(rejected > 0
      ? {
          rejectionReason: draft.reason.trim(),
          disposition: draft.disposition,
          ...(draft.intake === 'ASSET' ? { rejectedAssetIds: draft.rejectedAssetIds } : {}),
        }
      : {}),
  };
}

/**
 * Why this inspection cannot be sent yet, or null.
 *
 * Runs the same domain rule the server does, so the numbers are argued about
 * before the request rather than after it - and adds the one rule that only
 * matters on a device: on an asset line the units named must match the count.
 */
export function qualityDraftProblem(draft: QualityDraft): string | null {
  const rejected = Number.isFinite(draft.rejected) ? Math.max(0, draft.rejected) : 0;
  return qualityCheckProblem({
    received: draft.received,
    accepted: draft.received - rejected,
    rejected,
    reason: draft.reason,
    disposition: rejected > 0 ? draft.disposition : null,
    // Only an asset line has units to name; stock has none.
    ...(draft.intake === 'ASSET' ? { namedUnits: draft.rejectedAssetIds.length } : {}),
  });
}
