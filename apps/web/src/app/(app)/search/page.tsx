'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueries } from '@tanstack/react-query';
import { Box, FileText, Search, User, type LucideIcon } from 'lucide-react';
import {
  searchGroups,
  searchSummary,
  searchTerm,
  SEARCH_MIN_LENGTH,
  type SearchGroupKey,
} from '@techpioasset/domain';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Card, Skeleton } from '@/components/ui';

const GROUP_ICON: Record<SearchGroupKey, LucideIcon> = {
  assets: Box,
  people: User,
  requests: FileText,
};

/** Where a result leads on the web; the domain leaves that to each platform. */
const GROUP_HREF: Record<SearchGroupKey, (id: string) => string> = {
  assets: (id) => `/assets/${id}`,
  people: (id) => `/people/${id}`,
  requests: (id) => `/requests/${id}`,
};

/**
 * Search everything (v2.73): one box for an asset, a person or a request.
 *
 * The header's search box used to open the asset list, so somebody holding a
 * colleague's name or a request number had to know which list to try. This
 * asks the three lists at once (the domain's global-search.ts: each already
 * applies this account's permission and scope, so an employee finds only their
 * own). The term lives in the URL, so a result page can be shared and the Back
 * button returns to it.
 */
function SearchResults() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const urlTerm = params.get('q') ?? '';
  const [text, setText] = useState(urlTerm);

  // The header box navigates here with a new ?q= while this page is open.
  useEffect(() => setText(urlTerm), [urlTerm]);

  // Typing pauses for a moment before the URL - and so the search - changes.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (text.trim() === urlTerm.trim()) return;
      router.replace(text.trim() ? `/search?q=${encodeURIComponent(text.trim())}` : '/search');
    }, 300);
    return () => clearTimeout(timer);
  }, [text, urlTerm, router]);

  const term = searchTerm(urlTerm);
  const groups = searchGroups(user?.permissions ?? []);
  const answers = useQueries({
    queries: groups.map((group) => ({
      queryKey: ['global-search', group.key, term],
      queryFn: () => apiFetch<unknown>(group.path(term ?? '')),
      enabled: Boolean(term),
      staleTime: 30_000,
      retry: false,
    })),
  });

  const rowsOf = (i: number) => (term && answers[i]?.data ? groups[i]!.rows(answers[i]!.data) : []);
  const loading = Boolean(term) && answers.some((a) => a.isPending);
  const total = groups.reduce((n, _g, i) => n + rowsOf(i).length, 0);

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Search</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Finds {groups.map((g) => g.title.toLowerCase()).join(', ') || 'nothing'} you are allowed
          to see.
        </p>
      </header>

      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--color-content-subtle)]"
        />
        <input
          type="search"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Search everything"
          placeholder="Asset, tag, serial, request number or a person’s name…"
          className="h-11 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] pr-3 pl-9 text-sm"
        />
      </div>

      {!term ? (
        <p className="text-sm text-[var(--color-content-muted)]">
          Type at least {SEARCH_MIN_LENGTH} characters.
        </p>
      ) : loading && total === 0 ? (
        <div className="grid gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : (
        <p role="status" className="text-sm text-[var(--color-content-muted)]">
          {searchSummary(total, term)}
        </p>
      )}

      {groups.map((group, i) => {
        const rows = rowsOf(i);
        if (rows.length === 0) return null;
        const Icon = GROUP_ICON[group.key];
        return (
          <section key={group.key} aria-label={group.title}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
              {group.title}
            </h2>
            <Card>
              <ul className="divide-y divide-[var(--color-border)]">
                {rows.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={GROUP_HREF[group.key](row.id)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-surface-sunken)]"
                    >
                      <Icon
                        aria-hidden="true"
                        className="size-4 shrink-0 text-[var(--color-brand)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{row.title}</span>
                        {row.subtitle ? (
                          <span className="block truncate text-xs text-[var(--color-content-muted)]">
                            {row.subtitle}
                          </span>
                        ) : null}
                      </span>
                      {row.badge ? (
                        <span className="shrink-0 rounded-full bg-[var(--color-surface-sunken)] px-2 py-0.5 text-xs text-[var(--color-content-muted)]">
                          {row.badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        );
      })}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <SearchResults />
    </Suspense>
  );
}
