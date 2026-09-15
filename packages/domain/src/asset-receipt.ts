/**
 * The printable equipment handover receipt (web: assets/[id]/receipt, v2.15),
 * shared by the web page and the phone.
 *
 * The receipt is a paper trail: what was issued, to whom, in what condition,
 * with what accessories, and two places to sign. The web page wrote every word
 * of it inline; the phone now prints the same document, and two receipts for
 * the same handover that differ by a word are two documents, not one. So the
 * content lives here and each app only lays it out - the web as a printable
 * page, the phone natively and as HTML for the system print dialog.
 *
 * Nothing below knows about React, the DOM or React Native. Dates go through a
 * formatter the caller passes, so each app keeps its own date style.
 */

/** The part of the `GET /assets/:id` payload a receipt is built from. */
export interface ReceiptAssetInput {
  assetTag: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  office?: { name: string } | null;
  category?: { name: string } | null;
  assignedUser?: {
    email: string;
    profile: { firstName: string; lastName: string } | null;
  } | null;
  assignments: {
    assignedAt: string;
    returnedAt: string | null;
    conditionOut: string;
    acknowledgedAt: string | null;
    expectedReturnAt: string | null;
    accessoriesIssued?: string | null;
    assignedBy?: { profile: { firstName: string; lastName: string } | null } | null;
    user: { email: string; profile: { firstName: string; lastName: string } | null } | null;
  }[];
}

export interface ReceiptRow {
  label: string;
  value: string;
}

export interface AssetReceipt {
  title: string;
  /** "PioAssets · generated <date>" */
  generatedLine: string;
  /** Shown instead of the handover section when nobody holds the device. */
  notIssuedNotice: string | null;
  deviceRows: ReceiptRow[];
  /** Null when there is no open assignment - and so nothing to sign for. */
  handoverRows: ReceiptRow[] | null;
  confirmation: string | null;
  /** [recipient, issuer] - null with the handover section. */
  signatureLabels: [string, string] | null;
  footer: string;
}

export const RECEIPT_TITLE = 'Equipment handover receipt';

/** "LIKE_NEW" -> "Like new", as the web page has always printed it. */
function conditionLabel(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ');
}

function personName(
  person: { email: string; profile: { firstName: string; lastName: string } | null } | null | undefined,
): string {
  if (!person) return '—';
  return person.profile ? `${person.profile.firstName} ${person.profile.lastName}` : person.email;
}

/**
 * Build the receipt for the asset's open assignment (or the device alone, when
 * there is none). `formatDate` receives ISO strings - including today's date,
 * for the "generated" line - so pass `now` to pin that in tests.
 */
export function assetReceipt(
  asset: ReceiptAssetInput,
  formatDate: (iso: string) => string,
  now: Date = new Date(),
): AssetReceipt {
  const open = asset.assignments.find((a) => !a.returnedAt) ?? null;
  // The handover's recipient first; an imported record can have a holder with
  // no handover behind it.
  const holderName = personName(open?.user ?? asset.assignedUser ?? null);

  const deviceRows: ReceiptRow[] = [
    { label: 'Asset tag', value: asset.assetTag },
    { label: 'Name', value: asset.name },
    // Brand and model are often the same word ("Dell Dell"); say it once.
    { label: 'Make / model', value: [...new Set([asset.brand, asset.model].filter(Boolean))].join(' ') || '—' },
    { label: 'Serial number', value: asset.serialNumber ?? '—' },
    { label: 'Category', value: asset.category?.name ?? '—' },
    { label: 'Office', value: asset.office?.name ?? '—' },
  ];

  const footerBase = `Generated from pioassets.com — ${asset.assetTag}`;
  const footerTail = '. In-app receipt confirmation is recorded in the audit log independently of this paper copy.';

  if (!open) {
    return {
      title: RECEIPT_TITLE,
      generatedLine: `PioAssets · generated ${formatDate(now.toISOString())}`,
      notIssuedNotice: 'This asset is not currently issued to anyone. This receipt documents the device only.',
      deviceRows,
      handoverRows: null,
      confirmation: null,
      signatureLabels: null,
      footer: `${footerBase}${footerTail}`,
    };
  }

  const issuedOn = formatDate(open.assignedAt);
  return {
    title: RECEIPT_TITLE,
    generatedLine: `PioAssets · generated ${formatDate(now.toISOString())}`,
    notIssuedNotice: null,
    deviceRows,
    handoverRows: [
      { label: 'Issued to', value: holderName },
      {
        label: 'Issued by',
        value: open.assignedBy?.profile
          ? `${open.assignedBy.profile.firstName} ${open.assignedBy.profile.lastName}`
          : '—',
      },
      { label: 'Issued on', value: issuedOn },
      { label: 'Condition at issue', value: conditionLabel(open.conditionOut) },
      { label: 'Accessories', value: open.accessoriesIssued ?? 'None recorded' },
      {
        label: 'Expected return',
        value: open.expectedReturnAt ? formatDate(open.expectedReturnAt) : 'Until further notice',
      },
      {
        label: 'Receipt confirmed',
        value: open.acknowledgedAt
          ? `Yes — ${formatDate(open.acknowledgedAt)} (in app)`
          : 'Not yet confirmed in app',
      },
    ],
    confirmation:
      'I confirm that I have received the equipment listed above in the stated condition, and that I will return it on request or when I leave the company.',
    signatureLabels: [`Signature — ${holderName} (recipient)`, 'Signature — issued by, and date'],
    footer: `${footerBase}, issued ${issuedOn}${footerTail}`,
  };
}
