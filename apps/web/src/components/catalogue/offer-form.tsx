'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { calculateLandedCost, formatInr } from '@techpioasset/domain';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Button, Card, controlCls, Field, NativeSelect } from '@/components/ui';

/**
 * The offer form (v2.42), shared by "new" and "edit".
 *
 * The running total is computed with the same function the server uses, so the
 * figure a supplier sees while typing is the figure that gets stored. Showing a
 * total worked out a second way in the browser is how the two quietly disagree.
 */

export type OfferDraft = {
  vendorId: string;
  name: string;
  categoryId: string;
  brand: string;
  model: string;
  manufacturer: string;
  vendorSku: string;
  mpn: string;
  description: string;
  condition: string;
  youtubeUrl: string;
  unitPrice: string;
  gstPercent: string;
  discount: string;
  shippingCost: string;
  installationCost: string;
  otherCharges: string;
  minOrderQuantity: string;
  availableQuantity: string;
  paymentTerms: string;
  leadTimeDays: string;
  warrantyMonths: string;
  availableFrom: string;
  availableUntil: string;
  specs: Record<string, string>;
};

type Category = { id: string; name: string };
type Vendor = { id: string; name: string };
type SpecField = {
  id: string;
  key: string;
  label: string;
  dataType: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'ENUM';
  unit: string | null;
  options: string[];
  isRequired: boolean;
};

/** Today and a month out: an offer with no end date is a price nobody promised. */
const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

export const EMPTY_DRAFT: OfferDraft = {
  vendorId: '',
  name: '',
  categoryId: '',
  brand: '',
  model: '',
  manufacturer: '',
  vendorSku: '',
  mpn: '',
  description: '',
  condition: 'NEW',
  youtubeUrl: '',
  unitPrice: '',
  gstPercent: '18',
  discount: '0',
  shippingCost: '0',
  installationCost: '0',
  otherCharges: '0',
  minOrderQuantity: '1',
  availableQuantity: '0',
  paymentTerms: '',
  leadTimeDays: '',
  warrantyMonths: '',
  availableFrom: isoDay(0),
  availableUntil: isoDay(30),
  specs: {},
};

const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The request body, with blanks dropped rather than sent as empty strings. */
export function draftToBody(draft: OfferDraft, opts: { includeVendor: boolean }) {
  const optionalText = (v: string) => (v.trim() ? v.trim() : undefined);
  return {
    ...(opts.includeVendor && draft.vendorId ? { vendorId: draft.vendorId } : {}),
    name: draft.name.trim(),
    categoryId: draft.categoryId,
    brand: optionalText(draft.brand),
    model: optionalText(draft.model),
    manufacturer: optionalText(draft.manufacturer),
    vendorSku: optionalText(draft.vendorSku),
    mpn: optionalText(draft.mpn),
    description: optionalText(draft.description),
    condition: draft.condition,
    youtubeUrl: optionalText(draft.youtubeUrl),
    unitPrice: num(draft.unitPrice),
    gstPercent: num(draft.gstPercent),
    discount: num(draft.discount),
    shippingCost: num(draft.shippingCost),
    installationCost: num(draft.installationCost),
    otherCharges: num(draft.otherCharges),
    minOrderQuantity: num(draft.minOrderQuantity) || 1,
    availableQuantity: num(draft.availableQuantity),
    paymentTerms: optionalText(draft.paymentTerms),
    ...(draft.leadTimeDays.trim() ? { leadTimeDays: num(draft.leadTimeDays) } : {}),
    ...(draft.warrantyMonths.trim() ? { warrantyMonths: num(draft.warrantyMonths) } : {}),
    availableFrom: new Date(`${draft.availableFrom}T00:00:00.000Z`).toISOString(),
    availableUntil: new Date(`${draft.availableUntil}T23:59:59.000Z`).toISOString(),
    ...(Object.keys(draft.specs).length > 0
      ? { specs: Object.fromEntries(Object.entries(draft.specs).filter(([, v]) => v.trim() !== '')) }
      : {}),
  };
}

