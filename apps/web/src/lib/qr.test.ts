import { describe, expect, it } from 'vitest';
import { parseScanValue } from './qr';

describe('parseScanValue', () => {
  it('treats an empty or blank read as nothing', () => {
    expect(parseScanValue('')).toEqual({ kind: 'empty' });
    expect(parseScanValue('   \n')).toEqual({ kind: 'empty' });
  });

  it('takes the token out of a printed label address, whatever the host', () => {
    const token = '01KYX56HZT81QXS171WT4H9XGG';
    for (const url of [
      `https://pioassets.com/assets/scan/${token}`,
      `http://localhost:3000/assets/scan/${token}`,
      `https://staging.example.com/assets/scan/${token}?utm=label#top`,
      `  https://pioassets.com/assets/scan/${token}/  `,
      `HTTPS://PIOASSETS.COM/ASSETS/SCAN/${token}`,
    ]) {
      expect(parseScanValue(url)).toEqual({ kind: 'label', token });
    }
  });

  it('decodes an escaped token, and keeps a malformed escape as written', () => {
    expect(parseScanValue('https://x.test/assets/scan/ab%2Dcd')).toEqual({ kind: 'label', token: 'ab-cd' });
    expect(parseScanValue('https://x.test/assets/scan/ab%E0')).toEqual({ kind: 'label', token: 'ab%E0' });
  });

  it('hands anything else on as text - a bare token or an asset tag', () => {
    expect(parseScanValue(' 01KYX56HZT81QXS171WT4H9XGG ')).toEqual({
      kind: 'text',
      value: '01KYX56HZT81QXS171WT4H9XGG',
    });
    expect(parseScanValue('MOH-LAP-0042')).toEqual({ kind: 'text', value: 'MOH-LAP-0042' });
    expect(parseScanValue('https://example.com/assets/123')).toEqual({
      kind: 'text',
      value: 'https://example.com/assets/123',
    });
  });
});
