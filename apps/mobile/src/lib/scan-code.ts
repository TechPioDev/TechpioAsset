import { qrTokenFrom } from './qr';

/**
 * Turning what a scanner read into an asset to open - shared by the live
 * camera and "Scan from a photo" on the scan screen, so a label that works one
 * way works the other.
 */

/** What the live scanner reads. A photo is read for the same, where the OS can. */
export const LIVE_BARCODE_TYPES = ['qr', 'code128', 'ean13', 'code39'] as const;
export type ScanBarcodeType = (typeof LIVE_BARCODE_TYPES)[number];

/**
 * scanFromURLAsync reads only QR codes on iOS (expo-camera 16), and asking for
 * more there is not an error it reports - so ask for exactly what it can do.
 */
export function photoBarcodeTypes(os: string): ScanBarcodeType[] {
  return os === 'ios' ? ['qr'] : [...LIVE_BARCODE_TYPES];
}

export const SCAN_MESSAGES = {
  emptyRead: 'Nothing was read from that code. Try again.',
  notAsset: 'That code does not match an asset you can access.',
  noCodeInPhoto:
    'No QR code or barcode was found in that photo. Try a sharper picture with the label filling most of the frame.',
  noCodeInPhotoIos:
    'No QR code was found in that photo. On iPhone only QR codes can be read from a photo - scan a barcode with the camera instead.',
  photoPermission:
    'Photo access is off for PioAssets. Allow it in Settings to scan a saved picture.',
  photoUnreadable: 'That photo could not be read. Try another picture.',
} as const;

/**
 * The token to look up from a photo's results, or the message to show.
 *
 * A photo can hold several codes (a box label with a serial barcode next to the
 * asset QR). The first that yields a token wins; results come in the order the
 * platform found them, and trying each one against the API would turn one tap
 * into several lookups.
 */
export function tokenFromPhotoResults(
  results: readonly { data: string }[] | null | undefined,
  os: string,
): { token: string } | { message: string } {
  for (const result of results ?? []) {
    const token = qrTokenFrom(result.data ?? '');
    if (token) return { token };
  }
  return { message: os === 'ios' ? SCAN_MESSAGES.noCodeInPhotoIos : SCAN_MESSAGES.noCodeInPhoto };
}
