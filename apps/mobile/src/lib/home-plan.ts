import { PERMISSIONS } from '@techpioasset/domain';

/**
 * What the phone puts in front of each kind of person (0.3.30).
 *
 * Until now every account that was not a supplier opened on the same Home -
 * "My assets" - and the same tab bar, whatever they had come to do. An IT
 * technician standing at a desk with a laptop in hand, a manager with three
 * requests waiting on them and a storekeeper doing a count all had to go
 * through Menu to reach their own work. The owner asked for the app to read as
 * built for each role.
 *
 * This decides three things from the account's roles and permissions, and
 * nothing else does:
 *
 *  - the persona: the one job the screen is arranged around;
 *  - Home: up to four quick actions, and the work queues shown under the tiles;
 *  - the tab bar: which five destinations earn a place on it.
 *
 * It only ever ARRANGES. Every action and queue carries the permission its
 * screen already needs, and one the account lacks is dropped - so a custom
 * role, or a persona guessed wrongly, can hide a shortcut but can never show a
 * door the server would refuse. Nothing here touches React Native, so all of it
 * runs under vitest.
 */

const P = PERMISSIONS;

export type Persona =
  | 'vendor'
  | 'admin'
  | 'it'
  | 'stores'
  | 'finance'
  | 'hr'
  | 'auditor'
  | 'approver'
  | 'employee';

/** Tab screens that exist under app/(tabs); `index` and `more` are always on. */
export type TabKey =
  | 'assets'
  | 'requests'
  | 'approvals'
  | 'catalogue'
  | 'scan'
  | 'inventory'
  | 'capture';

export type QueueKey =
  | 'awaiting-me'
  | 'my-work-orders'
  | 'low-stock'
  | 'invoices-to-verify'
  | 'offboarding'
  | 'recent-changes';

export interface QuickAction {
  key: string;
  label: string;
  /** Ionicons name. */
  icon: string;
  href: string;
}

export interface HomePlan {
  persona: Persona;
  /** One line under the greeting: what this screen is arranged around. */
  focus: string;
  quickActions: QuickAction[];
  queues: QueueKey[];
  tabs: TabKey[];
  /** "My assets" leads for an employee and follows the work for everybody else. */
  equipmentFirst: boolean;
}

// ---------------------------------------------------------------------------
// The persona
// ---------------------------------------------------------------------------

/**
 * By role first, because that is how the owner thinks of people; by permission
 * second, so a custom role still lands somewhere sensible. Order matters: an
 * account holding several roles is arranged around the most operational one -
 * somebody who is both IT Manager and a department manager came to the phone to
 * move equipment, and their approvals are still one tab away.
 */
export function personaOf(roles: readonly string[], permissions: readonly string[]): Persona {
  const has = (role: string) => roles.includes(role);
  const can = (permission: string) => permissions.includes(permission);

  if (has('VENDOR') && roles.length === 1) return 'vendor';
  if (has('SUPER_ADMIN') || has('COMPANY_ADMIN')) return 'admin';
  if (has('IT_ADMIN') || has('IT_TECHNICIAN')) return 'it';
  if (has('INVENTORY_MANAGER') || has('OFFICE_ADMIN')) return 'stores';
  if (has('FINANCE') || has('PROCUREMENT_MANAGER')) return 'finance';
  if (has('HR')) return 'hr';
  if (has('AUDITOR')) return 'auditor';
  if (has('MANAGER')) return 'approver';
  if (has('VENDOR')) return 'vendor';

  // A custom role: read what it may do.
  if (can(P.VENDOR_PORTAL_ACCESS)) return 'vendor';
  if (can(P.ASSETS_ASSIGN) || can(P.MAINTENANCE_MANAGE)) return 'it';
  if (can(P.INVENTORY_ADJUST)) return 'stores';
  if (can(P.INVOICES_UPLOAD)) return 'finance';
  if (can(P.OFFBOARDING_MANAGE)) return 'hr';
  if (can(P.REQUESTS_APPROVE) || can(P.REQUESTS_ASSESS)) return 'approver';
  return 'employee';
}

// ---------------------------------------------------------------------------
// The catalogue of actions, queues and tabs, each with its gate
// ---------------------------------------------------------------------------

interface Gated<T> {
  value: T;
  /** Any one of these is enough; none listed means everybody. */
  anyOf?: readonly string[];
}

