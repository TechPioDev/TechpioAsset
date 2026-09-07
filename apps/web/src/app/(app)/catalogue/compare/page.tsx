'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Plus, Scale, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import {
  Button,
  Card,
  controlCls,
  EmptyState,
  ErrorState,
  Field,
  linkButtonCls,
  NativeSelect,
  Skeleton,
} from '@/components/ui';
import { Money, OfferImage, OfferStatus, OutcomePill, daysUntil } from '@/components/catalogue/shared';
import type { OfferLifecycle } from '@techpioasset/domain';

/**
 * Comparing offers (v2.42).
 *
 * Every requirement is shown against every offer, with the reason. A single
 * score would hide which requirement the cheap option fails, and that is
 * usually the thing worth knowing. The ranking is a starting point for a
 * person, never a decision - which is why the losing rows stay on screen.
 *
 * Internal only: a supplier can never reach this, because how its offer scored
 * against a competitor's is the competitor's information.
 */

type SpecField = {
  key: string;
  label: string;
  dataType: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'ENUM';
  unit: string | null;
  intent: 'AT_LEAST' | 'AT_MOST' | 'EXACTLY' | null;
  options?: string[];
};

type FieldResult = {
  key: string;
  label: string;
  required: string;
  offered: string | null;
  outcome: 'PASS' | 'PARTIAL' | 'FAIL';
  reason: string;
  mandatory: boolean;
};

type ComparedOffer = {
  id: string;
  vendorName: string;
  name: string;
  brand: string | null;
  model: string | null;
  landedCost: number;
  effectiveStatus: OfferLifecycle;
  availableUntil: string;
  availableQuantity: number;
  leadTimeDays: number | null;
  warrantyMonths: number | null;
  primaryImageId: string | null;
  comparison: {
    fields: FieldResult[];
    passed: number;
    partial: number;
    failed: number;
    meetsMandatory: boolean;
  };
};

type Result = { categoryId: string; fields: SpecField[]; offers: ComparedOffer[] };

type Requirement = { key: string; value: string; mandatory: boolean };

