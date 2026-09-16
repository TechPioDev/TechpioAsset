import { describe, expect, it } from 'vitest';
import {
  EMPTY_ASSESSMENT_FORM,
  assessmentBody,
  assessmentPreview,
  formatBytes,
  invalidMoneyField,
} from './assessment';

const form = (over: Partial<typeof EMPTY_ASSESSMENT_FORM>) => ({ ...EMPTY_ASSESSMENT_FORM, ...over });

describe('assessmentPreview (mirrors the web panel and the server arithmetic)', () => {
  it('is null until a unit price is entered', () => {
    expect(assessmentPreview(form({}))).toBeNull();
    expect(assessmentPreview(form({ unitPrice: '   ' }))).toBeNull();
  });

  it('is unit x qty + tax + shipping - discount', () => {
    expect(
      assessmentPreview(
        form({ unitPrice: '65000', quantity: '2', taxAmount: '23400', shipping: '500', discount: '1000' }),
      ),
    ).toBe(152900);
  });

  it('treats a blank or zero quantity as one', () => {
    expect(assessmentPreview(form({ unitPrice: '100', quantity: '' }))).toBe(100);
    expect(assessmentPreview(form({ unitPrice: '100', quantity: '0' }))).toBe(100);
  });

  it('never goes below zero', () => {
    expect(assessmentPreview(form({ unitPrice: '100', discount: '500' }))).toBe(0);
  });

  it('ignores a non-numeric part rather than showing NaN', () => {
    expect(assessmentPreview(form({ unitPrice: '100', taxAmount: 'abc' }))).toBe(100);
  });
});

describe('invalidMoneyField', () => {
  it('accepts blanks and up to two decimals', () => {
    expect(invalidMoneyField(form({ unitPrice: '1234.50', taxAmount: '' }))).toBeNull();
  });

  it('names the first field the server would refuse', () => {
    expect(invalidMoneyField(form({ unitPrice: '10', shipping: '-5' }))).toBe('Shipping');
    expect(invalidMoneyField(form({ unitPrice: '10.555' }))).toBe('Unit price');
    expect(invalidMoneyField(form({ unitPrice: '1,000' }))).toBe('Unit price');
  });
});

describe('assessmentBody (same PATCH body as the web panel)', () => {
  it('filling from stock sends no prices, only the unit found', () => {
    expect(assessmentBody(false, form({ unitPrice: '999' }), 'asset-1')).toEqual({
      inventoryAvailable: true,
      purchaseRequired: false,
      suitableAssetId: 'asset-1',
    });
    expect(assessmentBody(false, form({}), '')).toMatchObject({ suitableAssetId: null });
  });

  it('a purchase sends the parts, never a total', () => {
    const body = assessmentBody(
      true,
      form({ suggestedProduct: 'Dell Latitude 7450', unitPrice: ' 65000 ', quantity: '2', taxAmount: '' }),
      'ignored',
    );
    expect(body).toEqual({
      inventoryAvailable: false,
      purchaseRequired: true,
      suitableAssetId: null,
      suggestedProduct: 'Dell Latitude 7450',
      unitPrice: '65000',
      quantity: 2,
      taxAmount: null,
      shipping: null,
      discount: null,
    });
    expect(body).not.toHaveProperty('totalCost');
  });

  it('adds a trimmed note only when one was written', () => {
    expect(assessmentBody(true, form({ notes: '  quote attached ' }), '')).toMatchObject({
      note: 'quote attached',
    });
    expect(assessmentBody(true, form({ notes: '   ' }), '')).not.toHaveProperty('note');
  });
});

describe('formatBytes', () => {
  it('matches the web request page - KB below a megabyte, as the owner asked', () => {
    expect(formatBytes(512)).toBe('1 KB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
