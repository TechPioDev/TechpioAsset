/**
 * Pictures inline in a request message (v2.61), the way mail clients do it:
 * between the words, where the writer put them, not in a strip underneath.
 *
 * The message stays plain text. A picture is a markdown-style token:
 *
 *   ![image 1](pending:1)            - while composing: the 1st file being sent
 *   ![image 1](attachment:<id>)      - once stored: the attachment's id
 *
 * The client sends the body with `pending:N` tokens and the files in that
 * order; the server stores the files and rewrites each token to the id it
 * made, in the same transaction as the message. Every message written before
 * this has no tokens and renders exactly as it did. A reader that predates
 * tokens shows them as text, which still says "image 1" and is never HTML.
 *
 * One parser and one serialiser here, for the web, the phone and the API.
 */

export type MessageImageRef = { kind: 'pending'; index: number } | { kind: 'attachment'; id: string };

export type MessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'image'; number: number; ref: MessageImageRef };

/** Attachment ids are cuids; pending indexes are small integers. Nothing else parses. */
const TOKEN = /!\[image (\d{1,2})\]\((pending|attachment):([A-Za-z0-9_-]{1,64})\)/g;

export function imageToken(number: number, ref: MessageImageRef): string {
  return `![image ${number}](${ref.kind === 'pending' ? `pending:${ref.index}` : `attachment:${ref.id}`})`;
}

/** Splits a body into its text and its pictures, in reading order. */
export function parseMessageBody(body: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let last = 0;
  for (const match of body.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) segments.push({ kind: 'text', text: body.slice(last, at) });
    const [, number, scheme, value] = match;
    segments.push({
      kind: 'image',
      number: Number(number),
      ref: scheme === 'pending' ? { kind: 'pending', index: Number(value) } : { kind: 'attachment', id: value! },
    });
    last = at + match[0].length;
  }
  if (last < body.length) segments.push({ kind: 'text', text: body.slice(last) });
  return segments;
}

/** The inverse of parseMessageBody. Adjacent text segments are simply joined. */
export function buildMessageBody(segments: readonly MessageSegment[]): string {
  return segments.map((s) => (s.kind === 'text' ? s.text : imageToken(s.number, s.ref))).join('');
}

/** The text alone, tokens removed - for a search index, an excerpt, a notification. */
export function stripImageTokens(body: string): string {
  return body.replace(TOKEN, '');
}

/** Distinct `pending:N` indexes, in the order they appear. */
export function pendingImageIndexes(body: string): number[] {
  const seen: number[] = [];
  for (const s of parseMessageBody(body)) {
    if (s.kind === 'image' && s.ref.kind === 'pending' && !seen.includes(s.ref.index)) seen.push(s.ref.index);
  }
  return seen;
}

/** Distinct attachment ids the body points at, in the order they appear. */
export function referencedAttachmentIds(body: string): string[] {
  const seen: string[] = [];
  for (const s of parseMessageBody(body)) {
    if (s.kind === 'image' && s.ref.kind === 'attachment' && !seen.includes(s.ref.id)) seen.push(s.ref.id);
  }
  return seen;
}

export type ResolvePendingResult =
  | { ok: true; body: string }
  /** The body names a picture that was not sent (index out of 1..count). */
  | { ok: false; reason: 'dangling'; index: number }
  /** An `attachment:` token on the way in - a client may only name its own uploads, by order. */
  | { ok: false; reason: 'foreign' };

/**
 * Rewrites `pending:N` to the id the server gave the Nth stored file. Refuses
 * a body that names a file it did not send, and a body that names attachments
 * directly - the only way to reference a picture on the way in is by upload
 * order, so a public message can never point at an internal note's picture.
 */
export function resolvePendingImages(body: string, attachmentIds: readonly string[]): ResolvePendingResult {
  const segments = parseMessageBody(body);
  for (const s of segments) {
    if (s.kind !== 'image') continue;
    if (s.ref.kind === 'attachment') return { ok: false, reason: 'foreign' };
    if (s.ref.index < 1 || s.ref.index > attachmentIds.length) {
      return { ok: false, reason: 'dangling', index: s.ref.index };
    }
  }
  return {
    ok: true,
    body: buildMessageBody(
      segments.map((s) =>
        s.kind === 'image' && s.ref.kind === 'pending'
          ? { ...s, ref: { kind: 'attachment', id: attachmentIds[s.ref.index - 1]! } }
          : s,
      ),
    ),
  };
}

/**
 * The body a composer sends: its text with `pending:N` tokens numbered by the
 * order the pictures appear in, which is the order the files are sent in.
 * `keys` is that order; a token naming a key not in the list is dropped, so a
 * removed picture leaves no hole.
 */
export function composeMessageBody(
  parts: readonly ({ kind: 'text'; text: string } | { kind: 'image'; key: string })[],
  keys: readonly string[],
): string {
  return buildMessageBody(
    parts.flatMap((p): MessageSegment[] => {
      if (p.kind === 'text') return [p];
      const index = keys.indexOf(p.key);
      if (index < 0) return [];
      return [{ kind: 'image', number: index + 1, ref: { kind: 'pending', index: index + 1 } }];
    }),
  );
}
