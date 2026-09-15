import { describe, expect, it } from 'vitest';
import { parseDateCell, parsePriceCell } from './asset-price-sheet.service.js';

/**
 * The two cell readers behind the price sheet (v2.59). A cell read as the wrong
 * figure is worse than one refused, so every refusal has its own message.
 */

describe('parsePriceCell', () => {
  it.each([
    [68000, '68000.00'],
    [68000.5, '68000.50'],
    ['68,000.50', '68000.50'],
    ['1,20,000', '120000.00'],
    ['₹ 45,999', '45999.00'],
    ['Rs. 68000', '68000.00'],
    ['INR 1200.5', '1200.50'],
  ])('reads %s as %s', (raw, expected) => {
    expect(parsePriceCell(raw)).toEqual({ ok: true, value: expected });
  });

  it.each([
    [-5, 'cannot be negative'],
    ['-100', 'cannot be negative'],
    ['12.345', 'more than 2 decimal places'],
    [12.345, 'more than 2 decimal places'],
    [0, 'more than zero'],
    ['0.00', 'more than zero'],
    ['about 5k', 'is not a number'],
    ['1234567890123', 'too large'],
    [1e21, 'too large'],
    [new Date(), 'is a date'],
  ])('refuses %s (%s)', (raw, message) => {
    const result = parsePriceCell(raw as string | number | Date);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain(message);
  });
});

describe('parseDateCell', () => {
  const today = '2026-09-15';

  it.each([
    ['2024-03-15', '2024-03-15'],
    ['2024-02-29', '2024-02-29'],
    ['2024-03-15T00:00:00.000Z', '2024-03-15'],
    [new Date('2024-03-15T00:00:00.000Z'), '2024-03-15'],
    // Excel's day serial for 2024-03-15.
    [45366, '2024-03-15'],
    [today, today],
  ])('reads %s as %s', (raw, expected) => {
    expect(parseDateCell(raw, today)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['2026-09-16', 'in the future'],
    ['1989-12-31', 'before 1990'],
    ['15/03/2024', 'YYYY-MM-DD'],
    ['2023-02-29', 'not a real date'],
    ['March 2024', 'YYYY-MM-DD'],
    [45366.5, 'YYYY-MM-DD'],
  ])('refuses %s (%s)', (raw, message) => {
    const result = parseDateCell(raw, today);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain(message);
  });
});
