import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors/app-error.js';

/**
 * Short-lived download links the phone can hand to the system browser (v2.56).
 *
 * The same construction as the vendor product document links
 * (vendor-product-documents.service.ts): a base64url JSON payload naming the
 * file, the company and an expiry, HMAC-signed, good for two minutes. Pulled
 * out here for request attachments and invoice documents so the two new link
 * kinds cannot drift from each other; the vendor one is left exactly as it is.
 *
 * Each kind signs with its own key, derived from the access-token secret and a
 * purpose string. A link minted for one kind of file therefore fails the
 * signature check on every other route, and none of them can be presented as a
 * sign-in token.
 */

export const DOWNLOAD_LINK_TTL_SECONDS = 120;

export type DownloadLinkPurpose = 'request-attachment-link' | 'invoice-document-link';

function linkKey(secret: string, purpose: DownloadLinkPurpose): Buffer {
  return createHash('sha256').update(`${purpose}:${secret}`).digest();
}

/** The token part of a link: `<payload>.<signature>`. Access must be checked BEFORE calling this. */
export function signDownloadLink(
  secret: string,
  purpose: DownloadLinkPurpose,
  claims: { fileId: string; companyId: string },
): { token: string; expiresAt: string } {
  const expiresAt = Math.floor(Date.now() / 1000) + DOWNLOAD_LINK_TTL_SECONDS;
  const payload = Buffer.from(
    JSON.stringify({ d: claims.fileId, c: claims.companyId, e: expiresAt }),
  ).toString('base64url');
  const signature = createHmac('sha256', linkKey(secret, purpose)).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, expiresAt: new Date(expiresAt * 1000).toISOString() };
}

/**
 * What a genuine, unexpired token names. Everything the caller may trust comes
 * from here - the route itself has no session. A bad token is a 404 (it says
 * nothing about whether the file exists); an expired genuine one is a 401.
 */
export function verifyDownloadLink(
  secret: string,
  purpose: DownloadLinkPurpose,
  token: string,
  entity: string,
): { fileId: string; companyId: string } {
  const refuse = () => AppError.notFound(entity, 'link');
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) throw refuse();

  const expected = createHmac('sha256', linkKey(secret, purpose)).update(payload).digest();
  const given = Buffer.from(signature, 'base64url');
  // Same length first: timingSafeEqual throws on a mismatch.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw refuse();

  let claims: { d?: unknown; c?: unknown; e?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw refuse();
  }
  if (typeof claims.d !== 'string' || typeof claims.c !== 'string' || typeof claims.e !== 'number') {
    throw refuse();
  }
  if (claims.e < Math.floor(Date.now() / 1000)) {
    throw new AppError('UNAUTHENTICATED', 'This download link has expired', {
      detail: 'Open the file again from the app to get a fresh link.',
    });
  }
  return { fileId: claims.d, companyId: claims.c };
}

/** A filename safe to put in a Content-Disposition header. */
export function safeDownloadName(name: string): string {
  return name.replace(/[^\w.\- ]/g, '_');
}
