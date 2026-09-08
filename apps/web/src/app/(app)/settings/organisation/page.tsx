'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import {
  DEFAULT_VENDOR_OFFER_POLICY,
  REQUEST_CREATION_POLICIES,
  REQUEST_POLICY_LABELS,
  type RequestCreationPolicy,
  type VendorOfferPolicy,
} from '@techpioasset/domain';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, ErrorState, Field, Input, Skeleton } from '@/components/ui';

/**
 * Organisation settings (v2.15). Born from a single circled screenshot: every
 * estimate read "USD" because the company's base currency was the provisioning
 * default and nothing let anyone change it. Currency is a LABEL here, not a
 * conversion - changing it relabels money going forward and converts nothing.
 */

interface CompanySettings {
  name: string;
  legalName: string | null;
  baseCurrency: string;
  timezone: string;
  locale: string;
  /** v2.22 - who may raise a request across the whole company. */
  requestPolicy: RequestCreationPolicy;
  /** v2.46 - whether a supplier's offer waits for an internal decision. */
  vendorOfferPolicy: VendorOfferPolicy;
}

const CURRENCIES: [string, string][] = [
  ['INR', 'INR — Indian Rupee'],
  ['USD', 'USD — US Dollar'],
  ['EUR', 'EUR — Euro'],
  ['GBP', 'GBP — British Pound'],
  ['AED', 'AED — UAE Dirham'],
  ['AUD', 'AUD — Australian Dollar'],
  ['CAD', 'CAD — Canadian Dollar'],
  ['SGD', 'SGD — Singapore Dollar'],
];

const selectCls =
  'h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 text-sm';

export default function OrganisationSettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['company-settings'],
    queryFn: () => apiFetch<CompanySettings>('/company'),
  });

  const [form, setForm] = useState<{
    name: string;
    baseCurrency: string;
    requestPolicy: RequestCreationPolicy;
    vendorOfferPolicy: VendorOfferPolicy;
  } | null>(null);
  const current = settings.data;
  const draft = form ?? {
    name: current?.name ?? '',
    baseCurrency: current?.baseCurrency ?? 'USD',
    requestPolicy: current?.requestPolicy ?? 'EVERYONE',
    vendorOfferPolicy: current?.vendorOfferPolicy ?? DEFAULT_VENDOR_OFFER_POLICY,
  };
  const set = (patch: Partial<typeof draft>) => setForm({ ...draft, ...patch });

  const save = useMutation({
    mutationFn: () =>
      apiFetch<CompanySettings>('/company', {
        method: 'PATCH',
        body: {
          name: draft.name.trim(),
          baseCurrency: draft.baseCurrency,
          requestPolicy: draft.requestPolicy,
          vendorOfferPolicy: draft.vendorOfferPolicy,
        },
      }),
    onSuccess: () => {
      toast.success('Organisation settings saved');
      setForm(null);
      void queryClient.invalidateQueries({ queryKey: ['company-settings'] });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save'),
  });

  if (settings.isPending) return <Skeleton className="mx-auto h-64 max-w-2xl" />;
  if (settings.isError) {
    const forbidden = settings.error instanceof ApiError && settings.error.status === 403;
    return (
      <ErrorState
        title={forbidden ? 'Settings managers only' : 'Could not load settings'}
        detail={
          forbidden
            ? 'Changing organisation settings needs the settings-manage permission.'
            : (settings.error as Error).message
        }
      />
    );
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header className="flex items-start gap-4">
        <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[var(--color-brand)] text-white shadow-sm">
          <Building2 aria-hidden="true" className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organisation</h1>
          <p className="mt-0.5 text-sm text-[var(--color-content-muted)]">
            Company-wide settings: the name on documents and the currency money is labelled in.
          </p>
        </div>
      </header>

      <Card className="grid gap-4 p-5">
        <Field label="Company name" htmlFor="on">
          <Input id="on" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>

        <div className="max-w-sm">
          <Field label="Base currency" htmlFor="oc">
            <select
              id="oc"
              value={draft.baseCurrency}
              onChange={(e) => set({ baseCurrency: e.target.value })}
              className={selectCls}
            >
              {CURRENCIES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
              {CURRENCIES.every(([code]) => code !== draft.baseCurrency) ? (
                <option value={draft.baseCurrency}>{draft.baseCurrency}</option>
              ) : null}
            </select>
          </Field>
          <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
            Labels new estimates and prices. Existing figures keep the currency they were recorded
            in — nothing is converted.
          </p>
        </div>

        {/* v2.22 - the company-wide half of "who may raise a request". The
            per-person exception lives on the person, under People > Manage. */}
        <div className="max-w-sm border-t border-[var(--color-border)] pt-4">
          <Field label="Who can raise requests" htmlFor="orp">
            <select
              id="orp"
              value={draft.requestPolicy}
              onChange={(e) => set({ requestPolicy: e.target.value as RequestCreationPolicy })}
              className={selectCls}
            >
              {REQUEST_CREATION_POLICIES.map((policy) => (
                <option key={policy} value={policy}>
                  {REQUEST_POLICY_LABELS[policy]}
                </option>
              ))}
            </select>
          </Field>
          <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
            {draft.requestPolicy === 'EVERYONE'
              ? 'Any employee can raise a request for themselves.'
              : 'Employees cannot raise their own requests; IT and HR raise them on their behalf. Individual people can still be allowed under People \u203a Manage.'}
          </p>
        </div>

        {/* v2.46 - the catalogue's two shapes: a gatekept price list, or a
            noticeboard the buying team picks from. */}
        <div className="max-w-sm border-t border-[var(--color-border)] pt-4">
          <Field label="Supplier offers" htmlFor="ovp">
            <select
              id="ovp"
              value={draft.vendorOfferPolicy}
              onChange={(e) => set({ vendorOfferPolicy: e.target.value as VendorOfferPolicy })}
              className={selectCls}
            >
              <option value="REVIEW_REQUIRED">Wait for someone here to approve them</option>
              <option value="PUBLISH_IMMEDIATELY">
                Go live as soon as the supplier sends them
              </option>
            </select>
          </Field>
          <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
            {draft.vendorOfferPolicy === 'REVIEW_REQUIRED'
              ? 'Nothing reaches your buyers until somebody here has looked at it. Choose this when the catalogue is a price list people quote from.'
              : 'Suppliers post what they sell and your team picks what it needs. An offer still needs a picture and its required specifications before a supplier can send it — that gate protects the buyer, not the reviewer. Anything already waiting for approval goes live when you save.'}
          </p>
        </div>

        <div>
          <Button
            size="sm"
            loading={save.isPending}
            disabled={!draft.name.trim()}
            onClick={() => save.mutate()}
          >
            Save settings
          </Button>
        </div>
      </Card>
    </div>
  );
}
