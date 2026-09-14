import {
  ASSET_STATUSES,
  ASSET_STATUSES_IN_EMPLOYEE_CUSTODY,
  type AssetStatus,
} from '@techpioasset/domain';

/**
 * Asset administration on the phone: edit, office transfer, disposal and the
 * extra create fields. The screens are thin; the rules that decide what is sent
 * to the API live here so they can be proven without a device, and each one
 * mirrors the web form it stands in for (apps/web assets/[id]/edit, new,
 * transfer-panel, disposal-panel) so the two clients cannot drift apart.
 */

/** A calendar date as the API takes it. No native date picker ships in the APK. */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  // 2026-02-31 parses to 3 March; a round trip catches it.
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Blank is allowed (the field is optional); anything else must be a real date. */
export function dateError(value: string, label: string): string | null {
  const v = value.trim();
  if (!v || isValidIsoDate(v)) return null;
  return `${label}: use YYYY-MM-DD, e.g. 2026-04-01`;
}

/** Same rule the web price box applies before it calls the API. */
export const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;
export const PRICE_HINT = 'Enter a plain amount, e.g. 45000 or 45000.50';

export function priceError(value: string): string | null {
  const v = value.trim();
  if (!v || PRICE_PATTERN.test(v)) return null;
  return PRICE_HINT;
}

const toDateInput = (value: string | null | undefined): string => (value ? value.slice(0, 10) : '');

/** The parts of GET /assets/:id the edit form reads. */
export interface EditableAsset {
  name: string;
  assetTag: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  macAddress?: string | null;
  imei?: string | null;
  specs: Record<string, string> | null;
  status: AssetStatus;
  condition: string;
  purchaseDate: string | null;
  warrantyEndDate: string | null;
  notes?: string | null;
  version: number;
  category: { id: string } | null;
  subcategory: { id: string } | null;
  office: { id: string } | null;
}

export interface EditFormValues {
  name: string;
  assetTag: string;
  categoryId: string;
  subcategoryId: string;
  brand: string;
  model: string;
  serialNumber: string;
  macAddress: string;
  imei: string;
  officeId: string;
  purchaseDate: string;
  warrantyEndDate: string;
  condition: string;
  status: AssetStatus;
  notes: string;
}

/** Hydrate every field from the record, so a field nobody touched round-trips unchanged. */
export function editFormFromAsset(asset: EditableAsset): EditFormValues {
  return {
    name: asset.name,
    assetTag: asset.assetTag,
    categoryId: asset.category?.id ?? '',
    subcategoryId: asset.subcategory?.id ?? '',
    brand: asset.brand ?? '',
    model: asset.model ?? '',
    serialNumber: asset.serialNumber ?? '',
    macAddress: asset.macAddress ?? '',
    imei: asset.imei ?? '',
    officeId: asset.office?.id ?? '',
    purchaseDate: toDateInput(asset.purchaseDate),
    warrantyEndDate: toDateInput(asset.warrantyEndDate),
    condition: asset.condition,
    status: asset.status,
    notes: asset.notes ?? '',
  };
}

/**
 * A fresh copy of the asset arrived under the form (after a 409): fields the
 * user edited keep their edits, everything else takes the server's latest -
 * the web form's reset with keepDirtyValues.
 */
export function mergeFresh(
  current: EditFormValues,
  loaded: EditFormValues,
  fresh: EditFormValues,
): EditFormValues {
  const out = { ...fresh };
  for (const key of Object.keys(current) as (keyof EditFormValues)[]) {
    if (current[key] !== loaded[key]) (out as Record<string, string>)[key] = current[key];
  }
  return out;
}

/** Message from an API problem, including field-level errors when present. */
export function problemMessage(
  error: unknown,
  fallback: string,
): string {
  if (!(error instanceof Error)) return fallback;
  const problem = (error as { problem?: { errors?: { path: string; message: string }[] } | null }).problem;
  const fields = problem?.errors?.map((e) => e.message).filter(Boolean) ?? [];
  if (fields.length) return fields.join('\n');
  return error.message || fallback;
}

/** Why the form cannot be saved yet, or null when it can. */
export function validateEditForm(values: EditFormValues): string | null {
  if (!values.name.trim()) return 'Give the asset a name';
  if (!values.assetTag.trim()) return 'The asset tag is required';
  if (!values.categoryId) return 'Choose a category';
  return dateError(values.purchaseDate, 'Purchased on') ?? dateError(values.warrantyEndDate, 'Warranty ends');
}

const cleanSpecs = (specs: Record<string, string>) =>
  Object.fromEntries(Object.entries(specs).filter(([, v]) => v.trim()));

/**
 * The PATCH /assets/:id body - the same fields, in the same shape, the web edit
 * form sends. Blank means "clear it" (null), specs are always sent so clearing a
 * box clears the detail, and the version carries the optimistic lock.
 *
 * Notes are the one addition: the web form has no notes box, so they are sent
 * only when changed here, and an untouched note is never rewritten.
 */
export function buildUpdatePayload(
  values: EditFormValues,
  specs: Record<string, string>,
  original: { version: number; notes?: string | null },
): Record<string, unknown> {
  const notesChanged = values.notes.trim() !== (original.notes ?? '').trim();
  return {
    name: values.name.trim(),
    assetTag: values.assetTag.trim(),
    categoryId: values.categoryId,
    subcategoryId: values.subcategoryId || null,
    brand: values.brand.trim() || null,
    model: values.model.trim() || null,
    serialNumber: values.serialNumber.trim() || null,
    macAddress: values.macAddress.trim() || null,
    imei: values.imei.trim() || null,
    specs: cleanSpecs(specs),
    officeId: values.officeId || null,
    purchaseDate: values.purchaseDate.trim() || null,
    warrantyEndDate: values.warrantyEndDate.trim() || null,
    condition: values.condition,
    status: values.status,
    ...(notesChanged ? { notes: values.notes.trim() || null } : {}),
    version: original.version,
  };
}

