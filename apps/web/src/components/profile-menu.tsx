'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Award,
  Bell,
  ClipboardList,
  LogOut,
  Package,
  Palette,
  ShieldCheck,
  User,
  UserCircle2,
} from 'lucide-react';
import type { AuthUser } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { useAuth } from '@/providers/auth-provider';
import { AuthAvatar } from '@/components/auth-avatar';
import { cn } from '@/lib/cn';

/** Initials fallback when no photo is set (spec section 2). */
function initials(user: AuthUser): string {
  const first = user.firstName?.[0] ?? '';
  const last = user.lastName?.[0] ?? '';
  const derived = `${first}${last}`.trim();
  return derived || user.email[0]?.toUpperCase() || '?';
}

const ITEMS: { href: string; label: string; Icon: typeof User; permission?: string }[] = [
  { href: '/profile', label: 'View profile', Icon: User },
  { href: '/my-assets', label: 'My assets', Icon: Package },
  // Gated as the sidebar and the phone gate it.
  { href: '/my-licenses', label: 'My licences', Icon: Award, permission: PERMISSIONS.LICENSES_READ },
  { href: '/my-requests', label: 'My requests', Icon: ClipboardList },
  { href: '/settings/notifications', label: 'Notification settings', Icon: Bell },
  { href: '/settings/appearance', label: 'Appearance settings', Icon: Palette },
  { href: '/settings/security', label: 'Security settings', Icon: ShieldCheck },
];

export function ProfileMenu() {
  const { user, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on outside click and on Escape, and return focus to the trigger so
  // keyboard users are not stranded at the top of the document.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.displayName ?? user.email}`}
        onClick={() => setOpen((v) => !v)}
        className="grid size-9 place-items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] text-sm font-semibold hover:bg-[var(--color-surface-sunken)]"
      >
        <AuthAvatar
          enabled={Boolean(user.avatarUrl)}
          version={user.avatarUrl ?? ''}
          className="size-9 rounded-full object-cover"
        >
          {initials(user) === '?' ? (
            <UserCircle2 aria-hidden="true" className="size-5" />
          ) : (
            <span aria-hidden="true">{initials(user)}</span>
          )}
        </AuthAvatar>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] shadow-lg"
        >
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <p className="truncate text-sm font-medium">{user.displayName ?? user.email}</p>
            <p className="truncate text-xs text-[var(--color-content-subtle)]">{user.email}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {user.roleNames.map((role) => (
                <span
                  key={role}
                  className="rounded-full border px-2 py-0.5 text-[11px]"
                  style={{
                    color: 'var(--tone-info-fg)',
                    backgroundColor: 'var(--tone-info-bg)',
                    borderColor: 'var(--tone-info-border)',
                  }}
                >
                  {role}
                </span>
              ))}
            </div>
            {user.departmentName ? (
              <p className="mt-2 text-xs text-[var(--color-content-subtle)]">
                {user.departmentName}
                {user.officeName ? ` · ${user.officeName}` : ''}
              </p>
            ) : null}
          </div>

          <nav className="py-1">
            {ITEMS.filter((item) => !item.permission || can(item.permission)).map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-[var(--color-surface-sunken)]"
              >
                <Icon aria-hidden="true" className="size-4 text-[var(--color-content-subtle)]" />
                {label}
              </Link>
            ))}
          </nav>

          <div className="border-t border-[var(--color-border)] py-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void logout();
              }}
              className={cn(
                'flex w-full items-center gap-2.5 px-4 py-2 text-sm',
                'hover:bg-[var(--color-surface-sunken)]',
              )}
              style={{ color: 'var(--tone-critical-fg)' }}
            >
              <LogOut aria-hidden="true" className="size-4" />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
