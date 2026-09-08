import { useEffect, useState } from 'react';
import { DEFAULT_VENDOR_OFFER_POLICY, type VendorOfferPolicy } from '@techpioasset/domain';
import { useSession } from '../providers/session';

/**
 * Whether this tenant reviews supplier offers before buyers see them (v2.46).
 *
 * From its own endpoint rather than company settings, which a supplier cannot
 * read. Shared so the offer screen and the offer form cannot end up describing
 * two different workflows to the same person.
 *
 * Defaults to requiring review while the answer is in flight: describing a gate
 * that is not there is a smaller error than promising publication that does not
 * come.
 */
export function useOfferPolicy() {
  const { api } = useSession();
  const [policy, setPolicy] = useState<VendorOfferPolicy>(DEFAULT_VENDOR_OFFER_POLICY);

  useEffect(() => {
    let live = true;
    void api
      .request<{ policy: VendorOfferPolicy }>('/vendor-products/meta/policy')
      .then((r) => {
        if (live && r?.policy) setPolicy(r.policy);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api]);

  return { policy, publishesAtOnce: policy === 'PUBLISH_IMMEDIATELY' };
}