function CompareInner() {
  const params = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
  const categoryId = params.get('categoryId') ?? '';

  const [requirements, setRequirements] = useState<Requirement[]>([]);
  /**
   * What was last asked for, as opposed to what is being typed. Part of the
   * query key, so pressing Compare is what runs it - not every keystroke.
   */
  const [applied, setApplied] = useState<Requirement[]>([]);

  const { data: fields } = useQuery({
    queryKey: ['spec-templates', categoryId],
    queryFn: () => apiFetch<SpecField[]>(`/spec-templates?categoryId=${categoryId}`),
    enabled: Boolean(categoryId),
  });

  /**
   * A comparison is a read, so it is a query even though the endpoint takes a
   * POST - the requirements are too big and too structured for a query string.
   * Modelling it as a mutation would mean an effect calling mutate() on mount,
   * which is how a screen ends up firing requests it never meant to.
   *
   * It runs on arrival with nothing asked for, because a plain side-by-side is
   * already useful, and again whenever the applied requirements change.
   */
  const comparison = useQuery({
    queryKey: ['offer-comparison', categoryId, ids.join(','), JSON.stringify(applied)],
    queryFn: () =>
      apiFetch<Result>('/vendor-products/compare', {
        method: 'POST',
        body: { categoryId, vendorProductIds: ids, requirements: applied },
      }),
    enabled: ids.length >= 2 && Boolean(categoryId),
  });
  const result = comparison.data;

  const runCompare = () =>
    setApplied(
      requirements
        .filter((r) => r.key && r.value.trim())
        .map((r) => ({ key: r.key, value: r.value.trim(), mandatory: r.mandatory })),
    );

  if (ids.length < 2 || !categoryId) {
    return (
      <Card>
        <EmptyState
          title="Pick at least two offers"
          description="Choose a category and tick two or more offers in the catalogue, then compare."
          action={
            <Link href="/catalogue" className={linkButtonCls.primary}>
              Back to the catalogue
            </Link>
          }
        />
      </Card>
    );
  }

  const addRequirement = () =>
    setRequirements((rs) => [...rs, { key: fields?.[0]?.key ?? '', value: '', mandatory: false }]);

  const update = (i: number, patch: Partial<Requirement>) =>
    setRequirements((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const hintFor = (key: string) => {
    const field = fields?.find((f) => f.key === key);
    if (!field) return undefined;
    if (field.dataType !== 'NUMBER') return undefined;
    return field.intent === 'AT_MOST'
      ? `At most, in ${field.unit ?? 'the stated unit'}`
      : field.intent === 'EXACTLY'
        ? 'Exactly this value'
        : `At least, in ${field.unit ?? 'the stated unit'}`;
  };

  return (
    <div className="grid gap-4">
      <div>
        <Link
          href="/catalogue"
          className="inline-flex items-center gap-1 text-sm text-[var(--color-content-muted)] hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4" /> Back to the catalogue
        </Link>
      </div>

      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Scale aria-hidden="true" className="size-5 text-[var(--color-brand)]" /> Comparing{' '}
          {ids.length} offers
        </h1>
        <p className="text-sm text-[var(--color-content-muted)]">
          Say what you need and each offer is checked against it. The scoring is plain arithmetic, so
          you can reproduce any row of it by hand.
        </p>
      </header>

      <Card className="grid gap-3 p-5">
        <h2 className="text-sm font-semibold">What you need</h2>
        {requirements.length === 0 ? (
          <p className="text-sm text-[var(--color-content-muted)]">
            Nothing asked for yet — the offers are shown side by side below.
          </p>
        ) : null}
        {requirements.map((requirement, i) => (
          <div key={i} className="grid items-end gap-2 sm:grid-cols-[2fr_2fr_auto_auto]">
            <Field label="Field" htmlFor={`req-key-${i}`}>
              <NativeSelect
                id={`req-key-${i}`}
                value={requirement.key}
                onChange={(e) => update(i, { key: e.target.value })}
              >
                {(fields ?? []).map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                    {f.unit ? ` (${f.unit})` : ''}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Needs to be" htmlFor={`req-val-${i}`} hint={hintFor(requirement.key)}>
              <input
                id={`req-val-${i}`}
                value={requirement.value}
                onChange={(e) => update(i, { value: e.target.value })}
                className={controlCls}
              />
            </Field>
            <label className="flex h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={requirement.mandatory}
                onChange={(e) => update(i, { mandatory: e.target.checked })}
                className="size-4"
              />
              Must have
            </label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label="Remove this requirement"
              onClick={() => setRequirements((rs) => rs.filter((_, idx) => idx !== i))}
            >
              <Trash2 aria-hidden="true" className="size-4" />
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={addRequirement} disabled={!fields?.length}>
            <Plus aria-hidden="true" className="mr-1 size-4" /> Add a requirement
          </Button>
          <Button type="button" loading={comparison.isFetching} onClick={runCompare}>
            Compare
          </Button>
        </div>
        {!fields?.length ? (
          <p className="text-xs text-[var(--color-content-muted)]">
            This category has no specification template yet, so there is nothing to compare on.{' '}
            <Link href="/settings/spec-templates" className="underline">
              Set one up
            </Link>
            .
          </p>
        ) : null}
      </Card>

      {comparison.isPending ? <Skeleton className="h-64" /> : null}
      {comparison.isError ? (
        <Card>
          <ErrorState
            title="Could not compare these offers"
            detail={comparison.error instanceof Error ? comparison.error.message : undefined}
          />
        </Card>
      ) : null}

      {result ? (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <caption className="sr-only">
              {applied.length === 0
                ? 'Offers shown side by side; nothing asked for yet'
                : `Offers compared against ${applied.length} requirement${applied.length === 1 ? '' : 's'}`}
            </caption>
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th scope="col" className="p-3 text-left font-medium">
                  Requirement
                </th>
                {result.offers.map((offer, index) => (
                  <th key={offer.id} scope="col" className="min-w-56 p-3 text-left align-top font-medium">
                    <div className="grid gap-2">
                      <div className="h-24 w-full overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border)]">
                        <OfferImage
                          productId={offer.id}
                          imageId={offer.primaryImageId}
                          alt={offer.name}
                        />
                      </div>
                      <Link href={`/catalogue/${offer.id}`} className="hover:underline">
                        {offer.name}
                      </Link>
                      <span className="text-xs font-normal text-[var(--color-content-muted)]">
                        {offer.vendorName}
                      </span>
                      <OfferStatus status={offer.effectiveStatus} />
                      {/* Only claimed when something was actually asked for.
                          With no requirements the order is just price, and
                          calling the cheapest a "best match" would be a claim
                          nobody made. */}
                      {index === 0 && result.offers.length > 1 && applied.length > 0 ? (
                        <span className="text-xs font-normal text-[var(--tone-success-fg)]">
                          Best match on what you asked for
                        </span>
                      ) : null}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--color-border)]">
                <th scope="row" className="p-3 text-left font-medium">
                  Landed cost per unit
                </th>
                {result.offers.map((offer) => (
                  <td key={offer.id} className="p-3 font-semibold tabular-nums">
                    <Money amount={offer.landedCost} />
                  </td>
                ))}
              </tr>

              {(result.offers[0]?.comparison.fields ?? []).map((field) => (
                <tr key={field.key} className="border-b border-[var(--color-border)]">
                  <th scope="row" className="p-3 text-left font-normal">
                    <span className="font-medium">{field.label}</span>
                    <span className="block text-xs text-[var(--color-content-muted)]">
                      needs {field.required}
                      {field.mandatory ? ' · must have' : ''}
                    </span>
                  </th>
                  {result.offers.map((offer) => {
                    const cell = offer.comparison.fields.find((f) => f.key === field.key);
                    if (!cell) return <td key={offer.id} className="p-3">—</td>;
                    return (
                      <td key={offer.id} className="p-3 align-top">
                        <div className="grid gap-1">
                          <OutcomePill outcome={cell.outcome} />
                          <span className="text-xs">{cell.offered ?? 'Not stated'}</span>
                          <span className="text-xs text-[var(--color-content-muted)]">{cell.reason}</span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}

              <tr className="border-b border-[var(--color-border)]">
                <th scope="row" className="p-3 text-left font-medium">
                  Warranty
                </th>
                {result.offers.map((offer) => (
                  <td key={offer.id} className="p-3">
                    {offer.warrantyMonths === null ? '—' : `${offer.warrantyMonths} months`}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-[var(--color-border)]">
                <th scope="row" className="p-3 text-left font-medium">
                  Lead time
                </th>
                {result.offers.map((offer) => (
                  <td key={offer.id} className="p-3">
                    {offer.leadTimeDays === null ? '—' : `${offer.leadTimeDays} days`}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-[var(--color-border)]">
                <th scope="row" className="p-3 text-left font-medium">
                  Price held until
                </th>
                {result.offers.map((offer) => (
                  <td key={offer.id} className="p-3">
                    {new Date(offer.availableUntil).toLocaleDateString()}
                    <span className="block text-xs text-[var(--color-content-muted)]">
                      {daysUntil(offer.availableUntil)}
                    </span>
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row" className="p-3 text-left font-medium">
                  Met
                </th>
                {result.offers.map((offer) => (
                  <td key={offer.id} className="p-3 text-xs">
                    {offer.comparison.passed} passed, {offer.comparison.partial} partial,{' '}
                    {offer.comparison.failed} failed
                    {offer.comparison.meetsMandatory ? '' : ' — misses a must-have'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}

export default function ComparePage() {
  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <CompareInner />
    </Suspense>
  );
}
