import { describe, expect, it } from 'vitest';
import { coverageSummary, normaliseSerial, notEnrolledDevices } from './agent-coverage';

const laptop = (id: string, serial: string | null, key = 'laptop') => ({
  id,
  name: `Laptop ${id}`,
  assetTag: `LAP-${id}`,
  serialNumber: serial,
  subcategoryKey: key,
  holder: null,
});

describe('which machines have no agent yet', () => {
  it('lists a laptop no live agent has reported the serial of', () => {
    const rows = notEnrolledDevices(
      [laptop('1', 'ABC123'), laptop('2', 'DEF456'), laptop('3', 'GHI789')],
      [
        { serialNumber: 'abc123 ', revokedAt: null },
        { serialNumber: 'DEF456', revokedAt: '2026-09-01T00:00:00Z' },
      ],
    );
    expect(rows.map((r) => [r.id, r.reason])).toEqual([
      ['2', 'no-agent'],
      ['3', 'no-agent'],
    ]);
  });

  it('ignores monitors, headsets and the rest', () => {
    expect(
      notEnrolledDevices([laptop('m', 'X', 'monitor'), laptop('h', 'Y', null as never)], []),
    ).toEqual([]);
  });

  it('says when a machine has no serial to match on, instead of counting it as covered', () => {
    const rows = notEnrolledDevices([laptop('1', '  ')], []);
    expect(rows[0]!.reason).toBe('no-serial');
  });

  it('normalises serials the way the discovery matcher does', () => {
    expect(normaliseSerial(' abc-1 ')).toBe('ABC-1');
    expect(normaliseSerial('')).toBeNull();
  });

  it('sums up the rollout in one line', () => {
    expect(coverageSummary(12, 34)).toBe('12 of 34 laptops and desktops have no agent yet');
    expect(coverageSummary(0, 34)).toBe('All 34 laptops and desktops have an agent');
    expect(coverageSummary(0, 0)).toBe('No laptops or desktops in the register');
  });
});
