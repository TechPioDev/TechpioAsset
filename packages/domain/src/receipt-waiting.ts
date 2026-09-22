/**
 * Which of my assets still wait for me to confirm I received them (v2.80).
 *
 * The phone's Home and the web dashboard both show a "Confirm receipt" card
 * from this, so the two can never disagree about what is waiting. A handover
 * restored from an imported register (method IMPORT_BACKFILL) is left out:
 * nobody handed it over in PioAssets, and the receipt reminders skip it for
 * the same reason - asking someone to "confirm" a headset they were given
 * months ago teaches them to tap Confirm without looking.
 */
export const IMPORT_BACKFILL_ACK_METHOD = 'IMPORT_BACKFILL';

export interface ReceiptCandidate {
  id: string;
  name: string;
  assetTag: string;
  assignedUser?: { id: string } | null;
  assignments?: readonly {
    id: string;
    assignedAt?: string | Date | null;
    acknowledgedAt?: string | Date | null;
    acknowledgementMethod?: string | null;
  }[];
}

export interface WaitingReceipt {
  assetId: string;
  assignmentId: string;
  name: string;
  assetTag: string;
  assignedAt: string | null;
}

export function receiptsWaiting(
  assets: readonly ReceiptCandidate[],
  userId: string,
): WaitingReceipt[] {
  return assets.flatMap((a) => {
    const open = a.assignments?.[0];
    if (!open || open.acknowledgedAt) return [];
    if (open.acknowledgementMethod === IMPORT_BACKFILL_ACK_METHOD) return [];
    // Only the holder confirms - the list may be someone else's view.
    if (a.assignedUser && a.assignedUser.id !== userId) return [];
    const at = open.assignedAt ? new Date(open.assignedAt).toISOString() : null;
    return [
      { assetId: a.id, assignmentId: open.id, name: a.name, assetTag: a.assetTag, assignedAt: at },
    ];
  });
}
