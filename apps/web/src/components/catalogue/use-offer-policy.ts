'use client';

import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_VENDOR_OFFER_POLICY,
  submitActionLabel,
  type VendorOfferPolicy,
} from '@techpioasset/domain';
import { apiFetch } from '@/lib/api-client';

/**
 * Whether this tenant reviews supplier offers before buyers see them (v2.46).
 *
 * From its own endpoint rather than company settings, which a supplier cannot
 * read. Every screen that says the word "review" to a supplier needs this, and
 * five copies of the same useQuery is five chances for one of them to keep
 * promising an approval that no longer happens.
 *
 * Defaults to requiring review while the answer is in flight: describing a
 * gate that is not there is a smaller error than promising publication that
 * does not come.
 */
export function useOfferPolicy() {
  const { data } = useQuery({
    queryKey: ['vendor-offer-policy'],
    queryFn: () => apiFetch<{ policy: VendorOfferPolicy }>('/vendor-products/meta/policy'),
    staleTime: 5 * 60_000,
  });
  const policy = data?.policy ?? DEFAULT_VENDOR_OFFER_POLICY;
  return {
    policy,
    publishesAtOnce: policy === 'PUBLISH_IMMEDIATELY',
    submitLabel: submitActionLabel(policy),
  };
}