const ACTIONS: Record<string, Gated<QuickAction>> = {
  scan: {
    value: { key: 'scan', label: 'Scan', icon: 'qr-code-outline', href: '/(tabs)/scan' },
    anyOf: [P.ASSETS_READ],
  },
  request: {
    value: { key: 'request', label: 'New request', icon: 'add-circle-outline', href: '/(tabs)/requests' },
    anyOf: [P.REQUESTS_CREATE],
  },
  equipment: {
    value: { key: 'equipment', label: 'My equipment', icon: 'laptop-outline', href: '/my-equipment' },
    anyOf: [P.ASSETS_READ],
  },
  register: {
    value: { key: 'register', label: 'Register asset', icon: 'cube-outline', href: '/asset/new' },
    anyOf: [P.ASSETS_CREATE],
  },
  workOrders: {
    value: { key: 'workOrders', label: 'Work orders', icon: 'construct-outline', href: '/work-orders' },
    anyOf: [P.MAINTENANCE_MANAGE],
  },
  count: {
    value: { key: 'count', label: 'Stock count', icon: 'clipboard-outline', href: '/(tabs)/inventory' },
    anyOf: [P.INVENTORY_ADJUST],
  },
  receive: {
    value: { key: 'receive', label: 'Receive order', icon: 'download-outline', href: '/purchase-orders' },
    anyOf: [P.PROCUREMENT_RECEIVE],
  },
  stock: {
    value: { key: 'stock', label: 'Stock', icon: 'file-tray-stacked-outline', href: '/stock' },
    anyOf: [P.INVENTORY_READ],
  },
  bill: {
    value: { key: 'bill', label: 'Capture bill', icon: 'camera-outline', href: '/(tabs)/capture' },
    anyOf: [P.INVOICES_UPLOAD],
  },
  invoices: {
    value: { key: 'invoices', label: 'Invoices', icon: 'receipt-outline', href: '/invoices' },
    anyOf: [P.INVOICES_READ],
  },
  people: {
    value: { key: 'people', label: 'People', icon: 'people-outline', href: '/people' },
    anyOf: [P.USERS_READ],
  },
  invitations: {
    value: { key: 'invitations', label: 'Invitations', icon: 'mail-unread-outline', href: '/people-invitations' },
    anyOf: [P.USERS_MANAGE],
  },
  approvals: {
    value: { key: 'approvals', label: 'Awaiting me', icon: 'checkmark-done-outline', href: '/(tabs)/approvals' },
    anyOf: [P.REQUESTS_APPROVE, P.REQUESTS_ASSESS],
  },
  reports: {
    value: { key: 'reports', label: 'Reports', icon: 'bar-chart-outline', href: '/reports' },
    anyOf: [P.REPORTS_READ],
  },
  verify: {
    value: { key: 'verify', label: 'Verify round', icon: 'shield-checkmark-outline', href: '/verification' },
    anyOf: [P.AUDIT_READ, P.ASSETS_UPDATE, P.ASSETS_ASSIGN, P.ASSETS_RETURN],
  },
  audit: {
    value: { key: 'audit', label: 'Audit log', icon: 'reader-outline', href: '/audit' },
    anyOf: [P.AUDIT_READ],
  },
  offers: {
    value: { key: 'offers', label: 'My offers', icon: 'pricetags-outline', href: '/(tabs)/catalogue' },
    anyOf: [P.VENDOR_PRODUCTS_READ],
  },
  company: {
    value: { key: 'company', label: 'Company details', icon: 'business-outline', href: '/vendor-company' },
    anyOf: [P.VENDOR_PORTAL_ACCESS],
  },
};

const QUEUE_GATE: Record<QueueKey, readonly string[]> = {
  'awaiting-me': [P.REQUESTS_APPROVE, P.REQUESTS_ASSESS],
  'my-work-orders': [P.MAINTENANCE_MANAGE],
  'low-stock': [P.INVENTORY_READ],
  'invoices-to-verify': [P.INVOICES_READ],
  offboarding: [P.OFFBOARDING_MANAGE, P.OFFBOARDING_FULFIL],
  'recent-changes': [P.AUDIT_READ],
};

const TAB_GATE: Record<TabKey, readonly string[]> = {
  assets: [P.ASSETS_READ],
  requests: [P.REQUESTS_READ],
  approvals: [P.REQUESTS_APPROVE, P.REQUESTS_ASSESS],
  catalogue: [P.VENDOR_PRODUCTS_READ],
  scan: [P.ASSETS_READ],
  inventory: [P.INVENTORY_ADJUST],
  capture: [P.INVOICES_UPLOAD],
};

