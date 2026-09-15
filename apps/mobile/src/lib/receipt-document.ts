import type { AssetReceipt, ReceiptRow } from '@techpioasset/domain';
import { escapeHtml } from './escape-html';

/**
 * The handover receipt as something the phone can hand to the OS: an HTML
 * document for the print dialog (which is also how Android saves a PDF), and
 * plain text for the share sheet when there is no printer and no PDF viewer.
 *
 * Both are built from `assetReceipt` in the domain package - the model the web
 * receipt page renders - so the printed words cannot drift from the web's.
 * This file only decides markup, and escapes every value on the way in.
 */

function rowsHtml(rows: ReceiptRow[]): string {
  return rows
    .map((r) => `<div class="row"><dt>${escapeHtml(r.label)}</dt><dd>${escapeHtml(r.value)}</dd></div>`)
    .join('');
}

/** A print-ready HTML document, laid out like the web page's printout. */
export function receiptHtml(receipt: AssetReceipt): string {
  const handover = receipt.handoverRows
    ? [
        '<h2>Handover</h2>',
        `<dl>${rowsHtml(receipt.handoverRows)}</dl>`,
        receipt.confirmation ? `<p class="confirm">${escapeHtml(receipt.confirmation)}</p>` : '',
        receipt.signatureLabels
          ? `<div class="signatures">${receipt.signatureLabels
              .map((s) => `<div><div class="line"></div><p class="small">${escapeHtml(s)}</p></div>`)
              .join('')}</div>`
          : '',
      ].join('')
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(receipt.title)}</title>
<style>
  body { font-family: -apple-system, Roboto, 'Segoe UI', Arial, sans-serif; color: #000; background: #fff; font-size: 14px; margin: 32px; }
  .head { border-bottom: 2px solid #000; padding-bottom: 16px; }
  h1 { font-size: 20px; margin: 0; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em; margin: 24px 0 8px; }
  .small { font-size: 12px; color: #525252; margin: 4px 0 0; }
  .notice { margin-top: 16px; border: 1px solid #a3a3a3; border-radius: 4px; padding: 12px; }
  dl { display: grid; grid-template-columns: 1fr 1fr; column-gap: 32px; row-gap: 8px; margin: 0; }
  .row { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px solid #e5e5e5; padding: 4px 0; }
  dt { color: #525252; }
  dd { margin: 0; text-align: right; font-weight: 500; }
  .confirm { margin-top: 24px; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 40px; }
  .line { border-bottom: 1px solid #000; height: 32px; }
  .footer { margin-top: 40px; border-top: 1px solid #d4d4d4; padding-top: 8px; font-size: 12px; color: #737373; }
</style>
</head>
<body>
<div class="head"><h1>${escapeHtml(receipt.title)}</h1><p class="small">${escapeHtml(receipt.generatedLine)}</p></div>
${receipt.notIssuedNotice ? `<p class="notice">${escapeHtml(receipt.notIssuedNotice)}</p>` : ''}
<h2>Device</h2>
<dl>${rowsHtml(receipt.deviceRows)}</dl>
${handover}
<p class="footer">${escapeHtml(receipt.footer)}</p>
</body>
</html>`;
}

/** The same receipt as plain text, for the share sheet. Nothing is escaped: it is not markup. */
export function receiptText(receipt: AssetReceipt): string {
  const rows = (list: ReceiptRow[]) => list.map((r) => `${r.label}: ${r.value}`);
  const lines = [receipt.title, receipt.generatedLine, ''];
  if (receipt.notIssuedNotice) lines.push(receipt.notIssuedNotice, '');
  lines.push('DEVICE', ...rows(receipt.deviceRows));
  if (receipt.handoverRows) {
    lines.push('', 'HANDOVER', ...rows(receipt.handoverRows));
    if (receipt.confirmation) lines.push('', receipt.confirmation);
  }
  lines.push('', receipt.footer);
  return lines.join('\n');
}
