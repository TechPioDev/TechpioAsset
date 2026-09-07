'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Pencil, Send, ShoppingCart, Star, Trash2, Upload, X } from 'lucide-react';
import { PERMISSIONS, PRODUCT_IMAGE_RULES, formatInr } from '@techpioasset/domain';
import { API_BASE, apiFetch, getAccessToken } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import {
  Button,
  Card,
  controlCls,
  ErrorState,
  Field,
  linkButtonCls,
  NativeSelect,
  Skeleton,
} from '@/components/ui';
import { Money, OfferImage, OfferStatus, daysUntil, type Offer } from '@/components/catalogue/shared';

/**
 * One offer (v2.42).
 *
 * The same page for a supplier working on its own draft and for a buyer
 * deciding whether to take it, because they are looking at the same thing. What
 * differs is which actions appear, and every one of those is enforced again by
 * the API - the buttons are a convenience, not the control.
 */

type OfferDetail = Offer & {
  description: string | null;
  manufacturer: string | null;
  vendorSku: string | null;
  mpn: string | null;
  specs: Record<string, string> | null;
  youtubeVideoId: string | null;
  gstPercent: string;
  discount: string;
  shippingCost: string;
  installationCost: string;
  otherCharges: string;
  paymentTerms: string | null;
  vendor: { id: string; name: string; contactEmail: string | null } | null;
  images: { id: string; isPrimary: boolean; sortOrder: number; mimeType: string; sizeBytes: number }[];
  reviews: { decision: string; comments: string | null; createdAt: string }[];
};

type SpecField = { key: string; label: string; unit: string | null };

