'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Award,
  BookOpen,
  CircleHelp,
  FileText,
  LifeBuoy,
  Plus,
  Search,
  Settings,
  Smartphone,
  UserRound,
  Users,
} from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { Card } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { apiFetch } from '@/lib/api-client';

/**
 * Help. The question mark in the header linked here without the page existing,
 * so every user who pressed it landed on a 404 — the same gap /settings/appearance
 * had.
 *
 * What it is not: a copy of the user guide. The guide is a PDF and is linked
 * once. What people actually need from a help button mid-task is "where is the
 * thing I am looking for", so the page leads with routes, and shows only the
 * ones this account may actually open — an employee who cannot see /people is
 * not helped by being told to go there.
 */

interface Shortcut {
  href: string;
  label: string;
  detail: string;
  Icon: typeof CircleHelp;
  /** Omitted = everyone sees it. */
  permission?: string;
}

const YOURS: Shortcut[] = [
  {
    href: '/my-assets',
    label: 'My equipment',
    detail: 'Everything issued to you, with serial numbers and who signed it out.',
    Icon: UserRound,
  },
  {
    href: '/my-licenses',
    label: 'My licences',
    detail: 'The software seats issued to you, and when each one expires.',
    Icon: Award,
    permission: PERMISSIONS.LICENSES_READ,
  },
  {
    href: '/my-requests',
    label: 'My requests',
    detail: 'What you have asked for, and where each one has got to.',
    Icon: FileText,
  },
  {
    href: '/profile',
    label: 'Profile and security',
    detail: 'Change your password, set up two-factor, review your sessions.',
    Icon: Settings,
  },
];

const MANAGING: Shortcut[] = [
  {
    href: '/assets/new',
    label: 'Register an asset',
    detail: 'Add a device, choose its type, record serial or IMEI, assign it.',
    Icon: Plus,
    permission: PERMISSIONS.ASSETS_CREATE,
  },
  {
    href: '/people',
    label: 'People',
    detail: 'Who works here, what they hold, and what they can do in PioAssets.',
    Icon: Users,
    permission: PERMISSIONS.EMPLOYEES_READ,
  },
  {
    href: '/settings/organisation',
    label: 'Settings',
    detail: 'Company details, offices, departments, roles, notifications.',
    Icon: Settings,
    permission: PERMISSIONS.SETTINGS_MANAGE,
  },
];

function ShortcutList({ items }: { items: Shortcut[] }) {
  return (
    <ul className="grid gap-1">
      {items.map(({ href, label, detail, Icon }) => (
        <li key={href}>
          <Link
            href={href}
            className="flex items-start gap-3 rounded-[var(--radius-control)] p-3 transition-colors hover:bg-[var(--color-surface-sunken)]"
          >
            <span className="mt-0.5 grid size-8 flex-none place-items-center rounded-lg bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]">
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-[var(--color-content-subtle)]">{detail}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function HelpPage() {
  const { can } = useAuth();

  // The same answer the server enforces with, so this page never invites
  // someone to raise a request their company has switched off for them.
  const raise = useQuery({
    queryKey: ['can-create-request'],
    queryFn: () => apiFetch<{ allowed: boolean; reason?: string }>('/requests/can-create'),
    staleTime: 60_000,
  });

  const managing = MANAGING.filter((item) => !item.permission || can(item.permission));

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <LifeBuoy aria-hidden="true" className="size-5 text-[var(--color-brand)]" /> Help
        </h1>
        <p className="text-sm text-[var(--color-content-muted)]">
          Where things are, and how to get hold of someone when a page cannot help.
        </p>
      </header>

      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold">Your things</h2>
        <ShortcutList items={YOURS.filter((item) => !item.permission || can(item.permission))} />
      </Card>

      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold">Asking for something</h2>
        {raise.isPending ? (
          <p className="p-3 text-sm text-[var(--color-content-muted)]">Checking…</p>
        ) : raise.data?.allowed ? (
          <ShortcutList
            items={[
              {
                href: '/requests/new',
                label: 'Raise a request',
                detail:
                  'Ask for equipment, software or a repair. Say what you need and why, and it goes for approval.',
                Icon: Plus,
              },
            ]}
          />
        ) : (
          <p className="p-3 text-sm text-[var(--color-content-muted)]">
            {raise.data?.reason ??
              'Requests are raised by IT and HR for this company. Contact them and they will raise one for you.'}
          </p>
        )}
      </Card>

      {managing.length > 0 ? (
        <Card className="p-5">
          <h2 className="mb-1 text-sm font-semibold">Managing equipment</h2>
          <ShortcutList items={managing} />
        </Card>
      ) : null}

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold">Guides and apps</h2>
        {/* Plain anchors, not <Link>: the guides are public pages carrying the
            support chat widget, and a client-side hop would load that
            third-party script into the signed-in document, where it would then
            survive the hop back. See components/support-chat.tsx. */}
        <ul className="grid gap-1">
          <li>
            <a
              href="/guides/raising-a-request"
              className="flex items-start gap-3 rounded-[var(--radius-control)] p-3 transition-colors hover:bg-[var(--color-surface-sunken)]"
            >
              <span className="mt-0.5 grid size-8 flex-none place-items-center rounded-lg bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]">
                <FileText aria-hidden="true" className="size-4" />
              </span>
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">Raising a request</span>
                <span className="text-xs text-[var(--color-content-subtle)]">
                  What each type means, who approves it, and what every status is telling you.
                </span>
              </span>
            </a>
          </li>
          <li>
            <a
              href="/guides"
              className="flex items-start gap-3 rounded-[var(--radius-control)] p-3 transition-colors hover:bg-[var(--color-surface-sunken)]"
            >
              <span className="mt-0.5 grid size-8 flex-none place-items-center rounded-lg bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]">
                <BookOpen aria-hidden="true" className="size-4" />
              </span>
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">All guides</span>
                <span className="text-xs text-[var(--color-content-subtle)]">
                  Inviting people, what each role can do, and how assets are added.
                </span>
              </span>
            </a>
          </li>
          <li>
            {/* Served by nginx on the VPS, not from public/ - so this 404s on a
                dev machine and works in production. Same link as the login page. */}
            <a
              href="/downloads/techpioasset.apk"
              className="flex items-start gap-3 rounded-[var(--radius-control)] p-3 transition-colors hover:bg-[var(--color-surface-sunken)]"
            >
              <span className="mt-0.5 grid size-8 flex-none place-items-center rounded-lg bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]">
                <Smartphone aria-hidden="true" className="size-4" />
              </span>
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">Android app</span>
                <span className="text-xs text-[var(--color-content-subtle)]">
                  Scan asset QR codes and answer requests from your phone.
                </span>
              </span>
            </a>
          </li>
        </ul>
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 text-sm font-semibold">Cannot find something?</h2>
        <p className="text-sm text-[var(--color-content-muted)]">
          The search box in the header looks across assets by name, tag and serial number
          <Search aria-hidden="true" className="mx-1 inline size-3.5 align-[-2px]" />— and it
          searches your own equipment when that is all you hold.
        </p>
        <p className="mt-2 text-sm text-[var(--color-content-muted)]">
          Anything it cannot answer — a device that is not listed, an account that needs changing,
          equipment you have handed back — is for your IT or HR team, who administer PioAssets for
          your company.
        </p>
      </Card>
    </div>
  );
}