/**
 * Statuses offered on edit. Custody statuses are earned through Assign, not
 * declared - but the asset's current one always stays listed so an untouched
 * form round-trips. Same filter as the web select.
 */
export function editableStatuses(current: AssetStatus): AssetStatus[] {
  return ASSET_STATUSES.filter(
    (s) => s === current || !ASSET_STATUSES_IN_EMPLOYEE_CUSTODY.includes(s),
  );
}

/**
 * The fields the create form gained on mobile, in the web's POST /assets shape:
 * each is omitted when blank, and the price is sent only by a cost-permission
 * holder (the API refuses it from anyone else).
 */
export function buildCreateExtras(
  input: { officeId: string; purchaseDate: string; warrantyEndDate: string; purchaseCost: string },
  canSetPrice: boolean,
): Record<string, string> {
  const purchaseDate = input.purchaseDate.trim();
  const warrantyEndDate = input.warrantyEndDate.trim();
  const purchaseCost = input.purchaseCost.trim();
  return {
    ...(input.officeId ? { officeId: input.officeId } : {}),
    ...(purchaseDate ? { purchaseDate } : {}),
    ...(warrantyEndDate ? { warrantyEndDate } : {}),
    ...(canSetPrice && purchaseCost ? { purchaseCost } : {}),
  };
}

// ---------------------------------------------------------------------------
// Office transfer (web: transfer-panel.tsx)
// ---------------------------------------------------------------------------

/** Unheld, on-site statuses the state machine lets move to IN_TRANSIT. */
export const DISPATCHABLE_FROM: readonly AssetStatus[] = ['AVAILABLE', 'RESERVED', 'IN_STORAGE'];

export type TransferView = 'receive' | 'dispatch' | 'none';

/** Which transfer card, if any, the asset page shows - the web panel's branches. */
export function transferView(input: {
  canTransfer: boolean;
  status: AssetStatus;
  holderId: string | null;
  hasOpenTransfer: boolean;
}): TransferView {
  if (!input.canTransfer) return 'none';
  if (input.status === 'IN_TRANSIT' && input.hasOpenTransfer) return 'receive';
  if (input.holderId || !DISPATCHABLE_FROM.includes(input.status)) return 'none';
  return 'dispatch';
}

export function buildDispatchPayload(toOfficeId: string, reason: string): Record<string, string> {
  const r = reason.trim();
  return { toOfficeId, ...(r ? { reason: r } : {}) };
}

// ---------------------------------------------------------------------------
// Disposal (web: disposal-panel.tsx)
// ---------------------------------------------------------------------------

export const DISPOSAL_METHODS = [
  { id: 'SOLD', name: 'Sold' },
  { id: 'SCRAPPED', name: 'Scrapped' },
  { id: 'RECYCLED', name: 'Recycled' },
  { id: 'DONATED', name: 'Donated' },
  { id: 'RETURNED_TO_VENDOR', name: 'Returned to vendor' },
  { id: 'WRITTEN_OFF', name: 'Written off' },
] as const;

export type DisposalMethod = (typeof DISPOSAL_METHODS)[number]['id'];

export const disposalMethodLabel = (m: string): string =>
  DISPOSAL_METHODS.find((x) => x.id === m)?.name ?? m;

/** Statuses the machine lets move to DISPOSED/DONATED. */
export const DISPOSABLE_FROM: readonly AssetStatus[] = ['AVAILABLE', 'IN_STORAGE', 'RETIRED'];

export interface DisposalInput {
  method: DisposalMethod;
  disposedAt: string;
  proceeds: string;
  recipient: string;
  reason: string;
}

/** The first thing stopping the disposal being recorded, or null. */
export function validateDisposal(input: DisposalInput, today: string): string | null {
  if (!isValidIsoDate(input.disposedAt.trim())) return 'Date: use YYYY-MM-DD, e.g. 2026-04-01';
  // The API allows a day's grace for time zones; a later date is refused.
  if (input.disposedAt.trim() > today) return 'The disposal date cannot be in the future';
  const proceeds = priceError(input.proceeds);
  if (proceeds) return proceeds;
  if (input.reason.trim().length < 10) return 'Explain why this asset is being disposed of (at least 10 characters)';
  return null;
}

/** POST /assets/:id/dispose - the web panel's body: optional parts omitted when blank. */
export function buildDisposalPayload(input: DisposalInput): Record<string, string> {
  const proceeds = input.proceeds.trim();
  const recipient = input.recipient.trim();
  return {
    method: input.method,
    disposedAt: input.disposedAt.trim(),
    reason: input.reason.trim(),
    ...(proceeds ? { proceeds } : {}),
    ...(recipient ? { recipient } : {}),
  };
}

/** The recipient box's label follows the method, as on the web. */
export function recipientLabel(method: DisposalMethod): string {
  if (method === 'DONATED') return 'Donated to';
  if (method === 'SOLD') return 'Buyer';
  return 'Recipient (optional)';
}

/** Today as YYYY-MM-DD in the phone's own time zone. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
