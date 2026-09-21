import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from './permissions';
import { searchGroups, searchSummary, searchTerm, SEARCH_GROUP_ROWS } from './global-search';

const keys = (permissions: readonly string[]) => searchGroups(permissions).map((g) => g.key);

describe('who may search what', () => {
  it('lets an administrator search all three', () => {
    expect(keys(ROLE_PERMISSIONS.SUPER_ADMIN)).toEqual(['assets', 'people', 'requests']);
  });

  it('offers a supplier nothing to search', () => {
    expect(keys(ROLE_PERMISSIONS.VENDOR)).toEqual([]);
  });

  it('never offers a group the account cannot read', () => {
    expect(keys([])).toEqual([]);
    expect(keys(['assets:read'])).toEqual(['assets']);
  });
});

describe('the search itself', () => {
  it('waits for two characters, and ignores the spaces around them', () => {
    expect(searchTerm(' a ')).toBeNull();
    expect(searchTerm('  la ')).toBe('la');
  });

  it('asks each list for a few rows, with the term safely encoded', () => {
    const [assets, people, requests] = searchGroups(ROLE_PERMISSIONS.SUPER_ADMIN);
    expect(assets!.path('dell & co')).toBe(`/assets?q=dell%20%26%20co&pageSize=${SEARCH_GROUP_ROWS}`);
    // Everybody the caller may see, vendor sign-ins included: a search is how one is found.
    expect(people!.path('ravi')).toContain('audience=all');
    expect(requests!.path('REQ-2026')).toBe(`/requests?q=REQ-2026&pageSize=${SEARCH_GROUP_ROWS}`);
  });

  it('describes an asset by what is printed on it and who holds it', () => {
    const [assets] = searchGroups(ROLE_PERMISSIONS.SUPER_ADMIN);
    expect(
      assets!.rows([
        {
          id: 'a1',
          name: 'Dell Latitude 7450',
          assetTag: 'LAP-0003',
          serialNumber: 'DL7450X003',
          status: 'IN_USE',
          assignedUser: { email: 'd@x.test', profile: { firstName: 'Daniel', lastName: 'Whyte' } },
        },
      ]),
    ).toEqual([
      { id: 'a1', title: 'Dell Latitude 7450', subtitle: 'LAP-0003 · DL7450X003 · Daniel Whyte', badge: 'In use' },
    ]);
  });

  it('names a person, and only flags the ones who cannot sign in', () => {
    const people = searchGroups(ROLE_PERMISSIONS.SUPER_ADMIN)[1]!;
    const rows = people.rows({
      data: [
        { id: 'u1', email: 'a@x.test', status: 'ACTIVE', profile: { firstName: 'Asha', lastName: 'Rao', department: { name: 'Finance' } } },
        { id: 'u2', email: 'b@x.test', status: 'DEACTIVATED', profile: null },
      ],
    });
    expect(rows).toEqual([
      { id: 'u1', title: 'Asha Rao', subtitle: 'a@x.test · Finance', badge: null },
      { id: 'u2', title: 'b@x.test', subtitle: 'b@x.test', badge: 'Deactivated' },
    ]);
  });

  it('shows a request by what was asked for, and where it stands', () => {
    const requests = searchGroups(ROLE_PERMISSIONS.SUPER_ADMIN)[2]!;
    expect(
      requests.rows([
        {
          id: 'r1',
          requestNumber: 'REQ-2026-000012',
          status: 'PENDING',
          currentStep: { name: 'Manager review' },
          requester: { email: 'r@x.test', profile: null },
          items: [{ description: 'Headset' }],
        },
      ]),
    ).toEqual([{ id: 'r1', title: 'Headset', subtitle: 'REQ-2026-000012 · r@x.test', badge: 'Manager review' }]);
  });

  it('never shows more than a few rows a group, and nothing from a bad response', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, name: 'x', assetTag: `T${i}`, status: 'AVAILABLE' }));
    for (const group of searchGroups(ROLE_PERMISSIONS.SUPER_ADMIN)) {
      expect(group.rows(null)).toEqual([]);
      expect(group.rows({ nonsense: 1 })).toEqual([]);
    }
    expect(searchGroups(ROLE_PERMISSIONS.SUPER_ADMIN)[0]!.rows(many)).toHaveLength(SEARCH_GROUP_ROWS);
  });

  it('says how many it found, or that it found nothing', () => {
    expect(searchSummary(0, 'xyz')).toBe('Nothing found for “xyz”.');
    expect(searchSummary(1, 'x')).toBe('1 result');
    expect(searchSummary(7, 'x')).toBe('7 results');
  });
});