export function OfferForm({
  initial,
  submitLabel,
  busy,
  isEdit = false,
  onSubmit,
  onCancel,
}: {
  initial: OfferDraft;
  submitLabel: string;
  busy: boolean;
  isEdit?: boolean;
  onSubmit: (draft: OfferDraft) => void;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const [draft, setDraft] = useState(initial);
  const isVendorUser = Boolean(user?.roles?.includes('VENDOR'));

  const set = <K extends keyof OfferDraft>(key: K) => (value: OfferDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<Category[]>('/categories'),
  });
  const { data: vendors } = useQuery({
    queryKey: ['vendors'],
    queryFn: () => apiFetch<Vendor[]>('/vendors'),
    // A supplier never picks a vendor: the offer is always its own.
    enabled: !isVendorUser,
  });
  const { data: specFields } = useQuery({
    queryKey: ['spec-templates', draft.categoryId],
    queryFn: () => apiFetch<SpecField[]>(`/spec-templates?categoryId=${draft.categoryId}`),
    enabled: Boolean(draft.categoryId),
  });

  // The same calculation the server will do, so the two cannot disagree.
  const breakdown = useMemo(
    () =>
      calculateLandedCost({
        unitPrice: num(draft.unitPrice),
        gstPercent: num(draft.gstPercent),
        discount: num(draft.discount),
        shippingCost: num(draft.shippingCost),
        installationCost: num(draft.installationCost),
        otherCharges: num(draft.otherCharges),
      }),
    [draft],
  );

  const text = (key: keyof OfferDraft, label: string, hint?: string) => (
    <Field label={label} htmlFor={`of-${key}`} hint={hint}>
      <input
        id={`of-${key}`}
        value={String(draft[key] ?? '')}
        onChange={(e) => set(key)(e.target.value as OfferDraft[typeof key])}
        className={controlCls}
      />
    </Field>
  );

  const money = (key: keyof OfferDraft, label: string, hint?: string) => (
    <Field label={label} htmlFor={`of-${key}`} hint={hint}>
      <input
        id={`of-${key}`}
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        value={String(draft[key] ?? '')}
        onChange={(e) => set(key)(e.target.value as OfferDraft[typeof key])}
        className={controlCls}
      />
    </Field>
  );

  const datesWrong = new Date(draft.availableUntil) <= new Date(draft.availableFrom);
  const discountTooBig = num(draft.discount) > num(draft.unitPrice);
  const missingRequiredSpec = (specFields ?? []).some(
    (f) => f.isRequired && !(draft.specs[f.key] ?? '').trim(),
  );

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
    >
      <Card className="grid gap-3 p-5 sm:grid-cols-2">
        <h2 className="text-sm font-semibold sm:col-span-2">What you are offering</h2>
        {!isVendorUser ? (
          <Field
            label="Supplier"
            htmlFor="of-vendorId"
            hint={isEdit ? 'The supplier cannot be changed after the offer is created.' : undefined}
          >
            <NativeSelect
              id="of-vendorId"
              required
              disabled={isEdit}
              value={draft.vendorId}
              onChange={(e) => set('vendorId')(e.target.value)}
            >
              <option value="">Choose a supplier</option>
              {(vendors ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        <Field label="Category" htmlFor="of-categoryId">
          <NativeSelect
            id="of-categoryId"
            required
            value={draft.categoryId}
            onChange={(e) => set('categoryId')(e.target.value)}
          >
            <option value="">Choose a category</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Product name" htmlFor="of-name">
            <input
              id="of-name"
              required
              value={draft.name}
              onChange={(e) => set('name')(e.target.value)}
              className={controlCls}
            />
          </Field>
        </div>
        {text('brand', 'Brand')}
        {text('model', 'Model')}
        {text('manufacturer', 'Manufacturer')}
        <Field label="Condition" htmlFor="of-condition">
          <NativeSelect
            id="of-condition"
            value={draft.condition}
            onChange={(e) => set('condition')(e.target.value)}
          >
            <option value="NEW">New</option>
            <option value="REFURBISHED">Refurbished</option>
            <option value="OPEN_BOX">Open box</option>
            <option value="OTHER">Other</option>
          </NativeSelect>
        </Field>
        {text('vendorSku', 'Your SKU')}
        {text('mpn', 'Manufacturer part number')}
        <div className="sm:col-span-2">
          <Field label="Description" htmlFor="of-description">
            <textarea
              id="of-description"
              rows={3}
              value={draft.description}
              onChange={(e) => set('description')(e.target.value)}
              className={controlCls}
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field
            label="YouTube link"
            htmlFor="of-youtubeUrl"
            hint="A youtube.com or youtu.be link. Only the video id is stored — embed code is not accepted."
          >
            <input
              id="of-youtubeUrl"
              value={draft.youtubeUrl}
              onChange={(e) => set('youtubeUrl')(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className={controlCls}
            />
          </Field>
        </div>
      </Card>

      {(specFields ?? []).length > 0 ? (
        <Card className="grid gap-3 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <h2 className="text-sm font-semibold">Specification</h2>
            <p className="text-xs text-[var(--color-content-muted)]">
              These are the fields buyers compare on. Anything left blank counts as “not stated”, which
              fails a comparison rather than passing quietly.
            </p>
          </div>
          {(specFields ?? []).map((field) => (
            <Field
              key={field.id}
              label={`${field.label}${field.unit ? ` (${field.unit})` : ''}${field.isRequired ? ' *' : ''}`}
              htmlFor={`spec-${field.key}`}
            >
              {field.dataType === 'ENUM' ? (
                <NativeSelect
                  id={`spec-${field.key}`}
                  value={draft.specs[field.key] ?? ''}
                  onChange={(e) =>
                    set('specs')({ ...draft.specs, [field.key]: e.target.value })
                  }
                >
                  <option value="">Not stated</option>
                  {field.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </NativeSelect>
              ) : field.dataType === 'BOOLEAN' ? (
                <NativeSelect
                  id={`spec-${field.key}`}
                  value={draft.specs[field.key] ?? ''}
                  onChange={(e) =>
                    set('specs')({ ...draft.specs, [field.key]: e.target.value })
                  }
                >
                  <option value="">Not stated</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </NativeSelect>
              ) : (
                <input
                  id={`spec-${field.key}`}
                  inputMode={field.dataType === 'NUMBER' ? 'decimal' : 'text'}
                  value={draft.specs[field.key] ?? ''}
                  onChange={(e) =>
                    set('specs')({ ...draft.specs, [field.key]: e.target.value })
                  }
                  className={controlCls}
                />
              )}
            </Field>
          ))}
        </Card>
      ) : null}

      <Card className="grid gap-3 p-5 sm:grid-cols-2">
        <h2 className="text-sm font-semibold sm:col-span-2">Price</h2>
        {money('unitPrice', 'Unit price (₹)')}
        {money('gstPercent', 'GST %', 'Charged on the discounted value, including shipping and installation.')}
        {money('discount', 'Discount (₹)')}
        {money('shippingCost', 'Shipping (₹)')}
        {money('installationCost', 'Installation (₹)')}
        {money('otherCharges', 'Other charges (₹)', 'Outside the GST base.')}

        <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] p-3 text-sm sm:col-span-2">
          <div className="flex justify-between">
            <span className="text-[var(--color-content-muted)]">Taxable value</span>
            <span className="tabular-nums">{formatInr(breakdown.taxableValue)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--color-content-muted)]">GST</span>
            <span className="tabular-nums">{formatInr(breakdown.gstAmount)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-[var(--color-border)] pt-1 font-semibold">
            <span>Landed cost per unit</span>
            <span className="tabular-nums">{formatInr(breakdown.landedCost)}</span>
          </div>
        </div>
        {discountTooBig ? (
          <p role="alert" className="text-xs text-[var(--tone-critical-fg)] sm:col-span-2">
            The discount is more than the unit price.
          </p>
        ) : null}
      </Card>

      <Card className="grid gap-3 p-5 sm:grid-cols-2">
        <h2 className="text-sm font-semibold sm:col-span-2">Availability</h2>
        <Field label="How many you can supply" htmlFor="of-availableQuantity">
          <input
            id="of-availableQuantity"
            type="number"
            min={0}
            value={draft.availableQuantity}
            onChange={(e) => set('availableQuantity')(e.target.value)}
            className={controlCls}
          />
        </Field>
        <Field label="Minimum order" htmlFor="of-minOrderQuantity">
          <input
            id="of-minOrderQuantity"
            type="number"
            min={1}
            value={draft.minOrderQuantity}
            onChange={(e) => set('minOrderQuantity')(e.target.value)}
            className={controlCls}
          />
        </Field>
        <Field label="Available from" htmlFor="of-availableFrom">
          <input
            id="of-availableFrom"
            type="date"
            required
            value={draft.availableFrom}
            onChange={(e) => set('availableFrom')(e.target.value)}
            className={controlCls}
          />
        </Field>
        <Field
          label="Price held until"
          htmlFor="of-availableUntil"
          error={datesWrong ? 'The end date must be after the start date.' : undefined}
          hint="Required: an offer with no end date is a price nobody has promised."
        >
          <input
            id="of-availableUntil"
            type="date"
            required
            value={draft.availableUntil}
            onChange={(e) => set('availableUntil')(e.target.value)}
            className={controlCls}
          />
        </Field>
        <Field label="Lead time (days)" htmlFor="of-leadTimeDays">
          <input
            id="of-leadTimeDays"
            type="number"
            min={0}
            value={draft.leadTimeDays}
            onChange={(e) => set('leadTimeDays')(e.target.value)}
            className={controlCls}
          />
        </Field>
        <Field label="Warranty (months)" htmlFor="of-warrantyMonths">
          <input
            id="of-warrantyMonths"
            type="number"
            min={0}
            value={draft.warrantyMonths}
            onChange={(e) => set('warrantyMonths')(e.target.value)}
            className={controlCls}
          />
        </Field>
        <div className="sm:col-span-2">{text('paymentTerms', 'Payment terms')}</div>
      </Card>

      {missingRequiredSpec ? (
        <p className="text-xs text-[var(--color-content-muted)]">
          Some required specification fields are still blank. You can save now, but the offer cannot go
          for review until they are filled in.
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" loading={busy} disabled={datesWrong || discountTooBig}>
          {submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
