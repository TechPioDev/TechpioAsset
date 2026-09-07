'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Card, Skeleton } from '@/components/ui';
import { EMPTY_DRAFT, OfferForm, draftToBody, type OfferDraft } from '@/components/catalogue/offer-form';

/** A new offer. Always created as a draft; publication is a separate, reviewed act. */
export default function NewOfferPage() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();

  const create = useMutation({
    mutationFn: (draft: OfferDraft) =>
      apiFetch<{ id: string }>('/vendor-products', {
        method: 'POST',
        body: draftToBody(draft, { includeVendor: !user?.roles?.includes('VENDOR') }),
      }),
    onSuccess: (created) => {
      toast.success('Draft saved. Add a picture, then send it for review.');
      router.push(`/catalogue/${created.id}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save the offer'),
  });

  if (!user) return <Skeleton className="h-96" />;
  if (!user.permissions?.includes(PERMISSIONS.VENDOR_PRODUCTS_MANAGE)) {
    return (
      <Card className="mx-auto mt-10 max-w-md p-6 text-sm text-[var(--color-content-muted)]">
        Adding an offer needs the catalogue permission. Ask your administrator.
      </Card>
    );
  }

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
        <h1 className="text-xl font-semibold tracking-tight">New offer</h1>
        <p className="text-sm text-[var(--color-content-muted)]">
          Saved as a draft. It needs at least one picture before it can go for review, and buyers see
          it only once it has been approved.
        </p>
      </header>
      <OfferForm
        initial={EMPTY_DRAFT}
        submitLabel="Save draft"
        busy={create.isPending}
        onSubmit={(draft) => create.mutate(draft)}
        onCancel={() => router.push('/catalogue')}
      />
    </div>
  );
}
