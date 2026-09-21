import { PERMISSIONS } from './permissions';

/**
 * Global search (v2.73): one box that finds an asset, a person or a request.
 *
 * Until now "search" meant the asset list's own box, and the web header's box
 * went there too - so somebody holding a serial number, a colleague's name or
 * a request number had to know which list to open before they could look.
 *
 * It asks the three lists that already exist, each with its own `q`, rather
 * than a new endpoint: every one of them already applies the caller's
 * permission and data scope, so an employee finds only their own equipment and
 * requests, a supplier finds nothing, and there is no second place where those
 * rules could drift. What is here is what the web and the phone share: which
 * groups an account may search, the request for each, and the turning of each
 * response into rows. Where a row leads is the platform's business.
 */

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_GROUP_ROWS = 5;

export type SearchGroupKey = 'assets' | 'people' | 'requests';

export interface SearchRow {
  id: string;
  title: string;
  subtitle: string | null;
  /** A short status on the right, if the row has one worth showing. */
  badge: string | null;
}

export interface SearchGroup {
  key: SearchGroupKey;
  title: string;
  /** Relative to the API base. */
  path: (query: string) => string;
  rows: (payload: unknown) => SearchRow[];
}

/** Trimmed, and null when there is too little to search on. */
export function searchTerm(raw: string): string | null {
  const term = raw.trim();
  return term.length >= SEARCH_MIN_LENGTH ? term : null;
}

/** A list endpoint may answer with the rows, or with `{ data: rows }`. */
function listOf<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const inner = (payload as { data?: unknown } | null)?.data;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

type Person = {
  email?: string | null;
  profile?: { firstName?: string | null; lastName?: string | null } | null;
} | null;

function personName(person: Person | undefined): string | null {
  if (!person) return null;
  const name = [person.profile?.firstName, person.profile?.lastName].filter(Boolean).join(' ');
  return name || person.email || null;
}

function pretty(code: string): string {
  const s = code.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const q = (query: string) => encodeURIComponent(query);

const GROUPS: Record<SearchGroupKey, SearchGroup & { anyOf: readonly string[] }> = {
  assets: {
    key: 'assets',
    title: 'Assets',
    anyOf: [PERMISSIONS.ASSETS_READ],
    path: (query) => `/assets?q=${q(query)}&pageSize=${SEARCH_GROUP_ROWS}`,
    rows: (payload) =>
      listOf<{
        id: string;
        name: string;
        assetTag: string;
        serialNumber?: string | null;
        status: string;
        assignedUser?: Person;
      }>(payload)
        .slice(0, SEARCH_GROUP_ROWS)
        .map((a) => ({
          id: a.id,
          title: a.name,
          subtitle: [a.assetTag, a.serialNumber, personName(a.assignedUser)].filter(Boolean).join(' · '),
          badge: pretty(a.status),
        })),
  },
  people: {
    key: 'people',
    title: 'People',
    // The list route's own gate; users:read alone would be answered with 403.
    anyOf: [PERMISSIONS.EMPLOYEES_READ],
    path: (query) => `/users?q=${q(query)}&pageSize=${SEARCH_GROUP_ROWS}&audience=all`,
    rows: (payload) =>
      listOf<{
        id: string;
        email: string;
        status: string;
        profile?: {
          firstName?: string | null;
          lastName?: string | null;
          jobTitle?: string | null;
          department?: { name: string } | null;
        } | null;
      }>(payload)
        .slice(0, SEARCH_GROUP_ROWS)
        .map((p) => ({
          id: p.id,
          title: personName(p) ?? p.email,
          subtitle: [p.email, p.profile?.department?.name ?? p.profile?.jobTitle].filter(Boolean).join(' · '),
          badge: p.status === 'ACTIVE' ? null : pretty(p.status),
        })),
  },
  requests: {
    key: 'requests',
    title: 'Requests',
    anyOf: [PERMISSIONS.REQUESTS_READ],
    path: (query) => `/requests?q=${q(query)}&pageSize=${SEARCH_GROUP_ROWS}`,
    rows: (payload) =>
      listOf<{
        id: string;
        requestNumber: string;
        status: string;
        currentStep?: { name: string } | null;
        requester?: Person;
        items?: { description: string }[];
      }>(payload)
        .slice(0, SEARCH_GROUP_ROWS)
        .map((r) => ({
          id: r.id,
          title: r.items?.map((i) => i.description).join(', ') || r.requestNumber,
          subtitle: [r.requestNumber, personName(r.requester)].filter(Boolean).join(' · '),
          badge: r.currentStep?.name ?? pretty(r.status),
        })),
  },
};

/** The groups this account may search, in the order they are shown. */
export function searchGroups(permissions: readonly string[]): SearchGroup[] {
  return (['assets', 'people', 'requests'] as const)
    .map((key) => GROUPS[key])
    .filter((group) => group.anyOf.some((p) => permissions.includes(p)))
    .map(({ anyOf: _anyOf, ...group }) => group);
}

/** "3 results" / "1 result" / "Nothing found for …". */
export function searchSummary(total: number, term: string): string {
  if (total === 0) return `Nothing found for “${term}”.`;
  return total === 1 ? '1 result' : `${total} results`;
}
