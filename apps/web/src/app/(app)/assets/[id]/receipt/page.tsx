'use client';

import { use, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { assetReceipt, type ReceiptAssetInput } from '@techpioasset/domain';
import { useAuth } from '@/providers/auth-provider';
import { apiFetch } from '@/lib/api-client';
import { ErrorState, Skeleton } from '@/components/ui';

/**
 * Printable handover receipt (v2.15).
 *
 * The paper trail for a device changing hands: what was issued, to whom, in
 * what condition, with what accessories - plus signature lines, because a
 * receipt without a place to sign is a summary. Works for the open assignment;
 * scope rules mean an employee can only ever print their own.
 *
 * Every word comes from `assetReceipt` in the domain package, which the phone
 * prints too - this page only lays it out.
 */

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString();

export default function AssetReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const printed = useRef(false);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['asset-receipt', id],
    enabled: Boolean(user),
    queryFn: () => apiFetch<ReceiptAssetInput>(`/assets/${id}`),
  });

  useEffect(() => {
    // ?noprint=1 renders the document without summoning the dialog - for
    // checking the layout, and for automated verification.
    if (new URLSearchParams(window.location.search).has('noprint')) return;
    if (data && !printed.current) {
      printed.current = true;
      setTimeout(() => window.print(), 300);
    }
  }, [data]);

  if (isPending) return <Skeleton className="h-64" />;
  if (isError)
    return <ErrorState title="Could not load this asset" detail={(error as Error).message} />;

  const receipt = assetReceipt(data, fmtDate);

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-sm text-black print:p-0">
      <div className="border-b-2 border-black pb-4">
        <h1 className="text-xl font-bold">{receipt.title}</h1>
        <p className="mt-1 text-xs text-neutral-600">{receipt.generatedLine}</p>
      </div>

      {receipt.notIssuedNotice ? (
        <p className="mt-4 rounded border border-neutral-400 p-3">{receipt.notIssuedNotice}</p>
      ) : null}

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wide">Device</h2>
      <dl className="mt-2 grid grid-cols-2 gap-x-8 gap-y-2">
        {receipt.deviceRows.map(({ label: k, value: v }) => (
          <div key={k} className="flex justify-between gap-4 border-b border-neutral-200 py-1">
            <dt className="text-neutral-600">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      {receipt.handoverRows ? (
        <>
          <h2 className="mt-6 text-sm font-bold uppercase tracking-wide">Handover</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-8 gap-y-2">
            {receipt.handoverRows.map(({ label: k, value: v }) => (
              <div key={k} className="flex justify-between gap-4 border-b border-neutral-200 py-1">
                <dt className="text-neutral-600">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-6 text-sm">{receipt.confirmation}</p>

          {receipt.signatureLabels ? (
            <div className="mt-10 grid grid-cols-2 gap-12">
              {receipt.signatureLabels.map((line) => (
                <div key={line}>
                  <div className="border-b border-black pb-8" />
                  <p className="mt-1 text-xs text-neutral-600">{line}</p>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      <p className="mt-10 border-t border-neutral-300 pt-2 text-xs text-neutral-500">
        {receipt.footer}
      </p>
    </div>
  );
}
