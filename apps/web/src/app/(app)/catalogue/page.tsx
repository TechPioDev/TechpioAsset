'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Building2, CalendarClock, Plus, Scale, ShoppingBag } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
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
import { Money, OfferImage, OfferStatus, daysUntil, type Offer } from '@/components/catalogue/shared';

/**
 * The catalogue (v2.42).
 *
 * One page, two readers. A supplier sees only its own offers, in every state,
 * because this is where it works on them. Internal staff see every supplier.
 * That is decided by the API's scope filter, not here - the page would look the
 * same either way, which is the point: a second "vendor portal" screen would be
 * a second place for the rules to drift.
 */

type Category = { id: string; name: string };

export default function CataloguePage() {
  const { user } = useAuth();
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [liveOnly, setLiveOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [compare, setCompare] = useState<string[]>([]);
  const [endingSoonOnly, setEndingSoonOnly] = useState(false);

  const isVendor = Boolean(user?.roles?.includes('VENDOR'));
  const canManage = Boolean(user?.permissions?.includes(PERMISSIONS.VENDOR_PRODUCTS_MANAGE));
  const canCompare = Boolean(user?.permissions?.includes(PERMISSIONS.VENDOR_PRODUCTS_REVIEW)) && !isVendor;

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<Category[]>('/categories'),
  });

  const query = useQuery({
    queryKey: ['vendor-products', categoryId, status, liveOnly],
    queryFn: () =>
      apiFetch<Offer[]>(
        `/vendor-products?${new URLSearchParams({
          ...(categoryId ? { categoryId } : {}),
          ...(status ? { status } : {}),
          ...(liveOnly ? { liveOnly: 'true' } : {}),
          take: '100',
        })}`,
      ),
  });

  /**
   * Offers about to come off sale.
   *
   * Every offer carries an end date, and nothing used to say so until the day a
   * buyer noticed the catalogue had gone quiet. Counted over everything the
   * caller can see, so a supplier is counting its own and a buyer is counting
   * the whole catalogue.
   */
  const endingSoon = useMemo(
    () =>
      (query.data ?? []).filter((o) => {
        if (o.status === 'DISCONTINUED') return false;
        const days = (new Date(o.availableUntil).getTime() - Date.now()) / 86_400_000;
        return days <= 30;
      }),
    [query.data],
  );

  // Filtered here rather than server-side: the list is already bounded, and a
  // round trip per keystroke buys nothing at this size.
  const offers = useMemo(() => {
    const rows = endingSoonOnly ? endingSoon : (query.data ?? []);
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((o) =>
      [o.name, o.brand, o.model, o.vendor?.name].some((v) => v?.toLowerCase().includes(needle)),
    );
  }, [query.data, search, endingSoonOnly, endingSoon]);

  const toggleCompare = (id: string) =>
    setCompare((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id].slice(0, 10)));

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <ShoppingBag aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
            {isVendor ? 'Your offers' : 'Catalogue'}
          </h1>
          <p className="text-sm text-[var(--color-content-muted)]">
            {isVendor
              ? 'What you are offering, and where each one has got to. A draft needs at least one picture before it can go for review.'
              : 'What suppliers are offering, with the landed cost worked out. Prices here are what the vendor published, until the date they published them to.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isVendor ? (
            <Link href="/catalogue/company" className={linkButtonCls.secondary}>
              <Building2 aria-hidden="true" className="size-4" /> Company details
            </Link>
          ) : null}
          {canManage ? (
            <Link href="/catalogue/new" className={linkButtonCls.primary}>
              <Plus aria-hidden="true" className="size-4" /> New offer
            </Link>
          ) : null}
        </div>
      </header>

      <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search" htmlFor="cat-search">
          <input
            id="cat-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, brand, model or supplier"
            className={controlCls}
          />
        </Field>
        <Field label="Category" htmlFor="cat-category">
          <NativeSelect
            id="cat-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">All categories</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Status" htmlFor="cat-status">
          <NativeSelect id="cat-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            <option value="DRAFT">Draft</option>
            <option value="PENDING_REVIEW">Awaiting review</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="PAUSED">Paused</option>
            <option value="DISCONTINUED">Withdrawn</option>
          </NativeSelect>
        </Field>
        <Field
          label="Buyable now"
          htmlFor="cat-live"
          hint="Approved, in date and in stock"
        >
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              id="cat-live"
              type="checkbox"
              checked={liveOnly}
              onChange={(e) => setLiveOnly(e.target.checked)}
              className="size-4"
            />
            Only offers that can be bought today
          </label>
        </Field>
      </Card>

      {endingSoon.length > 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 bg-[var(--color-tint-amber)] p-4">
          <div>
            <p className="text-sm font-medium">
              <CalendarClock aria-hidden="true" className="mr-1 inline size-4 align-[-2px]" />
              {endingSoon.length} {endingSoon.length === 1 ? 'offer comes' : 'offers come'} off sale
              within 30 days
            </p>
            <p className="text-xs text-[var(--color-content-muted)]">
              {isVendor
                ? 'Buyers stop seeing an offer after its end date. Open one and put it back on sale - it keeps its approval.'
                : 'After the end date these leave the buyable list. Ask the supplier to extend, or confirm the price still stands.'}
            </p>
          </div>
          <Button variant="secondary" onClick={() => setEndingSoonOnly((v) => !v)}>
            {endingSoonOnly ? 'Show everything' : 'Show only these'}
          </Button>
        </Card>
      ) : null}

      {canCompare && compare.length > 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
          <p className="text-sm">
            {compare.length} selected to compare
            {compare.length < 2 ? ' — pick at least one more' : ''}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setCompare([])}>
              Clear
            </Button>
            {compare.length < 2 ? (
              <Button disabled>
                <Scale aria-hidden="true" className="mr-1 size-4" /> Compare
              </Button>
            ) : (
              <Link
                href={`/catalogue/compare?ids=${compare.join(',')}&categoryId=${categoryId}`}
                className={linkButtonCls.primary}
              >
                <Scale aria-hidden="true" className="size-4" /> Compare
              </Link>
            )}
          </div>
        </Card>
      ) : null}

      {query.isPending ? <Skeleton className="h-64" /> : null}
      {query.isError ? (
        <Card>
          <ErrorState
            title="Could not load the catalogue"
            detail={query.error instanceof Error ? query.error.message : undefined}
          />
        </Card>
      ) : null}

      {query.isSuccess && offers.length === 0 ? (
        <Card>
          <EmptyState
            title={search ? 'Nothing matches that' : 'No offers yet'}
            description={
              search
                ? 'Try a shorter search, or clear the filters.'
                : isVendor
                  ? 'Add your first offer, put a picture on it, and send it for review.'
                  : 'Once suppliers publish offers, they appear here.'
            }
            action={
              canManage && !search ? (
                <Link href="/catalogue/new" className={linkButtonCls.primary}>
                  <Plus aria-hidden="true" className="size-4" /> Add your first offer
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {offers.map((offer) => (
          <Card key={offer.id} className="flex flex-col overflow-hidden">
            <Link href={`/catalogue/${offer.id}`} className="block aspect-[4/3] w-full">
              <OfferImage
                productId={offer.id}
                imageId={offer.primaryImageId}
                alt={`${offer.brand ?? ''} ${offer.name}`.trim()}
              />
            </Link>
            <div className="grid flex-1 gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/catalogue/${offer.id}`}
                  className="font-medium leading-tight hover:underline"
                >
                  {offer.name}
                </Link>
                <OfferStatus status={offer.effectiveStatus} />
              </div>
              <p className="text-xs text-[var(--color-content-muted)]">
                {[offer.brand, offer.model].filter(Boolean).join(' · ') || 'No brand recorded'}
                {offer.vendor && !isVendor ? ` — ${offer.vendor.name}` : ''}
              </p>
              <div className="mt-auto grid gap-1">
                <p className="text-lg font-semibold">
                  <Money amount={offer.landedCost} />
                </p>
                <p className="text-xs text-[var(--color-content-subtle)]">
                  Landed cost per unit, including GST · {daysUntil(offer.availableUntil)}
                </p>
                <p className="text-xs text-[var(--color-content-subtle)]">
                  {offer.availableQuantity} available
                  {offer.minOrderQuantity > 1 ? `, minimum order ${offer.minOrderQuantity}` : ''}
                </p>
              </div>
              {canCompare ? (
                <label className="mt-1 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={compare.includes(offer.id)}
                    onChange={() => toggleCompare(offer.id)}
                    className="size-4"
                  />
                  Compare
                </label>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
