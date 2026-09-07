'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Search } from 'lucide-react';
import { qualityCheckProblem, qualityOutcome, type RejectDisposition } from '@techpioasset/domain';
import { apiFetch } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, controlCls, Field, NativeSelect, Skeleton } from '@/components/ui';

/**
 * Quality check on a receipt (v2.42).
 *
 * The step between "a box arrived" and "the laptop is usable": a passing
 * inspection is what takes an asset out of RECEIVED and makes it available.
 * Before this, somebody edited each one by hand.
 *
 * The same rules the server enforces run here first, from the shared domain
 * package, so numbers that do not add up are argued about before the request
 * rather than after it. On an asset line the inspector names the units that
 * failed - guessing by position would condemn an arbitrary machine.
 */

type ReceiptAsset = { id: string; assetTag: string; serialNumber: string | null; status: string };

type ReceiptLine = {
  id: string;
  quantity: string;
  intake: 'STOCK' | 'ASSET';
  note: string | null;
  purchaseOrderLine: { lineNumber: number; description: string };
  inventoryItem: { id: string; name: string } | null;
  assets: ReceiptAsset[];
  qualityCheck: {
    id: string;
    outcome: 'PASSED' | 'PARTIAL' | 'FAILED';
    quantityAccepted: string;
    quantityRejected: string;
    rejectionReason: string | null;
    disposition: RejectDisposition | null;
    inspectedAt: string;
  } | null;
};

type Receipt = {
  id: string;
  grnNumber: string;
  receivedAt: string;
  purchaseOrder: { id: string; poNumber: string; vendor: { name: string } | null };
  lines: ReceiptLine[];
};

const OUTCOME_TONE = { PASSED: 'success', PARTIAL: 'warning', FAILED: 'critical' } as const;
const OUTCOME_LABEL = { PASSED: 'Passed', PARTIAL: 'Partly passed', FAILED: 'Failed' } as const;

function OutcomeBadge({ outcome }: { outcome: keyof typeof OUTCOME_TONE }) {
  const tone = OUTCOME_TONE[outcome];
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{
        color: `var(--tone-${tone}-fg)`,
        backgroundColor: `var(--tone-${tone}-bg)`,
        borderColor: `var(--tone-${tone}-border)`,
      }}
    >
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

