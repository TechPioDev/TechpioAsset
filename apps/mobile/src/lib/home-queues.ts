import { maintenanceStatusLabel } from '@techpioasset/domain';
import type { QueueKey } from './home-plan';

/**
 * The work queues on Home (0.3.30): the two or three things waiting for THIS
 * person, under the tiles, each opening the item itself.
 *
 * A tile says "3 awaiting you"; a queue shows which three, so the most common
 * reason to open the app - "what needs me?" - is answered without leaving the
 * first screen. Each queue reuses a request a full screen already makes, takes
 * the first few rows and links to that screen for the rest.
 *
 * A queue that fails to load, or comes back empty, renders nothing at all: an
 * empty "Low stock" box on a good day is noise, and a refusal here must never
 * take the Home screen down with it. What is below is the part that needs no
 * React Native - the request, and the turning of each response into rows - so it
 * runs under vitest.
 */

export const QUEUE_ROWS = 3;

export interface QueueRow {
  id: string;
  title: string;
  subtitle: string | null;
  /** A short status on the right, if the row has one worth showing. */
  badge: string | null;
  tone: 'neutral' | 'warning' | 'danger';
  href: string;
}

export interface QueueSpec {
  title: string;
  icon: string;
  /** The full screen behind "See all". */
  seeAllHref: string;
  path: (userId: string) => string;
  rows: (payload: unknown, now: Date) => QueueRow[];
}

/** The API client unwraps `data`; a paginated endpoint may still hand back `{ data: [] }`. */
function listOf<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const inner = (payload as { data?: unknown } | null)?.data;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

function personName(person: {
  email?: string | null;
  profile?: { firstName?: string | null; lastName?: string | null } | null;
} | null): string {
  const name = [person?.profile?.firstName, person?.profile?.lastName].filter(Boolean).join(' ');
  return name || person?.email || 'Somebody';
}

function pretty(code: string): string {
  const s = code.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CLOSED_WORK = new Set(['COMPLETED', 'CANCELLED', 'FAILED', 'CLOSED', 'APPROVED']);
const SETTLED_INVOICE = new Set(['VERIFIED', 'REJECTED']);

export const QUEUES: Record<QueueKey, QueueSpec> = {
  'awaiting-me': {
    title: 'Awaiting you',
    icon: 'checkmark-done-outline',
    seeAllHref: '/(tabs)/approvals',
    path: () => `/requests?awaitingMe=true&pageSize=${QUEUE_ROWS}`,
    rows: (payload) =>
      listOf<{
        id: string;
        requestNumber: string;
        currentStep: { name: string } | null;
        requester: Parameters<typeof personName>[0];
        items: { description: string }[];
      }>(payload)
        .slice(0, QUEUE_ROWS)
        .map((r) => ({
          id: r.id,
          title: r.items?.map((i) => i.description).join(', ') || r.requestNumber,
          subtitle: `${r.requestNumber} · ${personName(r.requester)}`,
          badge: r.currentStep?.name ?? null,
          tone: 'warning' as const,
          href: `/request/${r.id}`,
        })),
  },

  'my-work-orders': {
    title: 'Your work orders',
    icon: 'construct-outline',
    seeAllHref: '/work-orders',
    path: (userId) => `/maintenance?pageSize=25&technicianId=${userId}`,
    rows: (payload, now) =>
      listOf<{ id: string; title: string; status: string; slaDueAt: string | null; scheduledFor: string | null }>(
        payload,
      )
        .filter((w) => !CLOSED_WORK.has(w.status))
        .slice(0, QUEUE_ROWS)
        .map((w) => {
          const overdue = Boolean(w.slaDueAt && new Date(w.slaDueAt) < now);
          return {
            id: w.id,
            title: w.title,
            subtitle: overdue
              ? 'Past its due time'
              : w.scheduledFor
                ? `Scheduled ${new Date(w.scheduledFor).toLocaleDateString()}`
                : null,
            badge: maintenanceStatusLabel(w.status),
            tone: overdue ? ('danger' as const) : ('neutral' as const),
            href: `/work-order/${w.id}`,
          };
        }),
  },

  'low-stock': {
    title: 'Low stock',
    icon: 'file-tray-stacked-outline',
    seeAllHref: '/stock',
    path: () => '/stock/levels?pageSize=50',
    rows: (payload) =>
      listOf<{
        id: string;
        quantity: string;
        inventoryItem: { name: string; unit: string; minStock: string | null };
        stockLocation: { name: string };
      }>(payload)
        .filter((l) => l.inventoryItem.minStock !== null && Number(l.quantity) <= Number(l.inventoryItem.minStock))
        .slice(0, QUEUE_ROWS)
        .map((l) => ({
          id: l.id,
          title: l.inventoryItem.name,
          subtitle: `${l.stockLocation.name} · reorder at ${Number(l.inventoryItem.minStock)}`,
          badge: `${Number(l.quantity)} left`,
          tone: Number(l.quantity) <= 0 ? ('danger' as const) : ('warning' as const),
          href: '/stock',
        })),
  },

  'invoices-to-verify': {
    title: 'Bills to verify',
    icon: 'receipt-outline',
    seeAllHref: '/invoices',
    path: () => '/invoices?pageSize=25',
    rows: (payload) =>
      listOf<{
        id: string;
        invoiceNumber: string;
        verificationStatus: string;
        vendor: { name: string } | null;
      }>(payload)
        .filter((i) => !SETTLED_INVOICE.has(i.verificationStatus))
        .slice(0, QUEUE_ROWS)
        .map((i) => ({
          id: i.id,
          title: i.invoiceNumber,
          subtitle: i.vendor?.name ?? 'No vendor',
          badge: pretty(i.verificationStatus),
          tone: 'warning' as const,
          href: `/invoice/${i.id}`,
        })),
  },

  offboarding: {
    title: 'Leaving the company',
    icon: 'exit-outline',
    seeAllHref: '/people',
    path: () => '/lifecycle/tasks?direction=OFFBOARDING&status=OPEN',
    rows: (payload) =>
      listOf<{ id: string; subjectUserId: string; subjectUser?: Parameters<typeof personName>[0] }>(payload)
        .slice(0, QUEUE_ROWS)
        .map((t) => ({
          id: t.id,
          title: personName(t.subjectUser ?? null),
          subtitle: 'Offboarding in progress · equipment to collect',
          badge: null,
          tone: 'warning' as const,
          href: `/person/offboard?id=${t.subjectUserId}`,
        })),
  },

  'recent-changes': {
    title: 'Latest changes',
    icon: 'reader-outline',
    seeAllHref: '/audit',
    path: () => `/audit?pageSize=${QUEUE_ROWS}`,
    rows: (payload) =>
      listOf<{
        id: string;
        action: string;
        entityType: string;
        createdAt: string;
        actor: Parameters<typeof personName>[0] & { profile?: { displayName?: string | null } | null };
      }>(payload)
        .slice(0, QUEUE_ROWS)
        .map((a) => ({
          id: a.id,
          title: `${pretty(a.action)} · ${a.entityType}`,
          subtitle: `${a.actor?.profile?.displayName || personName(a.actor)} · ${new Date(a.createdAt).toLocaleString()}`,
          badge: null,
          tone: 'neutral' as const,
          href: '/audit',
        })),
  },
};
