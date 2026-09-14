'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FilePlus2, Plus, Trash2 } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch, apiFetchPage, ApiError } from '@/lib/api-client';
import {
  buildCreateInvoicePayload,
  computedLineTotal,
  emptyInvoiceDraft,
  emptyLine,
  formatInvoiceMoney,
  MAX_LINES,
  previewInvoice,
  previewWarnings,
  validateInvoiceDraft,
  type InvoiceDraft,
  type InvoiceLineDraft,
} from '@/lib/invoice-entry';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, controlCls, ErrorState, Field, Input, NativeSelect } from '@/components/ui';
import { Textarea } from '@/components/ui/textarea';

interface Vendor {
  id: string;
  name: string;
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  vendor: { id: string; name: string } | null;
}

/** INR first; the company's own currency joins the list when it is something else. */
const COMMON_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];

const todayIso = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** The server's field errors when it sends them, else its detail. */
function problemText(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = Object.entries(error.fieldErrors).map(
      ([path, message]) => `${path}: ${message}`,
    );
    return fields.length ? fields.join('; ') : error.message;
  }
  return error instanceof Error ? error.message : 'Could not save the invoice.';
}

/**
 * Enter a bill by hand - POST /invoices, the path that works with AI switched
 * off. The phone's invoice/new screen sends the same body.
 *
 * Gated on invoices:upload, the permission the API checks: invoices carry
 * purchase cost, which only Finance, Office Admin and Super Admin may enter.
 * Totals shown are exact-decimal previews; the server recomputes every figure
 * and records any mismatch for a reviewer rather than trusting this page.
 */
