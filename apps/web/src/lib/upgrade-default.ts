/**
 * The size to offer first for a RAM or storage upgrade: the smallest option
 * larger than what the machine has. The owner pressed Submit three times on a
 * request whose Requested RAM was still empty - the box read "Current: 31.8 GB"
 * and looked filled in. A sensible default removes the trap; the person can
 * still change it or choose Other.
 */

/** The number of GB in an option such as "64 GB", "1 TB SSD" or "31.8 GB"; null if none. */
export function gigabytesOf(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = /(\d+(?:\.\d+)?)\s*(TB|GB)/i.exec(label);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2]!.toUpperCase() === 'TB' ? n * 1024 : n;
}

export function defaultUpgradeSpec(
  options: readonly string[],
  current: string | null | undefined,
): string | null {
  const have = gigabytesOf(current);
  if (have == null) return null;
  return options.find((o) => (gigabytesOf(o) ?? 0) > have) ?? null;
}

/** Field name -> what the person sees, for a refusal that names the field. */
export const REQUEST_FIELD_LABELS: Record<string, string> = {
  type: 'What do you need?',
  targetAssetId: 'Which asset is this about?',
  upgradeType: 'What upgrade is required?',
  requestedSpec: 'Requested size',
  replacementReason: 'Why replace it?',
  otherText: 'Details',
  businessReason: 'Why do you need it?',
  priority: 'Priority',
  requiredBy: 'Needed by',
  items: 'Items',
};

export function refusalMessage(field: string | undefined, detail: string | undefined): string {
  const label = field ? REQUEST_FIELD_LABELS[field.split('.')[0]!] : undefined;
  if (!label) return 'Not submitted yet — fill in the highlighted field';
  return detail ? `Not submitted yet — ${label}: ${detail}` : `Not submitted yet — fill in “${label}”`;
}
