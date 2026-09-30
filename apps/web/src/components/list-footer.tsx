'use client';

import { useEffect, useState } from 'react';

/**
 * How many rows there are, how many you are looking at, and how many to show
 * (v2.97).
 *
 * The asset list asked for 25 rows and said nothing about it. A fleet of 169
 * became seven pages of "Previous / Next" with no total anywhere on screen, so
 * the only way to learn how many assets matched a filter was to reach the last
 * page and add up.
 *
 * Two things this fixes beyond the page size itself:
 *
 *   - The count is always shown. "Showing 1-25 of 169" answers a question the
 *     old footer never did, and answers it on the first page rather than the
 *     last.
 *   - The footer is shown even when there is ONE page. The old one rendered
 *     only when totalPages > 1, so choosing 200 rows made the control that
 *     chose it disappear - you could not change your mind without first making
 *     the list long again.
 *
 * There is no "All". It is a safe request today at 169 assets and an unsafe one
 * at fifty thousand, and a control that works until the day it does not is
 * worse than one that never promised. The whole set is what Export is for: it
 * honours the same filters and streams a CSV instead of rendering every row
 * into a browser.
 */

export const PAGE_SIZES = [25, 50, 100, 200] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const DEFAULT_PAGE_SIZE: PageSize = 25;

/**
 * Remembers the choice for this reader, on this device.
 *
 * A per-viewer convenience, which is exactly what browser storage is for - it
 * is not shared, not synced and not read back by anything that matters. Every
 * access is wrapped because it throws in a private window and returns nothing
 * with site data cleared, and a list that will not render because it could not
 * remember a row count would be a poor trade.
 */
export function usePageSize(storageKey: string): [PageSize, (n: PageSize) => void] {
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);

  // Read after mount, never during render: the server has no localStorage, and
  // reading it while rendering makes the first client paint disagree with the
  // HTML that came from the server.
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(storageKey));
      if ((PAGE_SIZES as readonly number[]).includes(saved)) setPageSize(saved as PageSize);
    } catch {
      /* private window, blocked storage - the default is a fine answer */
    }
  }, [storageKey]);

  const choose = (n: PageSize) => {
    setPageSize(n);
    try {
      window.localStorage.setItem(storageKey, String(n));
    } catch {
      /* the choice still applies to this visit */
    }
  };

  return [pageSize, choose];
}

export function ListFooter({
  page,
  pageSize,
  totalItems,
  totalPages,
  onPage,
  onPageSize,
  noun = 'items',
}: {
  page: number;
  pageSize: PageSize;
  totalItems: number;
  totalPages: number;
  onPage: (updater: (p: number) => number) => void;
  onPageSize: (n: PageSize) => void;
  /** Plural, for the count: "169 assets". */
  noun?: string;
}) {
  if (totalItems === 0) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalItems);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p className="text-[var(--color-content-subtle)]">
        Showing <span className="font-medium tabular-nums">{first.toLocaleString()}</span>–
        <span className="font-medium tabular-nums">{last.toLocaleString()}</span> of{' '}
        <span className="font-medium tabular-nums">{totalItems.toLocaleString()}</span> {noun}
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-[var(--color-content-muted)]">Rows</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value) as PageSize)}
            className="h-8 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-sm"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        {totalPages > 1 ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPage((p) => p - 1)}
              className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="tabular-nums text-[var(--color-content-subtle)]">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPage((p) => p + 1)}
              className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