export default function NewInvoicePage() {
  const { can } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const canAdd = can(PERMISSIONS.INVOICES_UPLOAD);
  const canReadPos = can(PERMISSIONS.PURCHASE_ORDERS_READ);
  const canReadCompany = can(PERMISSIONS.SETTINGS_MANAGE);

  const [draft, setDraft] = useState<InvoiceDraft>(() => emptyInvoiceDraft('INR', todayIso()));
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof InvoiceDraft>(key: K, value: InvoiceDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setLine = (index: number, patch: Partial<InvoiceLineDraft>) =>
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));

  const vendors = useQuery({
    queryKey: ['vendors'],
    queryFn: () => apiFetch<Vendor[]>('/vendors'),
    enabled: canAdd,
  });
  // The PO link is optional, so without the permission only the number box shows.
  const orders = useQuery({
    queryKey: ['invoice-entry-orders'],
    queryFn: () => apiFetchPage<PurchaseOrder>('/procurement/orders?pageSize=100'),
    enabled: canAdd && canReadPos,
  });
  // GET /company needs settings:manage. Finance usually lacks it, and INR is
  // this product's home currency, so INR stands in rather than failing.
  const company = useQuery({
    queryKey: ['company'],
    queryFn: () => apiFetch<{ baseCurrency: string }>('/company'),
    enabled: canAdd && canReadCompany,
  });
  const baseCurrency = company.data?.baseCurrency ?? 'INR';
  useEffect(() => {
    const code = company.data?.baseCurrency;
    // Only while untouched: never overwrite a currency someone chose.
    if (code) setDraft((d) => (d.currency === 'INR' ? { ...d, currency: code } : d));
  }, [company.data?.baseCurrency]);

  const preview = useMemo(() => previewInvoice(draft), [draft]);
  const warnings = useMemo(() => previewWarnings(draft), [draft]);
  const currencies = [...new Set([baseCurrency, ...COMMON_CURRENCIES, draft.currency])];
  const money = (value: string | null) => formatInvoiceMoney(value, draft.currency);

  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>('/invoices', {
        method: 'POST',
        body: buildCreateInvoicePayload(draft),
      }),
    onSuccess: (invoice) => {
      toast.success('Invoice saved');
      router.push(`/invoices/${invoice.id}`);
    },
    onError: (error) => setFormError(problemText(error)),
  });

  if (!canAdd) {
    return (
      <ErrorState
        title="Not available"
        detail="Adding invoices is for Finance, Office Admin and Super Admin."
      />
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = validateInvoiceDraft(draft);
    setFormError(problem);
    if (!problem) create.mutate();
  }

  function choosePurchaseOrder(id: string) {
    const po = orders.data?.data.find((o) => o.id === id);
    setDraft((d) => ({
      ...d,
      purchaseOrderId: id,
      purchaseOrderNumber: po?.poNumber ?? '',
      // A PO names its supplier; fill it in only if nobody has chosen one yet.
      vendorId: d.vendorId || po?.vendor?.id || '',
    }));
  }

  const moneyInput = (key: 'discount' | 'tax' | 'shipping' | 'otherCharges', label: string) => (
    <Field label={label} htmlFor={`inv-${key}`}>
      <Input
        id={`inv-${key}`}
        inputMode="decimal"
        placeholder="0.00"
        value={draft[key]}
        onChange={(e) => set(key, e.target.value)}
        className="tabular-nums"
      />
    </Field>
  );

  return (
    <form onSubmit={onSubmit} className="mx-auto grid max-w-4xl gap-5" noValidate>
      <header>
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--color-content-subtle)]">
          Invoices
        </span>
        <h1 className="mt-1 flex items-center gap-2 text-[24px] font-bold tracking-tight">
          <FilePlus2 aria-hidden="true" className="size-6 text-[var(--color-brand)]" /> Add invoice
        </h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Type the bill in as printed. Every figure is checked again when you save, and anything
          that does not add up is flagged for review. Have the file?{' '}
          <Link
            href="/invoices/upload"
            className="font-medium text-[var(--color-brand)] hover:underline"
          >
            Scan a bill instead
          </Link>
          .
        </p>
      </header>

      <Card className="grid gap-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Vendor"
            htmlFor="inv-vendor"
            hint={
              vendors.data && vendors.data.length === 0
                ? 'No vendors yet - add one under Settings → Vendors first.'
                : undefined
            }
          >
            <NativeSelect
              id="inv-vendor"
              value={draft.vendorId}
              onChange={(e) => set('vendorId', e.target.value)}
              className="w-full"
              required
            >
              <option value="">{vendors.isPending ? 'Loading…' : 'Choose a vendor'}</option>
              {vendors.data?.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Invoice number" htmlFor="inv-number">
            <Input
              id="inv-number"
              value={draft.invoiceNumber}
              onChange={(e) => set('invoiceNumber', e.target.value)}
              placeholder="e.g. INV-2026-0142"
              maxLength={100}
              required
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Invoice date" htmlFor="inv-date">
            <Input
              id="inv-date"
              type="date"
              value={draft.invoiceDate}
              onChange={(e) => set('invoiceDate', e.target.value)}
              required
            />
          </Field>
          <Field label="Due date (optional)" htmlFor="inv-due">
            <Input
              id="inv-due"
              type="date"
              value={draft.dueDate}
              onChange={(e) => set('dueDate', e.target.value)}
            />
          </Field>
          <Field label="Purchase date (optional)" htmlFor="inv-purchased">
            <Input
              id="inv-purchased"
              type="date"
              value={draft.purchaseDate}
              onChange={(e) => set('purchaseDate', e.target.value)}
            />
          </Field>
          <Field label="Currency" htmlFor="inv-currency">
            <NativeSelect
              id="inv-currency"
              value={draft.currency}
              onChange={(e) => set('currency', e.target.value)}
              className="w-full"
            >
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {canReadPos && (orders.data?.data.length ?? 0) > 0 ? (
            <Field label="Purchase order (optional)" htmlFor="inv-po">
              <NativeSelect
                id="inv-po"
                value={draft.purchaseOrderId}
                onChange={(e) => choosePurchaseOrder(e.target.value)}
                className="w-full"
              >
                <option value="">No purchase order</option>
                {orders.data?.data.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.vendor ? `${po.poNumber} · ${po.vendor.name}` : po.poNumber}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          {!draft.purchaseOrderId ? (
            <Field
              label="PO number (optional)"
              htmlFor="inv-po-number"
              hint="As printed on the bill."
            >
              <Input
                id="inv-po-number"
                value={draft.purchaseOrderNumber}
                onChange={(e) => set('purchaseOrderNumber', e.target.value)}
                maxLength={64}
              />
            </Field>
          ) : null}
        </div>
      </Card>

      <Card className="grid gap-3 p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Line items</h2>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={draft.lines.length >= MAX_LINES}
            onClick={() => set('lines', [...draft.lines, emptyLine()])}
          >
            <Plus aria-hidden="true" className="size-4" /> Add line
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Invoice line items</caption>
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-content-subtle)]">
                <th scope="col" className="w-8 py-2 pr-2 font-medium">
                  #
                </th>
                <th scope="col" className="py-2 pr-2 font-medium">
                  Description
                </th>
                <th scope="col" className="w-24 py-2 pr-2 font-medium">
                  Qty
                </th>
                <th scope="col" className="w-32 py-2 pr-2 font-medium">
                  Unit price
                </th>
                <th scope="col" className="w-36 py-2 pr-2 font-medium">
                  Line total
                </th>
                <th scope="col" className="w-10 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((line, index) => {
                const n = index + 1;
                return (
                  <tr key={index} className="align-top">
                    <td className="py-2 pr-2 pt-4 text-[var(--color-content-subtle)]">{n}</td>
                    <td className="py-2 pr-2">
                      <input
                        aria-label={`Line ${n} description`}
                        className={controlCls}
                        value={line.description}
                        maxLength={500}
                        onChange={(e) => setLine(index, { description: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        aria-label={`Line ${n} quantity`}
                        className={`${controlCls} tabular-nums`}
                        inputMode="decimal"
                        value={line.quantity}
                        onChange={(e) => setLine(index, { quantity: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        aria-label={`Line ${n} unit price`}
                        className={`${controlCls} tabular-nums`}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={line.unitPrice}
                        onChange={(e) => setLine(index, { unitPrice: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      {/* Blank saves quantity x unit price; type a figure only
                          when the bill prints a different one. */}
                      <input
                        aria-label={`Line ${n} total`}
                        className={`${controlCls} tabular-nums`}
                        inputMode="decimal"
                        placeholder={computedLineTotal(line) ?? 'Qty × price'}
                        value={line.lineTotal}
                        onChange={(e) => setLine(index, { lineTotal: e.target.value })}
                      />
                    </td>
                    <td className="py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove line ${n}`}
                        disabled={draft.lines.length === 1}
                        onClick={() =>
                          set(
                            'lines',
                            draft.lines.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[var(--color-content-subtle)]">
          Leave a line total blank to use quantity × unit price.
        </p>
      </Card>

      <Card className="grid gap-4 p-6">
        <h2 className="text-base font-semibold">Charges and totals</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          {moneyInput('discount', 'Discount')}
          {moneyInput('tax', 'Tax')}
          {moneyInput('shipping', 'Shipping')}
          {moneyInput('otherCharges', 'Other charges')}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Subtotal on bill (optional)"
            htmlFor="inv-subtotal"
            hint="Blank uses the sum of the lines."
          >
            <Input
              id="inv-subtotal"
              inputMode="decimal"
              placeholder={preview.computedSubtotal ?? ''}
              value={draft.subtotal}
              onChange={(e) => set('subtotal', e.target.value)}
              className="tabular-nums"
            />
          </Field>
          <Field
            label="Total on bill (optional)"
            htmlFor="inv-total"
            hint="Blank uses subtotal − discount + tax + shipping + other."
          >
            <Input
              id="inv-total"
              inputMode="decimal"
              placeholder={preview.computedTotal ?? ''}
              value={draft.total}
              onChange={(e) => set('total', e.target.value)}
              className="tabular-nums"
            />
          </Field>
        </div>

        <dl className="grid gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--color-content-muted)]">Subtotal</dt>
            <dd className="tabular-nums">{money(preview.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--color-content-muted)]">Total</dt>
            <dd className="font-semibold tabular-nums">{money(preview.total)}</dd>
          </div>
          <p className="text-xs text-[var(--color-content-subtle)]">
            A preview. The server checks every figure again when you save.
          </p>
        </dl>

        {warnings.length > 0 ? (
          <ul className="grid gap-1.5" aria-label="Figures that do not add up">
            {warnings.map((warning) => (
              <li
                key={warning}
                className="rounded-[var(--radius-control)] border px-3 py-2 text-sm"
                style={{
                  color: 'var(--tone-warning-fg)',
                  backgroundColor: 'var(--tone-warning-bg)',
                  borderColor: 'var(--tone-warning-border)',
                }}
              >
                {warning}
              </li>
            ))}
          </ul>
        ) : null}

        <Field label="Notes (optional)" htmlFor="inv-notes">
          <Textarea
            id="inv-notes"
            value={draft.notes}
            maxLength={2000}
            onChange={(e) => set('notes', e.target.value)}
          />
        </Field>
      </Card>

      {formError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border px-3 py-2 text-sm"
          style={{
            color: 'var(--tone-critical-fg)',
            backgroundColor: 'var(--tone-critical-bg)',
            borderColor: 'var(--tone-critical-border)',
          }}
        >
          {formError}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending}>
          Save invoice
        </Button>
      </div>
    </form>
  );
}
