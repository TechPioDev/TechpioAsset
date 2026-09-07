'use client';

import { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { OFFER_LIFECYCLE_TOKENS } from '@techpioasset/ui-tokens';
import type { OfferLifecycle } from '@techpioasset/domain';
import { formatInr } from '@techpioasset/domain';
import { API_BASE, getAccessToken } from '@/lib/api-client';
import { StatusBadge } from '@/components/status-badge';
import { Skeleton } from '@/components/ui';

/**
 * Pieces shared by the catalogue screens (v2.42).
 *
 * Prices are shown through formatInr rather than Intl in each component, so the
 * grouping is the Indian one everywhere - 1,08,000 rather than 108,000 - and a
 * figure looks the same on every screen that quotes it.
 */

export type Offer = {
  id: string;
  vendorId: string;
  name: string;
  brand: string | null;
  model: string | null;
  condition: string;
  status: string;
  effectiveStatus: OfferLifecycle;
  currency: string;
  unitPrice: string;
  landedCost: string;
  availableQuantity: number;
  minOrderQuantity: number;
  availableFrom: string;
  availableUntil: string;
  leadTimeDays: number | null;
  warrantyMonths: number | null;
  categoryId: string;
  vendor?: { id: string; name: string } | null;
  primaryImageId?: string | null;
};

/** ₹ with Indian grouping. The API sends decimal strings, never floats. */
export function Money({ amount, className }: { amount: string | number; className?: string }) {
  return <span className={className}>{formatInr(Number(amount))}</span>;
}

export function OfferStatus({ status }: { status: OfferLifecycle }) {
  const token = OFFER_LIFECYCLE_TOKENS[status];
  if (!token) return null;
  return <StatusBadge token={token} size="sm" />;
}

/**
 * An image behind the API's auth.
 *
 * next/image cannot serve these: the bytes come from an authenticated request,
 * and the optimiser would have to re-fetch them server-side with no token, for
 * a picture that is commercial information rather than a public asset.
 */
export function OfferImage({
  productId,
  imageId,
  alt,
  className = 'size-full object-cover',
}: {
  productId: string;
  imageId: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const revoke = useRef<string | null>(null);

  useEffect(() => {
    if (!imageId) {
      setFailed(true);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/vendor-products/${productId}/images/${imageId}`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (!alive) return;
        const objectUrl = URL.createObjectURL(blob);
        revoke.current = objectUrl;
        setUrl(objectUrl);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      if (revoke.current) URL.revokeObjectURL(revoke.current);
    };
  }, [productId, imageId]);

  if (failed || !imageId) {
    return (
      <div
        className="grid size-full place-items-center bg-[var(--color-surface-sunken)] text-[var(--color-content-subtle)]"
        aria-hidden="true"
      >
        <ImageOff className="size-6" />
      </div>
    );
  }
  if (!url) return <Skeleton className="size-full" />;
  // eslint-disable-next-line @next/next/no-img-element -- see the note above.
  return <img src={url} alt={alt} className={className} />;
}

/** How a requirement came out. Never colour alone - the word is always there. */
export function OutcomePill({ outcome }: { outcome: 'PASS' | 'PARTIAL' | 'FAIL' }) {
  const tone = outcome === 'PASS' ? 'success' : outcome === 'PARTIAL' ? 'warning' : 'critical';
  const label = outcome === 'PASS' ? 'Pass' : outcome === 'PARTIAL' ? 'Partial' : 'Fail';
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{
        color: `var(--tone-${tone}-fg)`,
        backgroundColor: `var(--tone-${tone}-bg)`,
        borderColor: `var(--tone-${tone}-border)`,
      }}
    >
      {label}
    </span>
  );
}

/** "in 3 days" / "today" - an expiry date nobody has to subtract in their head. */
export function daysUntil(iso: string): string {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'expires today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}
