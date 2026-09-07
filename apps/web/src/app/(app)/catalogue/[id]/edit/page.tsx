'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { EMPTY_DRAFT, OfferForm, draftToBody, type OfferDraft } from '@/components/catalogue/offer-form';

/**
 * Editing an offer.
 *
 * A supplier changing the price or specification of an approved offer sends it
 * back for review — the reviewer approved those values, not the row. The API
 * decides that; this page only says so.
 */

type Loaded = {
  id: string;
  vendorId: string;
  name: string;
  categoryId: string;
  brand: string | null;
  model: string | null;
  manufacturer: string | null;
  vendorSku: string | null;
  mpn: string | null;
  description: string | null;
  condition: string;
  status: string;
  youtubeVideoId: string | null;
  unitPrice: string;
  gstPercent: string;
  discount: string;
  shippingCost: string;
  installationCost: string;
  otherCharges: string;
  minOrderQuantity: number;
  availableQuantity: number;
  paymentTerms: string | null;
  leadTimeDays: number | null;
  warrantyMonths: number | null;
  availableFrom: string;
  availableUntil: string;
  specs: Record<string, string> | null;
};

const day = (iso: string) => iso.slice(0, 10);

function toDraft(o: Loaded): OfferDraft {
  return {
    ...EMPTY_DRAFT,
    vendorId: o.vendorId,
    name: o.name,
    categoryId: o.categoryId,
    brand: o.brand ?? '',
    model: o.model ?? '',
    manufacturer: o.manufacturer ?? '',
    vendorSku: o.vendorSku ?? '',
    mpn: o.mpn ?? '',
    description: o.description ?? '',
    condition: o.condition,
    // Rebuilt from the stored id: the original link was never kept, and this is
    // the only form of it the server accepts back.
    youtubeUrl: o.youtubeVideoId ? `https://www.youtube.com/watch?v=${o.youtubeVideoId}` : '',
    unitPrice: String(o.unitPrice),
    gstPercent: String(o.gstPercent),
    discount: String(o.discount),
    shippingCost: String(o.shippingCost),
    installationCost: String(o.installationCost),
    otherCharges: String(o.otherCharges),
    minOrderQuantity: String(o.minOrderQuantity),
    availableQuantity: String(o.availableQuantity),
    paymentTerms: o.paymentTerms ?? '',
    leadTimeDays: o.leadTimeDays === null ? '' : String(o.leadTimeDays),
    warrantyMonths: o.warrantyMonths === null ? '' : String(o.warrantyMonths),
    availableFrom: day(o.availableFrom),
    availableUntil: day(o.availableUntil),
    specs: o.specs ?? {},
  };
}

export default function EditOfferPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isVendor = Boolean(user?.roles?.includes('VENDOR'));

  const query = useQuery({
    queryKey: ['vendor-product', id],
    queryFn: () => apiFetch<Loaded>(`/vendor-products/${id}`),
  });

  const update = useMutation({
    mutationFn: (draft: OfferDraft) =>
      apiFetch(`/vendor-products/${id}`, {
        method: 'PATCH',
        // The supplier is fixed on an existing offer, so it is never sent.
        body: draftToBody(draft, { includeVendor: false }),
      }),
    onSuccess: async () => {
      toast.success('Offer updated');
      await qc.invalidateQueries({ queryKey: ['vendor-product', id] });
      router.push(`/catalogue/${id}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update the offer'),
  });

  if (query.isPending) return <Skeleton className="h-96" />;
  if (query.isError || !query.data) {
    return (
      <Card>
        <ErrorState
          title="Could not load this offer"
          detail={query.error instanceof Error ? query.error.message : undefined}
        />
      </Card>
    );
  }

  const approved = ['APPROVED', 'ACTIVE', 'EXPIRING_SOON'].includes(query.data.status);

  return (
    <div className="grid gap-4">
      <div>
        <Link
          href={`/catalogue/${id}`}
          className="inline-flex items-center gap-1 text-sm text-[var(--color-content-muted)] hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4" /> Back to the offer
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Edit offer</h1>
        {isVendor && approved ? (
          <p className="text-sm text-[var(--color-content-muted)]">
            Changing the price or specification sends this back for review — what was approved was
            those values, not the entry itself.
          </p>
        ) : null}
      </header>
      <OfferForm
        initial={toDraft(query.data)}
        submitLabel="Save changes"
        busy={update.isPending}
        isEdit
        onSubmit={(draft) => update.mutate(draft)}
        onCancel={() => router.push(`/catalogue/${id}`)}
      />
    </div>
  );
}
