'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Sparkles,
  BellRing,
  Building2,
  ChevronRight,
  Boxes,
  CircleHelp,
  ClipboardList,
  Cpu,
  LayoutDashboard,
  LineChart,
  Mail,
  Menu,
  BarChart3,
  Package,
  PanelLeftClose,
  Plug,
  PanelLeftOpen,
  Radar,
  Receipt,
  ListChecks,
  ShoppingBag,
  ShoppingCart,
  ScrollText,
  KeyRound,
  Search,
  ShieldCheck,
  Network,
  GitBranch,
  Users,
  Wrench,
  X,
  Store,
} from 'lucide-react';
import { Wallet } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { useAuth } from '@/providers/auth-provider';
import { cn } from '@/lib/cn';
import { ProfileMenu } from './profile-menu';
import { NotificationBell } from './notification-bell';
import { ThemeToggle } from './theme-toggle';
import { RouteGuard, canViewRoute } from './route-guard';
import { BrandLockup, BrandMark } from '@/components/brand';

interface NavItem {
  href: string;
  label: string;
  Icon: typeof LayoutDashboard;
  /** Hidden unless the user holds this. The API enforces it regardless. */
  permission?: string;
  /** Operator console entries: shown only to PLATFORM_ADMIN_EMAILS accounts. */
  platformOnly?: boolean;
  /** Hidden from OWN-scope users (employees): the page would only mirror
   * their personal view, and least privilege says they should not be shown
   * company-shaped modules at all. The API stays scoped regardless. */
  ownScopeHidden?: boolean;
}

interface NavGroup {
  /** Stable key — persisted, so renaming the label must not reset anybody. */
  key: string;
  label: string;
  items: NavItem[];
}

/**
 * Always visible, never inside a group: the place people go back to.
 */
const NAV_TOP: NavItem[] = [{ href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard }];

