import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSET_ICON, assetIcon } from './asset-icon';

/**
 * U3 - the icon has to say what the thing is, and must never say something
 * confidently wrong. A generic chip on a chair is a shrug; a car icon on a
 * "car park pass" is a lie.
 */

describe('picking an icon for a piece of equipment', () => {
  it('reads the real categories in use', () => {
    expect(assetIcon('IT Equipment', 'Laptops')).toBe('laptop-outline');
    expect(assetIcon('IT Equipment', 'Monitors')).toBe('tv-outline');
    expect(assetIcon('IT Equipment', 'Headsets')).toBe('headset-outline');
    // Ionicons has no chair or desk; a bed on an office chair would be the
    // icon lying, so furniture takes the neutral mark.
    expect(assetIcon('Furniture', 'Chairs')).toBe('cube-outline');
    expect(assetIcon('Furniture', 'Beds')).toBe('bed-outline');
    expect(assetIcon('Kitchen', 'Appliances')).toBe('cafe-outline');
  });

  it('prefers the subcategory, which is the more specific of the two', () => {
    // Without this, everything under "IT Equipment" would share one icon.
    expect(assetIcon('IT Equipment', 'Printers')).toBe('print-outline');
    expect(assetIcon('IT Equipment', 'Mobile Phones')).toBe('phone-portrait-outline');
  });

  it('lets a more specific family win over a broader one', () => {
    // A laptop docking station is a dock. The rule order is what decides it.
    expect(assetIcon('IT Equipment', 'Laptop Docking Station')).toBe('keypad-outline');
  });

  it('falls back to the name when the categories say nothing useful', () => {
    expect(assetIcon('Misc', 'Other', 'Dell 24in Monitor')).toBe('tv-outline');
  });

  it('shrugs rather than guessing', () => {
    expect(assetIcon('Misc', 'Other', 'Thing')).toBe(DEFAULT_ASSET_ICON);
    expect(assetIcon(null, null, null)).toBe(DEFAULT_ASSET_ICON);
    expect(assetIcon('', '', '')).toBe(DEFAULT_ASSET_ICON);
  });

  it('matches whole words, never fragments', () => {
    // "monitoring" contains "monitor"; a subscription is not a screen.
    expect(assetIcon('Software', 'Monitoring Subscription')).toBe(DEFAULT_ASSET_ICON);
    // "Chairman" contains "chair".
    expect(assetIcon('Office', "Chairman's Allowance")).toBe(DEFAULT_ASSET_ICON);
  });

  it('copes with punctuation and case', () => {
    expect(assetIcon('IT', 'LAPTOPS/NOTEBOOKS')).toBe('laptop-outline');
    expect(assetIcon('IT', 'Phone - Handset')).toBe('phone-portrait-outline');
  });
});
