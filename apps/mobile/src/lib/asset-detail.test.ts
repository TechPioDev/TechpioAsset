import { describe, expect, it } from 'vitest';
import {
  SOFTWARE_MAX_PAGES,
  SOFTWARE_PAGE_SIZE,
  filterSoftware,
  hasMoreSoftware,
  holderDisplayName,
  warrantyCheckNotice,
} from './asset-detail';

const row = (name: string, publisher: string | null = null) => ({
  id: name,
  name,
  version: null,
  publisher,
});

describe('software list on the phone', () => {
  it('keeps paging only while pages come back full, and never forever', () => {
    expect(hasMoreSoftware(SOFTWARE_PAGE_SIZE, 1)).toBe(true);
    expect(hasMoreSoftware(42, 1)).toBe(false);
    expect(hasMoreSoftware(0, 3)).toBe(false);
    expect(hasMoreSoftware(SOFTWARE_PAGE_SIZE, SOFTWARE_MAX_PAGES)).toBe(false);
  });

  it('searches name and publisher, ignoring case and blanks', () => {
    const rows = [row('Google Chrome', 'Google LLC'), row('7-Zip', null), row('Microsoft Teams', 'Microsoft')];
    expect(filterSoftware(rows, '')).toHaveLength(3);
    expect(filterSoftware(rows, '   ')).toHaveLength(3);
    expect(filterSoftware(rows, 'chrome').map((r) => r.name)).toEqual(['Google Chrome']);
    expect(filterSoftware(rows, 'MICROSOFT').map((r) => r.name)).toEqual(['Microsoft Teams']);
    expect(filterSoftware(rows, 'zzz')).toEqual([]);
  });
});

describe('warranty check', () => {
  it('opens straight away when the vendor resolves the serial from the link', () => {
    expect(warrantyCheckNotice({ label: 'Dell', serialInUrl: true }, '4TPJBK3')).toBeNull();
  });

  it('shows the serial first for form-based vendors', () => {
    expect(warrantyCheckNotice({ label: 'HP', serialInUrl: false }, '5CD123')).toBe(
      'Enter serial 5CD123 on the HP page.',
    );
    expect(warrantyCheckNotice({ label: 'HP', serialInUrl: false }, null)).toBeNull();
  });
});

describe('holder name', () => {
  const person = { email: 'a@x.com', profile: { firstName: 'Asha', lastName: 'Rao' } };
  it('prefers the assigned user, then the open assignment, then nothing', () => {
    expect(holderDisplayName(person, null)).toBe('Asha Rao');
    expect(holderDisplayName(null, { email: 'b@x.com', profile: null })).toBe('b@x.com');
    expect(holderDisplayName(null, null)).toBeNull();
  });
});