/**
 * The rest of the menu, grouped and COLLAPSED BY DEFAULT.
 *
 * Eighteen flat entries made the sidebar a wall of similar-looking words, and
 * the ones people use daily sat next to ones they open twice a year. Grouping
 * them puts the whole map on one screen; collapsing them by default means the
 * common case is short.
 *
 * Two behaviours make that survivable rather than annoying, and both matter:
 * the group holding the current page opens itself, so you can always see where
 * you are; and whatever you open by hand is remembered, so somebody who lives
 * in Procurement is not re-opening it every morning.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    key: 'workspace',
    label: 'My workspace',
    items: [
      { href: '/my-assets', label: 'My assets', Icon: Package },
      { href: '/requests', label: 'Requests', Icon: ClipboardList },
    ],
  },
  {
    key: 'assets',
    label: 'Assets',
    items: [
      {
        href: '/assets',
        label: 'Assets',
        Icon: Boxes,
        permission: PERMISSIONS.ASSETS_READ,
        ownScopeHidden: true,
      },
      { href: '/licenses', label: 'Licenses', Icon: KeyRound, permission: PERMISSIONS.LICENSES_READ },
      {
        href: '/maintenance',
        label: 'Maintenance',
        Icon: Wrench,
        permission: PERMISSIONS.MAINTENANCE_READ,
      },
      { href: '/discovery', label: 'Discovery', Icon: Radar, permission: PERMISSIONS.DISCOVERY_READ },
    ],
  },
  {
    key: 'buying',
    label: 'Buying & stock',
    items: [
      {
        href: '/catalogue',
        label: 'Catalogue',
        Icon: ShoppingBag,
        // Suppliers hold this too: it is the one page a vendor account needs,
        // and the API shows it only its own offers.
        permission: PERMISSIONS.VENDOR_PRODUCTS_READ,
        ownScopeHidden: true,
      },
      {
        href: '/procurement',
        label: 'Procurement',
        Icon: ShoppingCart,
        permission: PERMISSIONS.PROCUREMENT_PR_READ,
        ownScopeHidden: true,
      },
      { href: '/inventory', label: 'Inventory', Icon: Boxes, permission: PERMISSIONS.INVENTORY_READ },
      // v2.9 C2: a budget is a money figure, so it follows the cost-read rule.
      { href: '/budgets', label: 'Budgets', Icon: Wallet, permission: PERMISSIONS.ASSETS_COST_READ },
      { href: '/invoices', label: 'Invoices', Icon: Receipt, permission: PERMISSIONS.INVOICES_READ },
    ],
  },
  {
    key: 'insights',
    label: 'Insights',
    items: [
      { href: '/analytics', label: 'Analytics', Icon: LineChart, permission: PERMISSIONS.ANALYTICS_READ },
      { href: '/reports', label: 'Reports', Icon: BarChart3, permission: PERMISSIONS.REPORTS_READ },
      { href: '/audit', label: 'Audit log', Icon: ScrollText, permission: PERMISSIONS.AUDIT_READ },
    ],
  },
  {
    key: 'admin',
    label: 'Administration',
    items: [
      { href: '/people', label: 'People', Icon: Users, permission: PERMISSIONS.EMPLOYEES_READ },
      {
        href: '/settings/offices',
        label: 'Offices',
        Icon: Building2,
        permission: PERMISSIONS.SETTINGS_MANAGE,
      },
      {
        href: '/settings/departments',
        label: 'Departments',
        Icon: Network,
        permission: PERMISSIONS.SETTINGS_MANAGE,
      },
      {
        href: '/settings/vendors',
        label: 'Vendors',
        Icon: Store,
        permission: PERMISSIONS.VENDORS_MANAGE,
      },
      {
        href: '/settings/spec-templates',
        label: 'Spec templates',
        Icon: ListChecks,
        permission: PERMISSIONS.VENDOR_PRODUCTS_REVIEW,
      },
      { href: '/settings/roles', label: 'Roles', Icon: ShieldCheck, permission: PERMISSIONS.ROLES_MANAGE },
      {
        href: '/settings/workflows',
        label: 'Approval workflows',
        Icon: GitBranch,
        permission: PERMISSIONS.WORKFLOWS_CONFIGURE,
      },
      {
        href: '/settings/integrations',
        label: 'Integrations',
        Icon: Plug,
        permission: PERMISSIONS.INTEGRATIONS_MANAGE,
      },
      { href: '/settings/ai', label: 'AI settings', Icon: Cpu, permission: PERMISSIONS.AI_CONFIGURE },
      {
        href: '/settings/notifications',
        label: 'Notifications',
        Icon: BellRing,
        permission: PERMISSIONS.SETTINGS_MANAGE,
      },
      {
        href: '/settings/organisation',
        label: 'Organisation',
        Icon: Building2,
        permission: PERMISSIONS.SETTINGS_MANAGE,
      },
      // Operator console - platform plane, not tenant administration.
      { href: '/platform/mail', label: 'Email (SMTP)', Icon: Mail, platformOnly: true },
      { href: '/platform/ai', label: 'AI provider', Icon: Sparkles, platformOnly: true },
      { href: '/platform/tenants', label: 'Tenants', Icon: Boxes, platformOnly: true },
    ],
  },
];

const OPEN_GROUPS_KEY = 'techpioasset:nav:open-groups';

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, status, can, impersonating, stopImpersonating } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Accordion: at most ONE group is open at a time, so the menu never grows
  // past a screenful and the page you are on is never pushed below the fold.
  // `undefined` means "not chosen yet" and falls back to the group holding the
  // current page; `null` means the user deliberately closed everything.
  //
  // Undefined on first render on purpose: it matches the server's HTML; the
  // stored choice is restored after mount, below.
  const [openGroup, setOpenGroup] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(OPEN_GROUPS_KEY);
      if (!stored) return;
      const parsed: unknown = JSON.parse(stored);
      // Two older formats existed - an array of open keys, then a per-group
      // map. Both could hold several open groups; take the first as the one.
      if (typeof parsed === 'string') {
        setOpenGroup(parsed);
      } else if (Array.isArray(parsed)) {
        setOpenGroup((parsed as string[])[0] ?? null);
      } else if (parsed && typeof parsed === 'object') {
        const firstOpen = Object.entries(parsed as Record<string, boolean>).find(([, v]) => v);
        setOpenGroup(firstOpen ? firstOpen[0] : null);
      }
    } catch {
      // A corrupt or unavailable localStorage is not worth breaking a menu over.
    }
  }, []);

  const setGroupOpen = (key: string, open: boolean) => {
    const next = open ? key : null;
    setOpenGroup(next);
    try {
      window.localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(next));
    } catch {
      // Persisting is a nicety; the menu still works without it.
    }
  };

  // Navigating INTO a group opens it and closes whatever else was open, so the
  // menu always reflects where you actually are.
  useEffect(() => {
    const holding = NAV_GROUPS.find((g) => g.items.some((i) => isActive(pathname, i.href)));
    if (!holding) return;
    setOpenGroup((prev) => (prev === holding.key ? prev : holding.key));
    try {
      window.localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(holding.key));
    } catch {
      /* best effort */
    }
  }, [pathname]);

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  // Navigating on mobile should dismiss the drawer, otherwise it covers the page
  // the user just asked for.
  useEffect(() => setDrawerOpen(false), [pathname]);

  if (status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center">
        <p className="text-sm text-[var(--color-content-subtle)]">Loading…</p>
      </div>
    );
  }
  if (!user) return null;

  // Menu visibility is a convenience, never the control: every route below is
  // independently enforced by the API (spec section 20).
  const ownScope = user.scope === 'OWN';

  const allowed = (items: NavItem[]) =>
    items.filter(
      (i) =>
        (!i.permission || can(i.permission)) &&
        (!i.platformOnly || user?.platformAdmin) &&
        (!i.ownScopeHidden || user?.scope !== 'OWN'),
    );

  // A group with nothing the user may see is not a group with an empty drawer —
  // it simply is not there.
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: allowed(g.items) })).filter(
    (g) => g.items.length > 0,
  );

  const link = ({ href, label, Icon }: NavItem) => {
    const active = isActive(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? label : undefined}
        className={cn(
          'flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm transition-colors',
          active
            ? 'bg-[var(--color-surface-sunken)] font-medium'
            : 'text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]',
        )}
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span className={cn(collapsed && 'lg:sr-only')}>{label}</span>
      </Link>
    );
  };

  // Icon-only rail: there is no room for a heading, and a collapsed group inside
  // a collapsed sidebar would hide everything behind two clicks. Show the icons.
  const railNav = (
    <nav className="grid gap-0.5 p-2" aria-label="Main">
      {[...allowed(NAV_TOP), ...groups.flatMap((g) => g.items)].map(link)}
    </nav>
  );

  const groupedNav = (
    <nav className="grid gap-0.5 p-2" aria-label="Main">
      {allowed(NAV_TOP).map(link)}

      {groups.map((group) => {
        // The section holding the current page opens itself. Without this, one
        // click through the menu would close the menu around you and there
        // would be nothing on screen saying where you are.
        const holdsCurrentPage = group.items.some((i) => isActive(pathname, i.href));
        const open = openGroup === undefined ? holdsCurrentPage : openGroup === group.key;
        const panelId = `nav-group-${group.key}`;
        return (
          <div key={group.key} className="mt-1">
            <button
              type="button"
              onClick={() => setGroupOpen(group.key, !open)}
              aria-expanded={open}
              aria-controls={panelId}
              className={cn(
                'flex w-full items-center gap-2 rounded-[var(--radius-control)] px-3 py-2',
                'text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors',
                'text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)]',
              )}
            >
              <ChevronRight
                aria-hidden="true"
                className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
              />
              <span className="flex-1 text-left">{group.label}</span>
            </button>

            {open ? (
              <div id={panelId} className="grid gap-0.5">
                {group.items.map(link)}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );

  const nav = collapsed ? railNav : groupedNav;

  return (
    <div className="min-h-screen">
      {/* Bypass blocks (WCAG 2.4.1): the first Tab lands here so a keyboard user
          can jump past the header and nav straight to the page content. Visually
          hidden until focused. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-[var(--radius-control)] focus:bg-[var(--color-brand)] focus:px-3 focus:py-2 focus:text-sm focus:text-[var(--color-brand-contrast)]"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 lg:px-4">
        <button
          type="button"
          aria-label="Open navigation"
          onClick={() => setDrawerOpen(true)}
          className="grid size-9 place-items-center rounded-[var(--radius-control)] hover:bg-[var(--color-surface-sunken)] lg:hidden"
        >
          <Menu aria-hidden="true" className="size-5" />
        </button>

        {/* The wordmark needs ~140px it cannot have next to the search field on a
            phone, so the square mark stands in below sm. */}
        <Link href="/dashboard" className="inline-flex shrink-0 items-center" aria-label="PioAssets home">
          <BrandMark size={26} className="sm:hidden" />
          <BrandLockup height={26} className="hidden sm:inline-flex" />
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative hidden sm:block">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--color-content-subtle)]"
            />
            <input
              type="search"
              aria-label={ownScope ? 'Search my assets' : 'Search assets'}
              placeholder="Search…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const value = (e.target as HTMLInputElement).value.trim();
                  // The destination has to be a page the user may actually
                  // open. OWN-scope users cannot see /assets (the route guard
                  // sends them to the dashboard), so searching there bounced
                  // them straight back and the box looked broken. Their search
                  // belongs on their own equipment.
                  if (value)
                    router.push(
                      ownScope
                        ? `/my-assets?q=${encodeURIComponent(value)}`
                        : `/assets?q=${encodeURIComponent(value)}`,
                    );
                }
              }}
              className="h-9 w-44 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] pl-8 text-sm md:w-60"
            />
          </div>
          <NotificationBell />
          <ThemeToggle />
          <Link
            href="/help"
            aria-label="Help"
            className="grid size-9 place-items-center rounded-[var(--radius-control)] hover:bg-[var(--color-surface-sunken)]"
          >
            <CircleHelp aria-hidden="true" className="size-5" />
          </Link>
          <ProfileMenu />
        </div>
      </header>

      <div className="flex">
        <aside
          className={cn(
            'sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 border-r border-[var(--color-border)] lg:block',
            collapsed ? 'w-16' : 'w-60',
          )}
        >
          {nav}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="mx-2 mt-1 flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)]"
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" className="size-4" />
            ) : (
              <PanelLeftClose aria-hidden="true" className="size-4" />
            )}
            <span className={cn(collapsed && 'sr-only')}>Collapse</span>
          </button>
        </aside>

        {drawerOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setDrawerOpen(false)}
              className="absolute inset-0 bg-black/40"
            />
            <div className="relative h-full w-64 border-r border-[var(--color-border)] bg-[var(--color-surface)]">
              <div className="flex h-14 items-center justify-between px-3">
                <span className="font-semibold">Menu</span>
                <button
                  type="button"
                  aria-label="Close navigation"
                  onClick={() => setDrawerOpen(false)}
                  className="grid size-9 place-items-center rounded-[var(--radius-control)] hover:bg-[var(--color-surface-sunken)]"
                >
                  <X aria-hidden="true" className="size-5" />
                </button>
              </div>
              {nav}
            </div>
          </div>
        ) : null}

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 lg:px-6">
          {impersonating ? (
            <div
              role="status"
              className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] border px-4 py-2.5 text-sm"
              style={{
                color: 'var(--tone-warning-fg)',
                backgroundColor: 'var(--tone-warning-bg)',
                borderColor: 'var(--tone-warning-border)',
              }}
            >
              <span>
                Viewing as <span className="font-semibold">{user.displayName ?? user.email}</span>{' '}
                — you are {impersonating.adminName}. This session ends by itself within 15 minutes.
              </span>
              <button
                type="button"
                onClick={() => void stopImpersonating()}
                className="rounded-[var(--radius-control)] border border-current px-2.5 py-1 text-xs font-semibold"
              >
                Return to my account
              </button>
            </div>
          ) : null}
          {/* A page the user may not view never paints: the guard redirects to
              the dashboard and we render nothing here in the meantime. */}
          <RouteGuard user={user} can={can} />
          {canViewRoute(pathname, user, (p) => can(p)) ? children : null}
        </main>
      </div>
    </div>
  );
}
