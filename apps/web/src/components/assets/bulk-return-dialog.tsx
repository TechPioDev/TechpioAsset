'use client';

import { useEffect, useState } from 'react';
import type { AssetCondition, AssetStatus } from '@techpioasset/domain';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { Button } from '@/components/ui';
import { Input } from '@/components/ui/input';

/**
 * v3.24 - one return for the whole selection.
 *
 * Same two choices the single Record return asks for - the condition the
 * things came back in and where they go next - applied to every selected
 * asset that somebody holds. Each asset still runs through the single return
 * on the server, so anything that cannot be returned is skipped with its
 * reason rather than forced.
 */

const CONDITIONS: AssetCondition[] = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'];
const RETURN_STATUSES: AssetStatus[] = [
  'AVAILABLE',
  'IN_STORAGE',
  'UNDER_REPAIR',
  'DAMAGED',
  'RETIRED',
];
const title = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');
const selectCls =
  'h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-sm';

export interface BulkReturnInput {
  conditionIn: AssetCondition;
  resultingStatus: AssetStatus;
  notes?: string;
}

export function BulkReturnDialog({
  count,
  pending,
  onClose,
  onSubmit,
}: {
  /** How many selected assets somebody holds - the number that will be returned. */
  count: number;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: BulkReturnInput) => void;
}) {
  const trapRef = useFocusTrap<HTMLFormElement>(true);
  const [conditionIn, setConditionIn] = useState<AssetCondition>('GOOD');
  const [resultingStatus, setResultingStatus] = useState<AssetStatus>('AVAILABLE');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pending]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-return-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <form
        ref={trapRef}
        className="grid w-full max-w-md gap-4 rounded-2xl bg-[var(--color-surface)] p-5 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ conditionIn, resultingStatus, notes: notes.trim() || undefined });
        }}
      >
        <div>
          <h2 id="bulk-return-title" className="text-base font-semibold">
            Record return for {count} asset{count === 1 ? '' : 's'}
          </h2>
          <p className="mt-0.5 text-sm text-[var(--color-content-muted)]">
            Each one is taken back from whoever holds it and closes their assignment. Selected
            assets that nobody holds are left alone.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
            Condition they came back in
            <select
              value={conditionIn}
              onChange={(e) => setConditionIn(e.target.value as AssetCondition)}
              className={selectCls}
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {title(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
            Where they go next
            <select
              value={resultingStatus}
              onChange={(e) => setResultingStatus(e.target.value as AssetStatus)}
              className={selectCls}
            >
              {RETURN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {title(s)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
          Note (optional, recorded on every return)
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Collected from the leaver's desk on 10 Nov…"
            maxLength={2000}
          />
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={pending}>
            Return {count} asset{count === 1 ? '' : 's'}
          </Button>
        </div>
      </form>
    </div>
  );
}
