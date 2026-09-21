import { PERMISSIONS } from '@techpioasset/domain';

/**
 * The phone's menu, as categories of cards (v2.58).
 *
 * The More tab had grown into one long list of eighteen rows under four loose
 * headings ("Yours", "Capture", "Records", "Account"), and "Records" alone held
 * eleven unrelated things. The categories now follow the web sidebar - My
 * workspace, Assets, Buying & stock, Insights, Administration - so something is
 * found in the same place on both, with capture and people split out because on
 * a phone those are jobs of their own.
 *
 * Pure data and filtering, so the permission rules are tested without a device.
 * Icons are Ionicons names; tones are keys the screen maps to colours.
 */

export type MenuTone = 'blue' | 'teal' | 'indigo' | 'amber' | 'violet' | 'green' | 'slate';

export interface MenuItem {
  icon: string;
  label: string;
  description: string;
  href: string;
  /** Visible when the user holds ANY of these. Absent = everyone. */
  anyOf?: readonly string[];
  /**
   * Visible only to a user holding ANY of these ROLES (v2.59). For the few
   * screens gated on a role rather than a permission - the expense report is
   * Super Admin only because no permission is exclusive to Super Admin.
   * Checked in addition to anyOf.
   */
  roles?: readonly string[];
}

export interface MenuGroup {
  id: string;
  title: string;
  description: string;
  icon: string;
  tone: MenuTone;
  items: readonly MenuItem[];
}

const P = PERMISSIONS;

