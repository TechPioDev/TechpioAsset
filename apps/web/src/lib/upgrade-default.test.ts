import { describe, expect, it } from 'vitest';
import { defaultUpgradeSpec, gigabytesOf, refusalMessage } from './upgrade-default';

describe('the default upgrade size', () => {
  const ram = ['16 GB', '32 GB', '64 GB'];
  const storage = ['512 GB SSD', '1 TB SSD', '2 TB SSD'];

  it('offers the next size above what the machine has', () => {
    expect(defaultUpgradeSpec(ram, '31.8 GB')).toBe('32 GB');
    expect(defaultUpgradeSpec(ram, '32 GB')).toBe('64 GB');
    expect(defaultUpgradeSpec(ram, '8 GB')).toBe('16 GB');
    expect(defaultUpgradeSpec(storage, '463.8 GB')).toBe('512 GB SSD');
    expect(defaultUpgradeSpec(storage, '1024 GB')).toBe('2 TB SSD');
  });

  it('offers nothing when the machine already has the largest, or its size is unknown', () => {
    expect(defaultUpgradeSpec(ram, '64 GB')).toBeNull();
    expect(defaultUpgradeSpec(ram, null)).toBeNull();
    expect(defaultUpgradeSpec(ram, '—')).toBeNull();
  });

  it('reads TB and GB', () => {
    expect(gigabytesOf('2 TB SSD')).toBe(2048);
    expect(gigabytesOf('31.8 GB')).toBe(31.8);
    expect(gigabytesOf('plenty')).toBeNull();
  });
});

describe('a refusal names the field', () => {
  it('uses the label the person sees and the reason', () => {
    expect(refusalMessage('requestedSpec', 'Choose what you need')).toBe(
      'Not submitted yet — Requested size: Choose what you need',
    );
    expect(refusalMessage('items.0.description', undefined)).toBe('Not submitted yet — fill in “Items”');
    expect(refusalMessage('somethingElse', undefined)).toBe(
      'Not submitted yet — fill in the highlighted field',
    );
  });
});
