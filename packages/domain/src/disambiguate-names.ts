/**
 * Two rows with the same label and different numbers (v3.9).
 *
 * Asset types are named per category, so "Laptop" under Hardware and "Laptop"
 * under IT assets are different types that can both hold equipment. The type
 * donut asked the database to group by type and drew what came back, which on
 * a real tenant was:
 *
 *     Laptop   53
 *     Laptop    8
 *
 * A reader cannot tell those apart, cannot tell whether it is a bug, and
 * cannot act on either. It is the same fault as the heading that said
 * "Laptops" over a list of everything - one word carrying two numbers - and it
 * also broke the chart outright, because the slices were keyed by name and
 * React drops a duplicate key.
 *
 * So a name that is unique is left ALONE - qualifying every row would make the
 * common case noisier to fix a case that usually does not exist - and only a
 * name that genuinely repeats gets its owner appended.
 */

export interface NamedCount {
  name: string;
  count: number;
  /** Where it lives. Used only when the name alone is ambiguous. */
  qualifier?: string | null;
}

export function disambiguateNames<T extends NamedCount>(rows: T[]): T[] {
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.name, (seen.get(r.name) ?? 0) + 1);

  return rows.map((r) => {
    if ((seen.get(r.name) ?? 0) < 2) return r;
    // No qualifier to offer: still better than two identical rows, because the
    // reader can at least see that the ambiguity is real and not a double
    // count. Falls back to nothing rather than inventing a distinction.
    if (!r.qualifier) return r;
    return { ...r, name: `${r.name} (${r.qualifier})` };
  });
}
