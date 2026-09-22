import type { AssetCondition } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * The custody record an asset with a holder must have (v2.74).
 *
 * `assets.assignedUserId` says who holds a unit; the open row in
 * `asset_assignments` is the handover itself - the thing a return closes, a
 * hand-over moves, a condition photo is filed against and a receipt is printed
 * from. The two are written together by the Assign flow, but both importers
 * (the Excel bulk import and the accessories script) set the holder and never
 * wrote the row. On the live register that left 97 of 163 held assets - nearly
 * every imported accessory - showing "Assigned to Roushan Singh" while Record
 * return answered "This asset has no open assignment to return". Found by the
 * owner in the middle of offboarding somebody.
 *
 * This is the one place that writes the missing row, used by the importers (so
 * it cannot happen again), by Return and Hand over (so a unit that slipped
 * through anyway heals itself at the moment somebody needs it), and mirrored by
 * the migration that repaired the rows already there.
 */

/**
 * Marks a row created from an imported register rather than from a handover.
 *
 * It sits in `acknowledgementMethod` with `acknowledgedAt` left NULL, which is
 * the honest reading: nobody confirmed receipt, because nobody was ever asked.
 * The receipt-reminder sweep skips these - without that, repairing the register
 * would have emailed ninety people about headsets they were given months ago.
 * The holder can still confirm in the app, which replaces the marker with
 * IN_APP like any other confirmation.
 */
export const IMPORT_BACKFILL_METHOD = 'IMPORT_BACKFILL';

export const IMPORT_BACKFILL_NOTE =
  'Recorded from the imported register. No handover was captured in PioAssets, so the holder was never asked to confirm receipt.';

/** The client, or a transaction on it: the house pattern (see licenses/strained-pools.ts). */
type Db = Pick<PrismaService['client'], 'assetAssignment'>;

/**
 * Make sure `userId` has an open assignment for this asset, creating the
 * missing one. Answers with the open row, and whether it had to be written.
 *
 * An open assignment to somebody else is closed first - only ever reached from
 * an import that names a new holder, where the register being imported is the
 * authority on who has the unit.
 */
export async function ensureOpenAssignment(
  db: Db,
  input: {
    assetId: string;
    userId: string;
    condition: AssetCondition;
    /** When the holder took it, as far as the register knows. */
    assignedAt?: Date | null;
    actorId?: string | null;
  },
): Promise<{ id: string; created: boolean }> {
  const open = await db.assetAssignment.findFirst({
    where: { assetId: input.assetId, returnedAt: null },
    orderBy: { assignedAt: 'desc' },
    select: { id: true, userId: true },
  });
  if (open?.userId === input.userId) return { id: open.id, created: false };

  if (open) {
    await db.assetAssignment.update({
      where: { id: open.id },
      data: { returnedAt: new Date(), updatedById: input.actorId ?? null },
    });
  }

  const created = await db.assetAssignment.create({
    data: {
      assetId: input.assetId,
      userId: input.userId,
      assignedAt: input.assignedAt ?? new Date(),
      conditionOut: input.condition,
      notes: IMPORT_BACKFILL_NOTE,
      acknowledgementMethod: IMPORT_BACKFILL_METHOD,
      createdById: input.actorId ?? null,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}
