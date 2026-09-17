'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, MoreHorizontal, type LucideIcon } from 'lucide-react';

/**
 * The "More actions" menu on the asset page (v2.61).
 *
 * Everything that used to be its own button in the title row - receipt, edit,
 * the holder's ticket doors, the jumps to price, transfer and disposal - lives
 * here now, in groups, so the page keeps one primary action (Report damage)
 * in view. A link item is a real <Link>, a button item runs its handler and
 * the menu closes by itself.
 */

export interface MenuAction {
  label: string;
  icon?: LucideIcon;
  /** A navigation - rendered as a link so middle-click and copy-address work. */
  href?: string;
  /** An in-page action - a tab switch or a scroll. */
  onClick?: () => void;
  danger?: boolean;
}

export interface MenuGroup {
  /** A small heading over the group; omit for the first, ungrouped set. */
  title?: string;
  items: MenuAction[];
}

export function MoreActionsMenu({
  groups,
  label = 'More actions',
}: {
  groups: MenuGroup[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const visible = groups.filter((g) => g.items.length > 0);
  if (visible.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
      >
        <MoreHorizontal aria-hidden="true" className="size-4" />
        {label}
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </button>
      {open ? (
        <>
          {/* Click-away layer under the menu. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 w-64 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] py-1 shadow-lg"
          >
            {visible.map((group, gi) => (
              <Fragment key={group.title ?? gi}>
                {gi > 0 ? <div className="my-1 border-t border-[var(--color-border)]" /> : null}
                {group.title ? (
                  <p className="px-3 pb-1 pt-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                    {group.title}
                  </p>
                ) : null}
                {group.items.map((item) => {
                  const cls = `flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-sunken)] ${
                    item.danger ? 'text-[var(--tone-critical-fg)]' : ''
                  }`;
                  const Icon = item.icon;
                  const inner = (
                    <>
                      {Icon ? (
                        <Icon
                          aria-hidden="true"
                          className="size-4 text-[var(--color-content-subtle)]"
                        />
                      ) : null}
                      {item.label}
                    </>
                  );
                  // No onClick-close on links: hiding the menu re-renders and
                  // can unmount the link before Next follows it. The route
                  // change unmounts the page, and the menu with it.
                  return item.href ? (
                    <Link key={item.label} role="menuitem" href={item.href} className={cls}>
                      {inner}
                    </Link>
                  ) : (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      className={cls}
                      onClick={() => {
                        setOpen(false);
                        item.onClick?.();
                      }}
                    >
                      {inner}
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
