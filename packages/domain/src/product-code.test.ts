import { describe, expect, it } from 'vitest';
import { formatProductCode, productCodeSequence, productCodeStem } from './product-code';

describe('the code a listing is known by', () => {
  it('builds the example from the specification', () => {
    const stem = productCodeStem({ categoryName: 'Laptops', brand: 'Dell', model: 'Latitude 5420' });
    expect(formatProductCode(stem, 1)).toBe('LAP-DELL-5420-001');
  });

  it('prefers the number in a model, which is what the thing is called', () => {
    // Nobody asks for a Latitude; they ask for a 5420.
    expect(productCodeStem({ categoryName: 'Laptops', brand: 'HP', model: 'EliteBook 840 G9' })).toBe(
      'LAP-HP-840',
    );
  });

  it('falls back to letters for a model with no number in it', () => {
    expect(productCodeStem({ categoryName: 'Mice', brand: 'Logitech', model: 'MX Master' })).toBe(
      'MIC-LOGITE-MXMAST',
    );
  });

  it('still produces a usable code when brand and model are missing', () => {
    expect(productCodeStem({ categoryName: 'Monitors' })).toBe('MON');
    expect(formatProductCode(productCodeStem({ categoryName: 'Monitors' }), 7)).toBe('MON-007');
  });

  it('does not fall over on a category of punctuation', () => {
    expect(productCodeStem({ categoryName: '—', brand: 'Dell' })).toBe('GEN-DELL');
  });

  it('keeps counting past three digits rather than wrapping', () => {
    expect(formatProductCode('LAP-DELL', 1000)).toBe('LAP-DELL-1000');
  });

  it('reads its own sequence back', () => {
    expect(productCodeSequence('LAP-DELL-5420-001')).toBe(1);
    expect(productCodeSequence('LAP-DELL-5420-042')).toBe(42);
    // A code somebody typed by hand that does not end in a number.
    expect(productCodeSequence('LEGACY-CODE')).toBe(0);
  });
});
