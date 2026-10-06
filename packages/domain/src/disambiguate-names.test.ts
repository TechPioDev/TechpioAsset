import { describe, expect, it } from 'vitest';
import { disambiguateNames } from './disambiguate-names';

describe('telling two rows with the same label apart', () => {
  it('leaves a unique name alone', () => {
    const rows = [
      { name: 'Laptop', count: 53, qualifier: 'Hardware' },
      { name: 'Monitor', count: 3, qualifier: 'IT assets' },
    ];
    expect(disambiguateNames(rows).map((r) => r.name)).toEqual(['Laptop', 'Monitor']);
  });

  it('qualifies a name that repeats', () => {
    // The real shape from the tenant: two different types, both "Laptop".
    const rows = [
      { name: 'Laptop', count: 53, qualifier: 'Hardware' },
      { name: 'Laptop', count: 8, qualifier: 'IT assets' },
      { name: 'Monitor', count: 3, qualifier: 'IT assets' },
    ];
    expect(disambiguateNames(rows).map((r) => r.name)).toEqual([
      'Laptop (Hardware)',
      'Laptop (IT assets)',
      'Monitor',
    ]);
  });

  it('keeps every count exactly as it was', () => {
    const rows = [
      { name: 'Laptop', count: 53, qualifier: 'Hardware' },
      { name: 'Laptop', count: 8, qualifier: 'IT assets' },
    ];
    const out = disambiguateNames(rows);
    expect(out.map((r) => r.count)).toEqual([53, 8]);
    // Renaming must never merge rows: that would turn two numbers into one.
    expect(out).toHaveLength(2);
  });

  it('produces labels that are actually distinct', () => {
    const rows = [
      { name: 'Chair', count: 4, qualifier: 'Furniture' },
      { name: 'Chair', count: 2, qualifier: 'Office equipment' },
      { name: 'Chair', count: 1, qualifier: 'Consumables' },
    ];
    const names = disambiguateNames(rows).map((r) => r.name);
    expect(new Set(names).size).toBe(3);
  });

  it('does not invent a distinction it cannot make', () => {
    // Nothing to qualify with: leave the rows as they are rather than making
    // up "(1)" and "(2)", which would read as a fact about the data.
    const rows = [
      { name: 'Laptop', count: 53, qualifier: null },
      { name: 'Laptop', count: 8, qualifier: null },
    ];
    expect(disambiguateNames(rows).map((r) => r.name)).toEqual(['Laptop', 'Laptop']);
  });
});
