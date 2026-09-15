import QRCode from 'qrcode';
import { escapeHtml } from './escape-html';

/**
 * The asset's QR label on the phone (web: AssetQrCard on the asset page, v2.12).
 *
 * The web draws the label with `QRCode.toDataURL` from the `qrcode` package -
 * locally, so the token never goes to an external chart service. React Native
 * has no canvas, so the phone asks the same package for the bare module matrix
 * and draws squares itself. Same package, same text, same error-correction
 * level: the two labels are the same code, module for module, and either one
 * scans (src/lib/qr.ts reads both).
 *
 * Drawn naively a label is ~600 dark squares, one View each. Adjacent dark
 * modules in a row are merged into one bar first, which roughly halves that and
 * keeps the tab quick to mount.
 */

/** The error-correction level `toDataURL` uses when the web passes none. */
export const QR_ERROR_CORRECTION = 'M' as const;
/** Quiet zone in modules - the web's `margin: 1`. */
export const QR_MARGIN = 1;

/**
 * What the label encodes: the web's scan address,
 * `${window.location.origin}/assets/scan/${qrToken}`. The phone has no window,
 * so the origin is passed in (the web app's origin - in production the same
 * host as the API). A trailing slash on it is tolerated.
 */
export function assetLabelUrl(origin: string, qrToken: string): string {
  return `${origin.replace(/\/+$/, '')}/assets/scan/${qrToken}`;
}

/** The square module grid, `true` for dark. Any shape with size + get works. */
export interface QrMatrix {
  size: number;
  get(row: number, col: number): boolean | number;
}

/** A horizontal run of dark modules: `length` cells starting at (row, col). */
export interface QrRun {
  row: number;
  col: number;
  length: number;
}

/** The label's module matrix, built exactly as the web's `toDataURL` builds it. */
export function qrMatrix(text: string): QrMatrix {
  return QRCode.create(text, { errorCorrectionLevel: QR_ERROR_CORRECTION }).modules;
}

/** Merge each row's adjacent dark modules into single runs. */
export function darkRuns(matrix: QrMatrix): QrRun[] {
  const runs: QrRun[] = [];
  for (let row = 0; row < matrix.size; row++) {
    let start = -1;
    for (let col = 0; col <= matrix.size; col++) {
      const dark = col < matrix.size && Boolean(matrix.get(row, col));
      if (dark && start < 0) start = col;
      if (!dark && start >= 0) {
        runs.push({ row, col: start, length: col - start });
        start = -1;
      }
    }
  }
  return runs;
}

/**
 * The label as a printable HTML page: the code as an SVG (crisp at any printer
 * resolution) on white, the asset tag under it - what the web's downloaded PNG
 * carries, plus the tag a person reads when the camera is not to hand.
 */
export function qrLabelHtml(matrix: QrMatrix, assetTag: string): string {
  const total = matrix.size + QR_MARGIN * 2;
  const rects = darkRuns(matrix)
    .map((r) => `<rect x="${r.col + QR_MARGIN}" y="${r.row + QR_MARGIN}" width="${r.length}" height="1"/>`)
    .join('');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(assetTag)} QR label</title>
<style>
  body { margin: 24px; font-family: ui-monospace, Menlo, Consolas, monospace; background: #fff; color: #000; }
  .label { display: inline-block; text-align: center; }
  svg { width: 176px; height: 176px; display: block; }
  p { margin: 6px 0 0; font-size: 14px; }
</style>
</head>
<body>
<div class="label">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><g fill="#000">${rects}</g></svg>
<p>${escapeHtml(assetTag)}</p>
</div>
</body>
</html>`;
}