/** How many tabs sit between Home and Menu: three, so the bar is never more than five. */
export const MAX_ROLE_TABS = 3;
export const MAX_QUICK_ACTIONS = 4;

// ---------------------------------------------------------------------------
// What each persona is offered, in order of preference
// ---------------------------------------------------------------------------

interface PersonaSpec {
  focus: string;
  actions: readonly (keyof typeof ACTIONS)[];
  queues: readonly QueueKey[];
  tabs: readonly TabKey[];
}

/**
 * Longer than will fit, on purpose: each list is a preference order, the gates
 * drop what the account may not do, and the first few that survive are shown.
 */
const SPEC: Record<Persona, PersonaSpec> = {
  vendor: {
    focus: 'Your offers, and what needs you',
    actions: ['offers', 'company'],
    queues: [],
    tabs: ['catalogue'],
  },
  employee: {
    focus: 'Your equipment and your requests',
    actions: ['request', 'equipment', 'scan'],
    queues: ['awaiting-me'],
    tabs: ['requests', 'assets', 'scan'],
  },
  approver: {
    focus: 'Requests waiting for your decision',
    actions: ['approvals', 'request', 'equipment', 'scan'],
    queues: ['awaiting-me'],
    tabs: ['approvals', 'requests', 'assets'],
  },
  it: {
    focus: 'Today’s hands-on work',
    actions: ['scan', 'verify', 'workOrders', 'register', 'request', 'equipment'],
    queues: ['my-work-orders', 'awaiting-me', 'offboarding'],
    tabs: ['assets', 'scan', 'approvals', 'requests'],
  },
  stores: {
    focus: 'Stock, deliveries and counts',
    actions: ['count', 'receive', 'stock', 'scan', 'request'],
    queues: ['low-stock', 'awaiting-me'],
    tabs: ['inventory', 'scan', 'approvals', 'requests', 'assets'],
  },
  finance: {
    focus: 'Bills to verify and spend to approve',
    actions: ['bill', 'invoices', 'approvals', 'reports', 'request'],
    queues: ['invoices-to-verify', 'awaiting-me'],
    tabs: ['capture', 'approvals', 'requests', 'assets'],
  },
  hr: {
    focus: 'Joiners, leavers and their equipment',
    actions: ['people', 'invitations', 'approvals', 'request', 'equipment'],
    queues: ['offboarding', 'awaiting-me'],
    tabs: ['approvals', 'requests', 'assets'],
  },
  auditor: {
    focus: 'What changed, and what is where',
    actions: ['scan', 'verify', 'audit', 'reports', 'equipment'],
    queues: ['recent-changes'],
    tabs: ['assets', 'scan', 'requests'],
  },
  admin: {
    focus: 'The whole company at a glance',
    actions: ['scan', 'approvals', 'people', 'reports', 'register'],
    queues: ['awaiting-me', 'my-work-orders', 'low-stock', 'offboarding'],
    tabs: ['assets', 'approvals', 'requests', 'scan'],
  },
};

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export function homePlan(roles: readonly string[], permissions: readonly string[]): HomePlan {
  const allowed = (anyOf?: readonly string[]) =>
    !anyOf || anyOf.length === 0 || anyOf.some((p) => permissions.includes(p));

  const persona = personaOf(roles, permissions);
  const spec = SPEC[persona];

  return {
    persona,
    focus: spec.focus,
    quickActions: spec.actions
      .map((key) => ACTIONS[key]!)
      .filter((action) => allowed(action.anyOf))
      .map((action) => action.value)
      .slice(0, MAX_QUICK_ACTIONS),
    queues: spec.queues.filter((key) => allowed(QUEUE_GATE[key])),
    tabs: spec.tabs.filter((key) => allowed(TAB_GATE[key])).slice(0, MAX_ROLE_TABS),
    equipmentFirst: persona === 'employee',
  };
}

/** Whether a tab screen is on the bar for this account; the rest stay reachable from Menu. */
export function tabOnBar(plan: HomePlan, tab: TabKey): boolean {
  return plan.tabs.includes(tab);
}

/** The order the role tabs sit in, between Home and Menu. */
export function tabOrder(plan: HomePlan): TabKey[] {
  return [...plan.tabs];
}
