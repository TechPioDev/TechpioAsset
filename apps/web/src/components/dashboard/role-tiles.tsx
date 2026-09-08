'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Boxes,
  CalendarClock,
  ClipboardList,
  Layers,
  PackageX,
  ShieldAlert,
  UserCheck,
  Wrench,
  KeyRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { Card, ErrorState, Skeleton } from '@/components/ui';

type Tone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';
interface Tile {
  key: string;
  label: string;
  value: number;
  href: string;
  icon: string;
  tone: Tone;
}

/**
 * Icons the dashboard summary emits, kept explicit for tree-shaking.
 *
 * Every name dashboard.service.ts can send must appear here. A missing one is
 * not an error, it silently falls back to Layers - which is how two different
 * tiles ended up wearing the same glyph and looking like a rendering bug. The
 * test beside this file reads the service and fails if a name is missing.
 */
export const TILE_ICONS: Record<string, LucideIcon> = {
  Boxes,
  KeyRound,
  ClipboardList,
  UserCheck,
  Layers,
  ShieldAlert,
  Wrench,
  CalendarClock,
  PackageX,
};

/**
 * v2.2 Workstream F — role-based KPI tiles. The server returns only the tiles the
 * actor may see (gated by permission + scope), so an Employee gets a couple and a
 * manager/IT lead gets several — the same component renders every role.
 */
export function RoleTiles() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiFetch<{ tiles: Tile[] }>('/dashboard'),
  });

  if (isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-[var(--radius-card)]" />
        ))}
      </div>
    );
  }
  if (isError)
    return <ErrorState title="Could not load your dashboard" detail={(error as Error).message} />;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {data.tiles.map((tile) => {
        const Icon = TILE_ICONS[tile.icon] ?? Layers;
        return (
          <Link key={tile.key} href={tile.href} className="group">
            <Card className="flex h-full items-center gap-3 transition-colors group-hover:bg-[var(--color-surface-sunken)]">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-control)]"
                style={{
                  color: `var(--tone-${tile.tone}-fg)`,
                  backgroundColor: `var(--tone-${tile.tone}-bg)`,
                }}
              >
                <Icon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-2xl font-semibold tabular-nums leading-none">
                  {tile.value.toLocaleString()}
                </span>
                <span className="mt-1 block truncate text-xs text-[var(--color-content-muted)]">
                  {tile.label}
                </span>
              </span>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
