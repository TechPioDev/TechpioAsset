import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { createRequire } from 'node:module';
import { QR_MARGIN, assetLabelUrl, darkRuns, qrLabelHtml, qrMatrix, type QrMatrix } from './qr-label';
import { qrTokenFrom } from './qr';

// pngjs is qrcode's own PNG encoder - loaded from beside it rather than added
// to the app as a dependency it would never ship.
const requireFromQrcode = createRequire(createRequire(import.meta.url).resolve('qrcode'));
const { PNG } = requireFromQrcode('pngjs') as {
  PNG: { sync: { read(buffer: Buffer): { width: number; data: Buffer } } };
};

const token = '01KYX56HZT81QXS171WT4H9XGG';
const url = assetLabelUrl('https://pioassets.com', token);

function grid(rows: string[]): QrMatrix {
  return { size: rows.length, get: (r, c) => rows[r]![c] === '#' };
}

function darkCount(m: QrMatrix): number {
  let n = 0;
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) n++;
  return n;
}

describe('assetLabelUrl', () => {
  it('encodes the web label address, which the scanner reads back', () => {
    expect(url).toBe(`https://pioassets.com/assets/scan/${token}`);
    expect(assetLabelUrl('https://pioassets.com/', token)).toBe(url);
    expect(qrTokenFrom(url)).toBe(token);
  });
});

describe('darkRuns', () => {
  it('merges adjacent dark modules, including runs that touch either edge', () => {
    expect(darkRuns(grid(['##.#', '....', '.###', '####']))).toEqual([
      { row: 0, col: 0, length: 2 },
      { row: 0, col: 3, length: 1 },
      { row: 2, col: 1, length: 3 },
      { row: 3, col: 0, length: 4 },
    ]);
  });

  it('is deterministic and preserves every dark cell of a real label', () => {
    const m = qrMatrix(url);
    const runs = darkRuns(m);
    expect(darkRuns(qrMatrix(url))).toEqual(runs);
    expect(runs.reduce((n, r) => n + r.length, 0)).toBe(darkCount(m));
    // Every run is dark throughout and bounded by light (or the edge) - so the
    // runs redraw the matrix exactly, not approximately.
    for (const r of runs) {
      for (let c = r.col; c < r.col + r.length; c++) expect(m.get(r.row, c)).toBeTruthy();
      if (r.col > 0) expect(m.get(r.row, r.col - 1)).toBeFalsy();
      if (r.col + r.length < m.size) expect(m.get(r.row, r.col + r.length)).toBeFalsy();
    }
    // The point of merging: well under one view per dark module.
    expect(runs.length).toBeLessThan(darkCount(m) * 0.7);
  });
});

describe('qrMatrix', () => {
  it('is the same code, module for module, as the PNG the web page draws', async () => {
    // The web: QRCode.toDataURL(url, { margin: 1, width: 176 }). Decode that PNG
    // and sample the centre of every module against the phone's matrix.
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 176 });
    const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1]!, 'base64'));
    const m = qrMatrix(url);
    const total = m.size + QR_MARGIN * 2;
    const scale = png.width / total;
    for (let r = 0; r < m.size; r++) {
      for (let c = 0; c < m.size; c++) {
        const x = Math.floor((c + QR_MARGIN + 0.5) * scale);
        const y = Math.floor((r + QR_MARGIN + 0.5) * scale);
        const dark = png.data[(y * png.width + x) * 4]! < 128;
        expect(dark, `module ${r},${c}`).toBe(Boolean(m.get(r, c)));
      }
    }
  });
});

describe('qrLabelHtml', () => {
  it('draws one rect per run inside a quiet zone, and escapes the tag', () => {
    const m = grid(['#.', '.#']);
    const html = qrLabelHtml(m, 'PT-<1>');
    expect(html).toContain('viewBox="0 0 4 4"');
    expect(html).toContain('<rect x="1" y="1" width="1" height="1"/>');
    expect(html).toContain('<rect x="2" y="2" width="1" height="1"/>');
    expect(html).toContain('PT-&lt;1&gt;');
    expect(html).not.toContain('PT-<1>');
  });
});
