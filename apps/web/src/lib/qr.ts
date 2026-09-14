/**
 * What a scanned (or pasted) asset code actually contains.
 *
 * Mirrors the mobile scanner's `qrTokenFrom` (apps/mobile/src/lib/qr.ts): a
 * label printed from the web encodes the ADDRESS the token lives at -
 * `https://pioassets.com/assets/scan/<token>` - not the bare token, and
 * `/assets/by-qr/:token` matches the token column exactly. So the address has
 * to be taken apart before the lookup, or every printed label misses.
 *
 * The web scan page also takes typed input, where a person is far more likely
 * to type the asset tag printed beside the code than a token. That is why the
 * result says whether the value came out of a label address: a label address
 * can only ever be a token, while free text may be either.
 */

/** The path the web label points at; the token is the segment after it. */
const SCAN_PATH = /\/assets\/scan\/([^/?#\s]+)/i;

export type ScanValue =
  /** Nothing was read or typed. */
  | { kind: 'empty' }
  /** A label address: the token is certain. */
  | { kind: 'label'; token: string }
  /** Anything else: a bare token (hand-made label) or an asset tag. */
  | { kind: 'text'; value: string };

export function parseScanValue(raw: string): ScanValue {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'empty' };

  // Matched by pattern rather than by parsing a URL, because the host varies by
  // deployment: a label printed against staging or localhost still has to work.
  const inPath = SCAN_PATH.exec(trimmed);
  if (inPath?.[1]) {
    let token = inPath[1];
    try {
      token = decodeURIComponent(token);
    } catch {
      // A malformed escape is still worth looking up as written.
    }
    return { kind: 'label', token };
  }

  // Foreign codes are not classified or rejected here - the API answers "no
  // such asset" for a code that is not ours, which says the same thing honestly.
  return { kind: 'text', value: trimmed };
}
