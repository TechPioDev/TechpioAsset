import { describe, expect, it } from 'vitest';
import {
  LIVE_BARCODE_TYPES,
  photoBarcodeTypes,
  SCAN_MESSAGES,
  tokenFromPhotoResults,
} from './scan-code';

describe('photoBarcodeTypes', () => {
  it('asks iOS for QR only, which is all it can read from a photo', () => {
    expect(photoBarcodeTypes('ios')).toEqual(['qr']);
  });

  it('asks Android for everything the live scanner reads', () => {
    expect(photoBarcodeTypes('android')).toEqual([...LIVE_BARCODE_TYPES]);
  });
});

describe('tokenFromPhotoResults', () => {
  it('takes the token out of a printed label address, as the live scanner does', () => {
    expect(
      tokenFromPhotoResults(
        [{ data: 'https://pioassets.com/assets/scan/01KYX56HZT81QXS171WT4H9XGG' }],
        'android',
      ),
    ).toEqual({ token: '01KYX56HZT81QXS171WT4H9XGG' });
  });

  it('skips blank reads and uses the first code with something in it', () => {
    expect(
      tokenFromPhotoResults([{ data: '  ' }, { data: 'TOKEN-2' }, { data: 'TOKEN-3' }], 'android'),
    ).toEqual({
      token: 'TOKEN-2',
    });
  });

  it('says no code was found when the photo has none', () => {
    expect(tokenFromPhotoResults([], 'android')).toEqual({ message: SCAN_MESSAGES.noCodeInPhoto });
    expect(tokenFromPhotoResults(undefined, 'android')).toEqual({
      message: SCAN_MESSAGES.noCodeInPhoto,
    });
  });

  it('tells an iPhone user why a barcode photo read nothing', () => {
    expect(tokenFromPhotoResults([{ data: '' }], 'ios')).toEqual({
      message: SCAN_MESSAGES.noCodeInPhotoIos,
    });
  });
});
