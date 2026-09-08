'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2 } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, controlCls, ErrorState, Field, Skeleton } from '@/components/ui';

/**
 * A supplier's own company details (v2.45).
 *
 * The buying company owns the supplier's identity - its name, its code, whether
 * it is still active - so none of that is editable here. What a supplier
 * genuinely knows better than the buyer is how to reach it: who to call, at
 * what number, where it is, and its GST number. Keeping that current is work
 * the buyer would otherwise chase by email.
 */

type OwnVendor = {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  taxId: string | null;
  addressLine1: string | null;
  city: string | null;
  country: string | null;
  isActive: boolean;
};

type Draft = Omit<OwnVendor, 'id' | 'code' | 'name' | 'isActive'>;

const EMPTY: Draft = {
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  website: '',
  taxId: '',
  addressLine1: '',
  city: '',
  country: '',
};

export default function CompanyProfilePage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const query = useQuery({
    queryKey: ['own-vendor'],
    queryFn: () => apiFetch<OwnVendor>('/vendors/me'),
  });

  useEffect(() => {
    if (!query.data) return;
    const { id: _id, code: _code, name: _name, isActive: _active, ...rest } = query.data;
    setDraft({
      contactName: rest.contactName ?? '',
      contactEmail: rest.contactEmail ?? '',
      contactPhone: rest.contactPhone ?? '',
      website: rest.website ?? '',
      taxId: rest.taxId ?? '',
      addressLine1: rest.addressLine1 ?? '',
      city: rest.city ?? '',
      country: rest.country ?? '',
    });
  }, [query.data]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch('/vendors/me', {
        method: 'PATCH',
        // Blanks are sent as null, so clearing a field actually clears it
        // rather than storing an empty string nobody can search for.
        body: Object.fromEntries(
          Object.entries(draft).map(([k, v]) => [k, typeof v === 'string' && !v.trim() ? null : v]),
        ),
      }),
    onSuccess: async () => {
      toast.success('Company details saved');
      await qc.invalidateQueries({ queryKey: ['own-vendor'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save the details'),
  });

  if (query.isPending) return <Skeleton className="h-96" />;
  if (query.isError || !query.data) {
    return (
      <Card>
        <ErrorState
          title="Could not load your company details"
          detail={query.error instanceof Error ? query.error.message : undefined}
        />
      </Card>
    );
  }

  const field = (key: keyof Draft, label: string, hint?: string, type = 'text') => (
    <Field label={label} htmlFor={`cp-${key}`} hint={hint}>
      <input
        id={`cp-${key}`}
        type={type}
        value={draft[key] ?? ''}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        className={controlCls}
      />
    </Field>
  );

  return (
    <div className="grid gap-4">
      <div>
        <Link
          href="/catalogue"
          className="inline-flex items-center gap-1 text-sm text-[var(--color-content-muted)] hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4" /> Back to your offers
        </Link>
      </div>

      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Building2 aria-hidden="true" className="size-5 text-[var(--color-brand)]" /> Company
          details
        </h1>
        <p className="text-sm text-[var(--color-content-muted)]">
          How the buying company reaches you. Keeping this current saves them chasing you by email.
        </p>
      </header>

      <Card className="p-5">
        <div className="mb-4 border-b border-[var(--color-border)] pb-4">
          <p className="text-lg font-semibold">{query.data.name}</p>
          <p className="text-xs text-[var(--color-content-muted)]">
            Supplier code {query.data.code}
            {query.data.isActive ? '' : ' · currently inactive'}
          </p>
          <p className="mt-2 text-xs text-[var(--color-content-subtle)]">
            Your company name and code are the buying company&apos;s record of you, so they are set
            by them rather than here. Ask your contact there if either is wrong.
          </p>
        </div>

        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {field('contactName', 'Contact person')}
          {field('contactPhone', 'Phone', 'The number to call about an order.')}
          {field('contactEmail', 'Email', undefined, 'email')}
          {field('website', 'Website')}
          {field('taxId', 'GST number')}
          {field('city', 'City')}
          <div className="sm:col-span-2">{field('addressLine1', 'Address')}</div>
          {field('country', 'Country')}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={save.isPending}>
              Save details
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