/** The money, itemised. A landed cost nobody can take apart is a number to distrust. */
function PriceBreakdown({ offer }: { offer: OfferDetail }) {
  const goods = Number(offer.unitPrice) - Number(offer.discount);
  const taxable = goods + Number(offer.shippingCost) + Number(offer.installationCost);
  const gst = (taxable * Number(offer.gstPercent)) / 100;

  const row = (label: string, value: number, muted = false) => (
    <div className={`flex justify-between gap-4 ${muted ? 'text-[var(--color-content-muted)]' : ''}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatInr(value)}</dd>
    </div>
  );

  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-semibold">What makes up the price</h2>
      <dl className="grid gap-1.5 text-sm">
        {row('Unit price', Number(offer.unitPrice))}
        {Number(offer.discount) > 0 ? row('Less discount', -Number(offer.discount), true) : null}
        {Number(offer.shippingCost) > 0 ? row('Shipping', Number(offer.shippingCost), true) : null}
        {Number(offer.installationCost) > 0
          ? row('Installation', Number(offer.installationCost), true)
          : null}
        <div className="mt-1 flex justify-between gap-4 border-t border-[var(--color-border)] pt-1.5">
          <dt>Taxable value</dt>
          <dd className="tabular-nums">{formatInr(taxable)}</dd>
        </div>
        {row(`GST at ${Number(offer.gstPercent)}%`, gst, true)}
        {Number(offer.otherCharges) > 0 ? row('Other charges', Number(offer.otherCharges), true) : null}
        <div className="mt-1 flex justify-between gap-4 border-t border-[var(--color-border)] pt-2 font-semibold">
          <dt>Landed cost per unit</dt>
          <dd className="tabular-nums">{formatInr(Number(offer.landedCost))}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-[var(--color-content-subtle)]">
        Shipping and installation are taxed with the goods; GST is charged on the discounted value.
      </p>
    </Card>
  );
}

export default function OfferPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const [quantity, setQuantity] = useState(1);
  const [decision, setDecision] = useState('APPROVED');
  const [comments, setComments] = useState('');

  const isVendor = Boolean(user?.roles?.includes('VENDOR'));
  const canManage = Boolean(user?.permissions?.includes(PERMISSIONS.VENDOR_PRODUCTS_MANAGE));
  const canReview = Boolean(user?.permissions?.includes(PERMISSIONS.VENDOR_PRODUCTS_REVIEW)) && !isVendor;
  const canSelect = canManage && !isVendor;

  const query = useQuery({
    queryKey: ['vendor-product', id],
    queryFn: () => apiFetch<OfferDetail>(`/vendor-products/${id}`),
  });
  const offer = query.data;

  const { data: specFields } = useQuery({
    queryKey: ['spec-templates', offer?.categoryId],
    queryFn: () => apiFetch<SpecField[]>(`/spec-templates?categoryId=${offer!.categoryId}`),
    enabled: Boolean(offer?.categoryId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['vendor-product', id] });

  const submit = useMutation({
    mutationFn: () => apiFetch(`/vendor-products/${id}/submit`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success('Sent for review');
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not send it for review'),
  });

  const review = useMutation({
    mutationFn: () =>
      apiFetch(`/vendor-products/${id}/review`, {
        method: 'POST',
        body: { decision, comments: comments.trim() || undefined },
      }),
    onSuccess: async () => {
      toast.success('Decision recorded');
      setComments('');
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not record the decision'),
  });

  const select = useMutation({
    mutationFn: () =>
      apiFetch(`/vendor-products/${id}/select`, { method: 'POST', body: { quantity } }),
    onSuccess: () => toast.success('Offer chosen; the price has been recorded as it stands today'),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not choose this offer'),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      // FormData, so no JSON content-type: the browser sets the multipart boundary.
      const res = await fetch(`${API_BASE}/vendor-products/${id}/images`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        body: form,
      });
      if (!res.ok) {
        const problem = (await res.json().catch(() => null)) as { detail?: string; title?: string } | null;
        throw new Error(problem?.detail ?? problem?.title ?? 'Upload failed');
      }
    },
    onSuccess: async () => {
      toast.success('Picture added');
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not add the picture'),
  });

  const removeImage = useMutation({
    mutationFn: (imageId: string) =>
      apiFetch(`/vendor-products/${id}/images/${imageId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not remove the picture'),
  });

  const makePrimary = useMutation({
    mutationFn: (imageId: string) =>
      apiFetch(`/vendor-products/${id}/images/${imageId}/primary`, { method: 'POST' }),
    onSuccess: async () => {
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not change the main picture'),
  });

  const withdraw = useMutation({
    mutationFn: () => apiFetch(`/vendor-products/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Offer withdrawn');
      router.push('/catalogue');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not withdraw the offer'),
  });

  if (query.isPending) return <Skeleton className="h-96" />;
  if (query.isError || !offer) {
    return (
      <Card>
        <ErrorState
          title="Could not load this offer"
          detail={query.error instanceof Error ? query.error.message : undefined}
        />
      </Card>
    );
  }

  const editable = ['DRAFT', 'REJECTED', 'CORRECTION_REQUESTED', 'PAUSED'].includes(offer.status);
  const buyable = ['ACTIVE', 'EXPIRING_SOON'].includes(offer.effectiveStatus);
  const labelFor = (key: string) => specFields?.find((f) => f.key === key)?.label ?? key;
  const unitFor = (key: string) => specFields?.find((f) => f.key === key)?.unit ?? '';

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

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{offer.name}</h1>
          <p className="text-sm text-[var(--color-content-muted)]">
            {[offer.brand, offer.model, offer.vendor?.name].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OfferStatus status={offer.effectiveStatus} />
          {canManage && editable ? (
            <Link href={`/catalogue/${offer.id}/edit`} className={linkButtonCls.secondary}>
              <Pencil aria-hidden="true" className="size-4" /> Edit
            </Link>
          ) : null}
          {canManage && offer.status === 'DRAFT' ? (
            <Button loading={submit.isPending} onClick={() => submit.mutate()}>
              <Send aria-hidden="true" className="mr-1 size-4" /> Send for review
            </Button>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="grid gap-4">
          <Card className="overflow-hidden">
            <div className="aspect-[16/10] w-full">
              <OfferImage
                productId={offer.id}
                imageId={offer.images.find((i) => i.isPrimary)?.id ?? offer.images[0]?.id}
                alt={offer.name}
              />
            </div>
            {offer.images.length > 0 ? (
              <div className="flex flex-wrap gap-2 p-3">
                {offer.images.map((image) => (
                  <div key={image.id} className="relative">
                    <div className="size-16 overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border)]">
                      <OfferImage productId={offer.id} imageId={image.id} alt="" />
                    </div>
                    {canManage && editable ? (
                      <div className="mt-1 flex justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => makePrimary.mutate(image.id)}
                          aria-label={image.isPrimary ? 'Main picture' : 'Make this the main picture'}
                          disabled={image.isPrimary}
                          className="rounded p-1 text-[var(--color-content-subtle)] hover:text-[var(--color-brand)] disabled:opacity-100"
                        >
                          <Star
                            aria-hidden="true"
                            className={`size-3.5 ${image.isPrimary ? 'fill-[var(--color-brand)] text-[var(--color-brand)]' : ''}`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeImage.mutate(image.id)}
                          aria-label="Remove this picture"
                          className="rounded p-1 text-[var(--color-content-subtle)] hover:text-[var(--tone-critical-fg)]"
                        >
                          <Trash2 aria-hidden="true" className="size-3.5" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {canManage && editable && offer.images.length < PRODUCT_IMAGE_RULES.max ? (
              <div className="border-t border-[var(--color-border)] p-3">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[var(--color-brand)]">
                  <Upload aria-hidden="true" className="size-4" />
                  Add a picture
                  <input
                    type="file"
                    accept={PRODUCT_IMAGE_RULES.mimes.join(',')}
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) upload.mutate(file);
                      e.target.value = '';
                    }}
                  />
                </label>
                <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
                  Up to {PRODUCT_IMAGE_RULES.max} pictures, {PRODUCT_IMAGE_RULES.maxBytes / 1024} KB each.
                  JPG, PNG or WEBP.
                </p>
              </div>
            ) : null}
          </Card>

          {offer.description ? (
            <Card className="p-5">
              <h2 className="mb-2 text-sm font-semibold">Description</h2>
              <p className="whitespace-pre-line text-sm text-[var(--color-content-muted)]">
                {offer.description}
              </p>
            </Card>
          ) : null}

          {offer.specs && Object.keys(offer.specs).length > 0 ? (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold">Specification</h2>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {Object.entries(offer.specs).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-3 border-b border-[var(--color-border)] pb-1">
                    <dt className="text-[var(--color-content-muted)]">{labelFor(key)}</dt>
                    <dd className="text-right font-medium">
                      {value}
                      {unitFor(key) ? ` ${unitFor(key)}` : ''}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          ) : null}

          {offer.youtubeVideoId ? (
            <Card className="overflow-hidden">
              <h2 className="p-5 pb-3 text-sm font-semibold">Video</h2>
              {/* Only the video id is stored, never vendor-supplied embed code,
                  so what goes into this URL cannot be markup. */}
              <div className="aspect-video w-full">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${offer.youtubeVideoId}`}
                  title={`${offer.name} video`}
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="size-full border-0"
                />
              </div>
            </Card>
          ) : null}
        </div>

        <div className="grid gap-4 self-start">
          <PriceBreakdown offer={offer} />

          <Card className="grid gap-2 p-5 text-sm">
            <h2 className="text-sm font-semibold">Terms</h2>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--color-content-muted)]">Available</span>
              <span>
                {offer.availableQuantity} unit{offer.availableQuantity === 1 ? '' : 's'}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--color-content-muted)]">Minimum order</span>
              <span>{offer.minOrderQuantity}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--color-content-muted)]">Price held until</span>
              <span>
                {new Date(offer.availableUntil).toLocaleDateString()} ({daysUntil(offer.availableUntil)})
              </span>
            </div>
            {offer.leadTimeDays !== null ? (
              <div className="flex justify-between gap-3">
                <span className="text-[var(--color-content-muted)]">Lead time</span>
                <span>{offer.leadTimeDays} days</span>
              </div>
            ) : null}
            {offer.warrantyMonths !== null ? (
              <div className="flex justify-between gap-3">
                <span className="text-[var(--color-content-muted)]">Warranty</span>
                <span>{offer.warrantyMonths} months</span>
              </div>
            ) : null}
            {offer.paymentTerms ? (
              <div className="flex justify-between gap-3">
                <span className="text-[var(--color-content-muted)]">Payment terms</span>
                <span className="text-right">{offer.paymentTerms}</span>
              </div>
            ) : null}
          </Card>

          {canSelect ? (
            <Card className="grid gap-3 p-5">
              <h2 className="text-sm font-semibold">Choose this offer</h2>
              {buyable ? (
                <>
                  <Field label="How many" htmlFor="select-qty">
                    <input
                      id="select-qty"
                      type="number"
                      min={offer.minOrderQuantity}
                      max={offer.availableQuantity}
                      value={quantity}
                      onChange={(e) => setQuantity(Number(e.target.value))}
                      className={controlCls}
                    />
                  </Field>
                  <p className="text-sm">
                    Total{' '}
                    <strong>
                      <Money amount={Number(offer.landedCost) * quantity} />
                    </strong>
                  </p>
                  <Button loading={select.isPending} onClick={() => select.mutate()}>
                    <ShoppingCart aria-hidden="true" className="mr-1 size-4" /> Choose this offer
                  </Button>
                  <p className="text-xs text-[var(--color-content-subtle)]">
                    The price and specification are recorded as they stand today, so a later change by
                    the supplier cannot rewrite the decision.
                  </p>
                </>
              ) : (
                <p className="text-sm text-[var(--color-content-muted)]">
                  This offer cannot be chosen while it is{' '}
                  {offer.effectiveStatus.toLowerCase().replace(/_/g, ' ')}.
                </p>
              )}
            </Card>
          ) : null}

          {canReview && offer.status === 'PENDING_REVIEW' ? (
            <Card className="grid gap-3 p-5">
              <h2 className="text-sm font-semibold">Review</h2>
              <Field label="Decision" htmlFor="review-decision">
                <NativeSelect
                  id="review-decision"
                  value={decision}
                  onChange={(e) => setDecision(e.target.value)}
                >
                  <option value="APPROVED">Approve</option>
                  <option value="CORRECTION_REQUESTED">Ask for a correction</option>
                  <option value="RETURNED_TO_VENDOR">Return to the supplier</option>
                  <option value="REJECTED">Reject</option>
                </NativeSelect>
              </Field>
              <Field
                label="Comments"
                htmlFor="review-comments"
                hint={
                  decision === 'APPROVED'
                    ? 'Optional.'
                    : 'Required — the supplier cannot act on a decision without a reason.'
                }
              >
                <textarea
                  id="review-comments"
                  rows={3}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  className={controlCls}
                />
              </Field>
              <Button
                loading={review.isPending}
                disabled={decision !== 'APPROVED' && !comments.trim()}
                onClick={() => review.mutate()}
              >
                <Check aria-hidden="true" className="mr-1 size-4" /> Record decision
              </Button>
            </Card>
          ) : null}

          {offer.reviews.length > 0 ? (
            <Card className="grid gap-2 p-5">
              <h2 className="text-sm font-semibold">Review history</h2>
              {offer.reviews.map((r, i) => (
                <div key={i} className="border-b border-[var(--color-border)] pb-2 text-sm last:border-0">
                  <p className="font-medium">{r.decision.replace(/_/g, ' ').toLowerCase()}</p>
                  {r.comments ? (
                    <p className="text-[var(--color-content-muted)]">{r.comments}</p>
                  ) : null}
                  <p className="text-xs text-[var(--color-content-subtle)]">
                    {new Date(r.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </Card>
          ) : null}

          {canManage ? (
            <Button
              variant="secondary"
              loading={withdraw.isPending}
              onClick={() => {
                if (confirm('Withdraw this offer? It stays readable so past purchases still make sense.')) {
                  withdraw.mutate();
                }
              }}
            >
              <X aria-hidden="true" className="mr-1 size-4" /> Withdraw this offer
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