export const MENU_GROUPS: readonly MenuGroup[] = [
  {
    id: 'workspace',
    title: 'My workspace',
    description: 'Your kit, requests and alerts',
    icon: 'person-circle-outline',
    tone: 'blue',
    items: [
      {
        icon: 'notifications-outline',
        label: 'Notifications',
        description: 'Everything sent to you',
        href: '/notifications',
      },
      {
        icon: 'checkmark-done-outline',
        label: 'Awaiting me',
        description: 'Requests waiting on you',
        href: '/(tabs)/approvals',
        anyOf: [P.REQUESTS_APPROVE, P.REQUESTS_ASSESS],
      },
      {
        icon: 'document-text-outline',
        label: 'Requests',
        description: 'Raise and follow requests',
        href: '/(tabs)/requests',
        anyOf: [P.REQUESTS_READ],
      },
      {
        icon: 'laptop-outline',
        label: 'My equipment',
        description: 'What is issued to you',
        href: '/my-equipment',
        anyOf: [P.ASSETS_READ],
      },
      {
        icon: 'ribbon-outline',
        label: 'My licences',
        description: 'Software seats you hold',
        href: '/my-licenses',
        anyOf: [P.LICENSES_READ],
      },
      // A supplier's own contact details; a supplier is usually out, and a
      // phone number is what goes stale.
      {
        icon: 'business-outline',
        label: 'Your company details',
        description: 'How buyers reach you',
        href: '/vendor-company',
        anyOf: [P.VENDOR_PORTAL_ACCESS],
      },
    ],
  },
  {
    id: 'capture',
    title: 'Scan & capture',
    description: 'Camera jobs in the field',
    icon: 'scan-outline',
    tone: 'teal',
    items: [
      {
        icon: 'qr-code-outline',
        label: 'Scan a code',
        description: 'Open an asset from its label',
        href: '/(tabs)/scan',
        anyOf: [P.ASSETS_READ],
      },
      {
        icon: 'receipt-outline',
        label: 'Capture bill',
        description: 'Photograph an invoice',
        href: '/(tabs)/capture',
        anyOf: [P.INVOICES_UPLOAD],
      },
      {
        icon: 'clipboard-outline',
        label: 'Inventory count',
        description: 'Count stock, even offline',
        href: '/(tabs)/inventory',
        anyOf: [P.INVENTORY_ADJUST],
      },
    ],
  },
  {
    id: 'assets',
    title: 'Assets & service',
    description: 'Equipment, licences, repairs',
    icon: 'cube-outline',
    tone: 'indigo',
    items: [
      {
        icon: 'cube-outline',
        label: 'Assets',
        description: 'Every device and item',
        href: '/(tabs)/assets',
        anyOf: [P.ASSETS_READ],
      },
      {
        icon: 'add-circle-outline',
        label: 'Register asset',
        description: 'Add a new device',
        href: '/asset/new',
        anyOf: [P.ASSETS_CREATE],
      },
      // 0.3.31 - for the people who walk the floor, and the auditor who reads
      // their work. Not for an employee: a "round" of one's own laptop is noise.
      {
        icon: 'shield-checkmark-outline',
        label: 'Verification round',
        description: 'Assets physically seen this quarter',
        href: '/verification',
        anyOf: [P.AUDIT_READ, P.ASSETS_UPDATE, P.ASSETS_ASSIGN, P.ASSETS_RETURN],
      },
      {
        icon: 'key-outline',
        label: 'Licences',
        description: 'Software and seats',
        href: '/licenses',
        anyOf: [P.LICENSES_READ],
      },
      {
        icon: 'construct-outline',
        label: 'Maintenance',
        description: 'All work orders',
        href: '/maintenance',
        anyOf: [P.MAINTENANCE_READ],
      },
      {
        icon: 'build-outline',
        label: 'My work orders',
        description: 'Jobs assigned to you',
        href: '/work-orders',
        anyOf: [P.MAINTENANCE_MANAGE],
      },
    ],
  },
  {
    id: 'buying',
    title: 'Buying & stock',
    description: 'Catalogue, orders, invoices',
    icon: 'cart-outline',
    tone: 'amber',
    items: [
      {
        icon: 'pricetags-outline',
        label: 'Catalogue',
        description: 'Supplier offers',
        href: '/(tabs)/catalogue',
        anyOf: [P.VENDOR_PRODUCTS_READ],
      },
      {
        icon: 'cube-outline',
        label: 'Receive orders',
        description: 'Book in delivered goods',
        href: '/purchase-orders',
        anyOf: [P.PROCUREMENT_RECEIVE],
      },
      {
        icon: 'layers-outline',
        label: 'Stock',
        description: 'Levels, new items, add stock',
        href: '/stock',
        anyOf: [P.INVENTORY_READ],
      },
      {
        icon: 'document-attach-outline',
        label: 'Invoices',
        description: 'Bills, matching, approval',
        href: '/invoices',
        anyOf: [P.INVOICES_READ],
      },
    ],
  },
  {
    id: 'people',
    title: 'People',
    description: 'Colleagues and invitations',
    icon: 'people-outline',
    tone: 'violet',
    items: [
      {
        icon: 'people-outline',
        label: 'People',
        description: 'Directory and access',
        href: '/people',
        anyOf: [P.USERS_READ],
      },
      {
        icon: 'mail-unread-outline',
        label: 'Pending invitations',
        description: 'Not signed in yet',
        href: '/people-invitations',
        anyOf: [P.USERS_MANAGE],
      },
      // v2.68 - vendor sign-ins, out of People and under an entry of their own.
      {
        icon: 'storefront-outline',
        label: 'Vendor accounts',
        description: 'Sign-ins that belong to vendors',
        href: '/people?audience=vendors',
        anyOf: [P.USERS_MANAGE],
      },
    ],
  },
  {
    id: 'insights',
    title: 'Insights',
    description: 'Numbers and the audit trail',
    icon: 'stats-chart-outline',
    tone: 'green',
    items: [
      {
        icon: 'stats-chart-outline',
        label: 'Analytics',
        description: 'Fleet, spend and health',
        href: '/analytics',
        anyOf: [P.ANALYTICS_READ],
      },
      {
        icon: 'bar-chart-outline',
        label: 'Reports',
        description: 'Status summaries',
        href: '/reports',
        anyOf: [P.REPORTS_READ],
      },
      // Money for the whole company, so Super Admin only - the API refuses
      // everyone else on the role, and the menu never offers it to them.
      {
        icon: 'cash-outline',
        label: 'Expenses',
        description: 'Spend by month and type',
        href: '/expenses',
        roles: ['SUPER_ADMIN'],
      },
      {
        icon: 'time-outline',
        label: 'Audit log',
        description: 'Who changed what',
        href: '/audit',
        anyOf: [P.AUDIT_READ],
      },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Company, security, help',
    icon: 'settings-outline',
    tone: 'slate',
    items: [
      {
        icon: 'person-circle-outline',
        label: 'Profile',
        description: 'Your details',
        href: '/(tabs)/profile',
      },
      {
        icon: 'shield-checkmark-outline',
        label: 'Security',
        description: 'Password, two-factor',
        href: '/settings/security',
      },
      {
        icon: 'color-palette-outline',
        label: 'Appearance',
        description: 'Light or dark',
        href: '/settings/appearance',
      },
      {
        icon: 'business-outline',
        label: 'Organisation',
        description: 'Company-wide settings',
        href: '/settings/organisation',
        anyOf: [P.SETTINGS_MANAGE],
      },
      {
        icon: 'location-outline',
        label: 'Offices',
        description: 'Sites kit belongs to',
        href: '/settings/offices',
        anyOf: [P.SETTINGS_MANAGE],
      },
      {
        icon: 'git-network-outline',
        label: 'Departments',
        description: 'Teams people belong to',
        href: '/settings/departments',
        anyOf: [P.SETTINGS_MANAGE],
      },
      {
        icon: 'sparkles-outline',
        label: 'AI settings',
        description: 'Document processing rules',
        href: '/settings/ai',
        anyOf: [P.AI_CONFIGURE],
      },
      {
        icon: 'help-circle-outline',
        label: 'Help',
        description: 'Guides and how-tos',
        href: '/help',
      },
    ],
  },
];

export function canSee(
  item: MenuItem,
  permissions: readonly string[],
  roles: readonly string[] = [],
): boolean {
  return (
    (!item.anyOf || item.anyOf.some((p) => permissions.includes(p))) &&
    (!item.roles || item.roles.some((r) => roles.includes(r)))
  );
}

/**
 * Categories with at least one item this user may open, each trimmed to those items.
 * `roles` defaults to none, so a caller that forgets it hides role-gated items
 * rather than showing them.
 */
export function visibleMenu(permissions: readonly string[], roles: readonly string[] = []): MenuGroup[] {
  return MENU_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => canSee(i, permissions, roles)),
  })).filter((g) => g.items.length > 0);
}

export function findMenuGroup(
  id: string,
  permissions: readonly string[],
  roles: readonly string[] = [],
): MenuGroup | null {
  return visibleMenu(permissions, roles).find((g) => g.id === id) ?? null;
}

/**
 * Every visible item whose label, description or category matches, each once.
 * Items reachable from two places (none today) would otherwise repeat.
 */
export function searchMenu(
  query: string,
  permissions: readonly string[],
  roles: readonly string[] = [],
): { item: MenuItem; group: MenuGroup }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const seen = new Set<string>();
  const out: { item: MenuItem; group: MenuGroup }[] = [];
  for (const group of visibleMenu(permissions, roles)) {
    for (const item of group.items) {
      const haystack = `${item.label} ${item.description} ${group.title}`.toLowerCase();
      if (haystack.includes(q) && !seen.has(item.href)) {
        seen.add(item.href);
        out.push({ item, group });
      }
    }
  }
  return out;
}
