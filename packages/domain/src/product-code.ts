/**
 * The readable identifier a listing is known by (v2.48).
 *
 * `LAP-DELL-5420-001`: what it is, who makes it, which model, and which of that
 * make and model this is. Built to be said aloud and typed into a search box,
 * which a cuid is not - people quote these to each other in emails and on the
 * phone, and a supplier's own SKU cannot serve because two suppliers may use
 * the same one and plenty of listings have none at all.
 *
 * The stem is derived here and the trailing sequence is assigned by the
 * database under a lock, because only the database knows what already exists.
 */

/** Letters and digits only, uppercased. Everything else is noise in a code. */
function compact(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/**
 * The distinctive part of a model name.
 *
 * "Latitude 5420" is known as a 5420, not as a Latitude, so a run of three or
 * more digits wins when there is one. Falling back to letters covers the models
 * that have no number in them at all.
 */
function modelPart(model: string | null | undefined): string {
  const digits = (model ?? '').match(/\d{3,}/g);
  if (digits?.length) return digits.sort((a, b) => b.length - a.length)[0]!.slice(0, 6);
  return compact(model).slice(0, 6);
}

/**
 * The stem a sequence is appended to, e.g. `LAP-DELL-5420`.
 *
 * Every part is optional except the category, and a listing with nothing but a
 * category still gets a usable code rather than a bare number.
 */
export function productCodeStem(input: {
  categoryName?: string | null;
  brand?: string | null;
  model?: string | null;
}): string {
  const category = compact(input.categoryName).slice(0, 3) || 'GEN';
  const brand = compact(input.brand).slice(0, 6);
  const model = modelPart(input.model);
  return [category, brand, model].filter(Boolean).join('-');
}

/** `LAP-DELL-5420` + 1 -> `LAP-DELL-5420-001`. Four digits past 999 rather than wrapping. */
export function formatProductCode(stem: string, sequence: number): string {
  return `${stem}-${String(sequence).padStart(3, '0')}`;
}

/** The number on the end of a code, or 0 if it does not end in one. */
export function productCodeSequence(code: string): number {
  const tail = /-(\d+)$/.exec(code);
  return tail ? Number(tail[1]) : 0;
}