function InspectLine({ line, onDone }: { line: ReceiptLine; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [rejected, setRejected] = useState('0');
  const [reason, setReason] = useState('');
  const [disposition, setDisposition] = useState<RejectDisposition>('RETURN_TO_VENDOR');
  const [rejectedAssetIds, setRejectedAssetIds] = useState<string[]>([]);

  const received = Number(line.quantity);
  const rejectedCount = Math.max(0, Number(rejected) || 0);
  const accepted = received - rejectedCount;
  const isAssetLine = line.intake === 'ASSET' && line.assets.length > 0;

  const problem = qualityCheckProblem({
    received,
    accepted,
    rejected: rejectedCount,
    reason,
    disposition: rejectedCount > 0 ? disposition : null,
    ...(isAssetLine ? { namedUnits: rejectedAssetIds.length } : {}),
  });

  const toggleUnit = (assetId: string) =>
    setRejectedAssetIds((ids) => {
      const next = ids.includes(assetId) ? ids.filter((i) => i !== assetId) : [...ids, assetId];
      // The count follows the units picked: two ways to say the same thing
      // would leave one of them wrong.
      setRejected(String(next.length));
      return next;
    });

  const record = useMutation({
    mutationFn: () =>
      apiFetch(`/procurement/receipt-lines/${line.id}/quality-check`, {
        method: 'POST',
        body: {
          quantityAccepted: accepted,
          quantityRejected: rejectedCount,
          ...(rejectedCount > 0
            ? {
                rejectionReason: reason.trim(),
                disposition,
                ...(isAssetLine ? { rejectedAssetIds } : {}),
              }
            : {}),
        },
      }),
    onSuccess: async () => {
      toast.success(
        line.intake === 'ASSET' && accepted > 0
          ? `Inspection recorded — ${accepted} unit(s) are now available to assign`
          : 'Inspection recorded',
      );
      await onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not record the inspection'),
  });

  return (
    <div className="grid gap-3 border-t border-[var(--color-border)] pt-3">
      {isAssetLine ? (
        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-medium">Tick any unit that failed</legend>
          {line.assets.map((asset) => (
            <label
              key={asset.id}
              className="flex items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-sm"
              style={{
                borderColor: rejectedAssetIds.includes(asset.id)
                  ? 'var(--tone-critical-border)'
                  : 'var(--color-border)',
                backgroundColor: rejectedAssetIds.includes(asset.id)
                  ? 'var(--tone-critical-bg)'
                  : 'transparent',
              }}
            >
              <input
                type="checkbox"
                checked={rejectedAssetIds.includes(asset.id)}
                onChange={() => toggleUnit(asset.id)}
                className="size-4"
              />
              <span className="font-medium">{asset.assetTag}</span>
              {asset.serialNumber ? (
                <span className="text-xs text-[var(--color-content-subtle)]">{asset.serialNumber}</span>
              ) : null}
              {asset.status !== 'RECEIVED' ? (
                <span className="ml-auto text-xs text-[var(--color-content-subtle)]">
                  already {asset.status.toLowerCase().replace(/_/g, ' ')}
                </span>
              ) : null}
            </label>
          ))}
        </fieldset>
      ) : (
        <Field label="How many failed" htmlFor={`qc-rejected-${line.id}`}>
          <input
            id={`qc-rejected-${line.id}`}
            type="number"
            min={0}
            max={received}
            step="0.001"
            value={rejected}
            onChange={(e) => setRejected(e.target.value)}
            className={controlCls}
          />
        </Field>
      )}

      {rejectedCount > 0 ? (
        <>
          <Field
            label="Why"
            htmlFor={`qc-reason-${line.id}`}
            hint="A rejection nobody explained is one the vendor cannot be held to."
          >
            <textarea
              id={`qc-reason-${line.id}`}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Screen cracked in transit"
              className={controlCls}
            />
          </Field>
          <Field label="What happens to them" htmlFor={`qc-disp-${line.id}`}>
            <NativeSelect
              id={`qc-disp-${line.id}`}
              value={disposition}
              onChange={(e) => setDisposition(e.target.value as RejectDisposition)}
            >
              <option value="RETURN_TO_VENDOR">Back to the supplier</option>
              <option value="HOLD_DAMAGED">Keep, as damaged</option>
            </NativeSelect>
          </Field>
        </>
      ) : null}

      <p className="text-sm text-[var(--color-content-muted)]">
        {accepted} accepted, {rejectedCount} rejected —{' '}
        {OUTCOME_LABEL[qualityOutcome(accepted, rejectedCount)].toLowerCase()}
        {line.intake === 'ASSET' && accepted > 0
          ? `. ${accepted} unit(s) become available to assign.`
          : ''}
      </p>
      {problem ? (
        <p role="alert" className="text-xs" style={{ color: 'var(--tone-critical-fg)' }}>
          {problem}
        </p>
      ) : null}

      <div>
        <Button loading={record.isPending} disabled={Boolean(problem)} onClick={() => record.mutate()}>
          Record inspection
        </Button>
      </div>
    </div>
  );
}

export function QualityPanel({ receiptId, canInspect }: { receiptId: string; canInspect: boolean }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['goods-receipt', receiptId],
    queryFn: () => apiFetch<Receipt>(`/procurement/receipts/${receiptId}`),
  });
  const [openLine, setOpenLine] = useState<string | null>(null);

  const refresh = async () => {
    setOpenLine(null);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['goods-receipt', receiptId] }),
      // The PO's own view of its lines and assets moved too.
      qc.invalidateQueries({ queryKey: ['purchase-order'] }),
    ]);
  };

  if (query.isPending) return <Skeleton className="h-24" />;
  if (query.isError || !query.data) {
    return (
      <p className="text-sm text-[var(--color-content-muted)]">
        Could not load this receipt.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {query.data.lines.map((line) => {
        const done = line.qualityCheck;
        return (
          <Card key={line.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{line.purchaseOrderLine.description}</p>
                <p className="text-xs text-[var(--color-content-muted)]">
                  {Number(line.quantity)} received · {line.intake === 'ASSET' ? 'as assets' : 'into stock'}
                  {line.inventoryItem ? ` · ${line.inventoryItem.name}` : ''}
                </p>
              </div>
              {done ? <OutcomeBadge outcome={done.outcome} /> : null}
            </div>

            {done ? (
              <p className="mt-2 text-xs text-[var(--color-content-muted)]">
                {Number(done.quantityAccepted)} accepted, {Number(done.quantityRejected)} rejected
                {done.rejectionReason ? ` — ${done.rejectionReason}` : ''} · inspected{' '}
                {new Date(done.inspectedAt).toLocaleDateString()}
              </p>
            ) : !canInspect ? (
              <p className="mt-2 text-xs text-[var(--color-content-muted)]">Not yet inspected.</p>
            ) : openLine === line.id ? (
              <InspectLine line={line} onDone={refresh} />
            ) : (
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={() => setOpenLine(line.id)}>
                  <Search aria-hidden="true" className="mr-1 size-4" /> Inspect this line
                </Button>
              </div>
            )}
          </Card>
        );
      })}
      {query.data.lines.length === 0 ? (
        <p className="text-sm text-[var(--color-content-muted)]">This receipt has no lines.</p>
      ) : null}
    </div>
  );
}

export { ClipboardCheck as QualityIcon };
