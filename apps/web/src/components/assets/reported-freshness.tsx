'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { relativeAge, reportFreshnessWording } from '@techpioasset/domain';

/**
 * How old the agent's data is, said plainly (v2.38).
 *
 * Everything on the hardware, OS and health tabs is a snapshot from the last
 * time the machine checked in. Until now that was footnoted underneath in grey,
 * as an absolute date - which reads as provenance, not as a warning, and an
 * absolute date is the one format that makes staleness hard to judge. "26 Aug"
 * looks like a fact; "8 days ago" looks like a problem.
 *
 * This matters more than it sounds. Twenty-one of this company's thirty-four
 * agents stopped reporting on one evening in August and nobody noticed for a
 * week, because a machine last seen in August looked exactly like one seen an
 * hour ago. The data was not wrong; it was old, and nothing said so.
 *
 * So the stamp now leads the panel rather than trailing it - you learn the age
 * of what you are reading before you read it - and it changes tone as it ages.
 */

// The thresholds and every word of the banner live in the domain package, so
// the phone's Hardware tab says exactly what this one does. Re-exported for
// the pages that already import the relative age from here.
export { relativeAge };

export function ReportedFreshness({ source, at }: { source: string; at: string }) {
  const { freshness, headline, detail } = reportFreshnessWording(
    source,
    at,
    new Date(at).toLocaleString(),
  );

  if (freshness === 'stale') {
    return (
      <div
        className="mb-4 flex items-start gap-2 rounded-[var(--radius-control)] border px-3 py-2.5 text-sm"
        style={{
          color: 'var(--tone-warning-fg)',
          backgroundColor: 'var(--tone-warning-bg)',
          borderColor: 'var(--tone-warning-border)',
        }}
      >
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 flex-none" />
        <p>
          <span className="font-medium">{headline}</span> {detail}
        </p>
      </div>
    );
  }

  return (
    <p
      className={`mb-4 flex items-center gap-1.5 text-xs ${
        freshness === 'ageing' ? 'text-[var(--tone-warning-fg)]' : 'text-[var(--color-content-subtle)]'
      }`}
    >
      <RefreshCw aria-hidden="true" className="size-3.5" />
      {/* Relative first because that is the part being judged; the exact time
          follows for anyone who needs to quote it. */}
      {headline}
    </p>
  );
}
